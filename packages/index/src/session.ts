/**
 * Session-level index computation (§2.6: sessions, not readings).
 *
 * A single probe insertion measures one point on a track. An index describes a
 * surface. The bridge between them is a session: a set of readings taken under a
 * declared sampling pattern, on one day, at one track.
 *
 * Two rules are enforced here rather than trusted:
 *   - readings carrying an index-blocking quality flag are excluded, and the exclusion
 *     is counted and reported, never silent (§2.5)
 *   - a session with too few eligible readings yields no index at all, rather than a
 *     confident-looking number computed from three points
 */
import {
  blocksIndexComputation,
  hashInputs,
  type QualityFlag,
  type SurfaceType,
} from '@harrow/shared';

import {
  physicalIndexV1,
  PHYSICAL_INDEX_NAME,
  PHYSICAL_INDEX_VERSION_V1,
  type PhysicalIndexInput,
} from './physical/v1.js';

/** Below this, a session does not describe a surface. */
export const MIN_ELIGIBLE_READINGS = 8;

export interface SessionReading extends Omit<PhysicalIndexInput, 'surfaceType'> {
  readingId: string;
  qualityFlags: readonly QualityFlag[];
  derivationVersion: string;
}

export interface SessionIndexResult {
  indexName: string;
  version: string;
  surfaceType: SurfaceType;
  value: number;
  /** Spread across eligible readings — the session's own uncertainty, always reported. */
  medianAbsoluteDeviation: number;
  readingsUsed: number;
  readingsExcluded: number;
  excludedByFlag: Record<string, number>;
  derivationVersion: string;
  inputsHash: string;
}

export class InsufficientReadingsError extends Error {
  constructor(
    readonly eligible: number,
    readonly required: number,
  ) {
    super(`session has ${eligible} eligible readings, needs ${required}`);
  }
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function mad(values: number[], centre: number): number {
  return median(values.map((v) => Math.abs(v - centre)));
}

/**
 * Compute physical_index_v1 for one session.
 *
 * The index is the median of per-reading index values, not the index of the mean
 * reading. A median is unmoved by a single anomalous point, and averaging the inputs
 * before a non-linear normalisation would quietly change what the number means.
 */
export function computeSessionPhysicalIndexV1(
  surfaceType: SurfaceType,
  readings: readonly SessionReading[],
): SessionIndexResult {
  const excludedByFlag: Record<string, number> = {};
  const eligible: SessionReading[] = [];

  for (const r of readings) {
    if (blocksIndexComputation(r.qualityFlags)) {
      for (const f of r.qualityFlags) {
        excludedByFlag[f] = (excludedByFlag[f] ?? 0) + 1;
      }
      continue;
    }
    eligible.push(r);
  }

  if (eligible.length < MIN_ELIGIBLE_READINGS) {
    throw new InsufficientReadingsError(eligible.length, MIN_ELIGIBLE_READINGS);
  }

  const derivationVersions = [...new Set(eligible.map((r) => r.derivationVersion))].sort();
  if (derivationVersions.length > 1) {
    throw new Error(
      `session mixes derivation versions (${derivationVersions.join(', ')}); ` +
        'recompute the session to one version before indexing',
    );
  }

  const values = eligible.map((r) => physicalIndexV1({ ...r, surfaceType }).value);
  const value = median(values);

  return {
    indexName: PHYSICAL_INDEX_NAME,
    version: PHYSICAL_INDEX_VERSION_V1,
    surfaceType,
    value: Number(value.toFixed(4)),
    medianAbsoluteDeviation: Number(mad(values, value).toFixed(4)),
    readingsUsed: eligible.length,
    readingsExcluded: readings.length - eligible.length,
    excludedByFlag,
    derivationVersion: derivationVersions[0]!,
    inputsHash: hashInputs({
      indexName: PHYSICAL_INDEX_NAME,
      version: PHYSICAL_INDEX_VERSION_V1,
      surfaceType,
      derivationVersion: derivationVersions[0]!,
      readingIds: eligible.map((r) => r.readingId).sort(),
    }),
  };
}
