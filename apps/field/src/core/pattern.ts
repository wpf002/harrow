/**
 * Sampling patterns, and the state machine that enforces one.
 *
 * §13: "the app is the protocol". The pattern is declared before capture begins and the
 * app refuses anything that departs from it. A pattern recorded after the fact is a
 * description of what happened, not a rule.
 *
 * The design constraint that shapes everything here is §9's protocol correction:
 *
 *   > you cannot take 20 readings at one spot — the first reading destroys it
 *
 * So a "retake" cannot mean re-probing the same hole. Each grid point carries a single
 * designated **retake offset** — a fresh point 0.25 m perpendicular to the grid axis —
 * and it can be used once. After that the point is spent, and the operator moves on with
 * the failure recorded. That is a worse outcome than a clean capture and a much better
 * one than a second reading through disturbed ground, which would look like a soft
 * cushion and be an artefact of the first probe.
 */

export type PathSegment = 'RAIL' | 'MID' | 'OUTSIDE';

export interface GridPoint {
  /** Stable within a pattern: "RAIL-03". Written to the reading, used for resume. */
  id: string;
  index: number;
  segment: PathSegment;
  /** Metres along the running direction from the session origin. */
  alongM: number;
  /** Metres from the rail. */
  offsetM: number;
}

export interface SamplingPattern {
  name: string;
  description: string;
  segments: readonly PathSegment[];
  pointsPerSegment: number;
  spacingM: number;
  /** Perpendicular offset used when a point must be retaken on fresh ground. */
  retakeOffsetM: number;
  points: readonly GridPoint[];
}

const SEGMENT_OFFSET_M: Record<PathSegment, number> = { RAIL: 1.5, MID: 12, OUTSIDE: 24 };

function buildPoints(
  segments: readonly PathSegment[],
  pointsPerSegment: number,
  spacingM: number,
): GridPoint[] {
  const points: GridPoint[] = [];
  let index = 0;
  for (const segment of segments) {
    for (let i = 0; i < pointsPerSegment; i++) {
      points.push({
        id: `${segment}-${String(i + 1).padStart(2, '0')}`,
        index: index++,
        segment,
        alongM: i * spacingM,
        offsetM: SEGMENT_OFFSET_M[segment],
      });
    }
  }
  return points;
}

function pattern(
  name: string,
  description: string,
  segments: readonly PathSegment[],
  pointsPerSegment: number,
  spacingM: number,
  retakeOffsetM = 0.25,
): SamplingPattern {
  return {
    name,
    description,
    segments,
    pointsPerSegment,
    spacingM,
    retakeOffsetM,
    points: buildPoints(segments, pointsPerSegment, spacingM),
  };
}

/**
 * The registry. Patterns are named and versioned because a session's readings are only
 * comparable to another session's if the pattern was the same, and "we changed the grid
 * spacing at some point in 2027" is not something anyone should have to reconstruct.
 */
export const PATTERNS: Readonly<Record<string, SamplingPattern>> = Object.freeze({
  grid_20pt_3segment_v1: pattern(
    'grid_20pt_3segment_v1',
    '20 points on a 0.5 m adjacent-point grid, across rail, mid and outside.',
    ['RAIL', 'MID', 'OUTSIDE'],
    7,
    0.5,
  ),
  grid_12pt_2segment_v1: pattern(
    'grid_12pt_2segment_v1',
    'Reduced pattern: 12 points across rail and mid. For short windows only.',
    ['RAIL', 'MID'],
    6,
    0.5,
  ),
  lab_substrate_v1: pattern(
    'lab_substrate_v1',
    'Homogeneous lab substrate, 20 points. Isolates instrument repeatability (§9).',
    ['MID'],
    20,
    0.5,
  ),
});

export function getPattern(name: string): SamplingPattern {
  const p = PATTERNS[name];
  if (!p) {
    throw new Error(
      `unknown sampling pattern "${name}"; known: ${Object.keys(PATTERNS).join(', ')}`,
    );
  }
  return p;
}

export type PointState = 'PENDING' | 'CAPTURED' | 'RETAKE_PENDING' | 'SPENT';

export interface PointProgress {
  point: GridPoint;
  state: PointState;
  /** Set once a point has been retaken — it may not be retaken again. */
  retakeUsed: boolean;
  attempts: number;
}

export class PatternViolation extends Error {}

/**
 * Tracks progress through a declared pattern. Pure, serialisable, and the single source
 * of truth for what the operator is allowed to do next.
 */
export class PatternRun {
  readonly pattern: SamplingPattern;
  private readonly progress: PointProgress[];

  constructor(pattern: SamplingPattern, restore?: readonly PointProgress[]) {
    this.pattern = pattern;
    this.progress =
      restore?.map((p) => ({ ...p })) ??
      pattern.points.map((point) => ({
        point,
        state: 'PENDING' as PointState,
        retakeUsed: false,
        attempts: 0,
      }));
  }

  /** Serialisable state, so a killed browser resumes exactly where it stopped. */
  snapshot(): PointProgress[] {
    return this.progress.map((p) => ({ ...p }));
  }

  /** The point the operator should probe next, or null when the pattern is complete. */
  next(): PointProgress | null {
    return (
      this.progress.find((p) => p.state === 'RETAKE_PENDING') ??
      this.progress.find((p) => p.state === 'PENDING') ??
      null
    );
  }

  at(pointId: string): PointProgress {
    const found = this.progress.find((p) => p.point.id === pointId);
    if (!found) throw new PatternViolation(`point ${pointId} is not in this pattern`);
    return found;
  }

  /**
   * Where the probe actually goes for this attempt. A retake is displaced perpendicular
   * onto fresh ground — never back into the hole the first reading made.
   */
  targetFor(pointId: string): { alongM: number; offsetM: number; isRetake: boolean } {
    const p = this.at(pointId);
    const isRetake = p.state === 'RETAKE_PENDING';
    return {
      alongM: p.point.alongM,
      offsetM: p.point.offsetM + (isRetake ? this.pattern.retakeOffsetM : 0),
      isRetake,
    };
  }

  /** Record a good capture. */
  accept(pointId: string): void {
    const p = this.at(pointId);
    if (p.state === 'CAPTURED' || p.state === 'SPENT') {
      throw new PatternViolation(
        `point ${pointId} has already been probed. Probing it again measures the hole ` +
          'the first reading made, not the surface.',
      );
    }
    p.attempts++;
    p.state = 'CAPTURED';
  }

  /**
   * Reject a capture — a rate outlier, a GPS gate failure, an obviously wrong curve.
   *
   * The reading itself is still kept (§2.1: raw is permanent); this only decides whether
   * the operator gets fresh ground for another attempt.
   */
  reject(pointId: string, reason: string): { canRetake: boolean; reason: string } {
    const p = this.at(pointId);
    if (p.state === 'CAPTURED') {
      throw new PatternViolation(`point ${pointId} was already accepted`);
    }
    p.attempts++;
    if (p.retakeUsed) {
      p.state = 'SPENT';
      return {
        canRetake: false,
        reason: `${reason}. Retake already used at ${pointId}; the point is spent. Move on.`,
      };
    }
    p.retakeUsed = true;
    p.state = 'RETAKE_PENDING';
    return {
      canRetake: true,
      reason: `${reason}. Retake at ${this.pattern.retakeOffsetM} m offset — fresh ground, not the same hole.`,
    };
  }

  get complete(): boolean {
    return this.progress.every((p) => p.state === 'CAPTURED' || p.state === 'SPENT');
  }

  get captured(): number {
    return this.progress.filter((p) => p.state === 'CAPTURED').length;
  }

  get spent(): number {
    return this.progress.filter((p) => p.state === 'SPENT').length;
  }

  segmentsCovered(): PathSegment[] {
    return [
      ...new Set(this.progress.filter((p) => p.state === 'CAPTURED').map((p) => p.point.segment)),
    ].sort();
  }

  /**
   * Whether the session is worth closing.
   *
   * Mirrors the server's validation so the operator finds out while still standing on
   * the track, not that evening. Deliberately duplicated rather than shared: the server
   * must never trust a client's opinion of its own validity.
   */
  readyToClose(): { ok: boolean; problems: string[] } {
    const problems: string[] = [];
    if (this.captured < 8) problems.push(`only ${this.captured} captured, need at least 8`);
    if (this.segmentsCovered().length < 2) {
      problems.push(
        `only ${this.segmentsCovered().length} path segment(s) covered — a rail-only session ` +
          'does not describe the track a field runs on',
      );
    }
    if (!this.complete) {
      const remaining = this.progress.filter((p) => p.state !== 'CAPTURED' && p.state !== 'SPENT');
      problems.push(`${remaining.length} point(s) not yet attempted`);
    }
    return { ok: problems.length === 0, problems };
  }
}
