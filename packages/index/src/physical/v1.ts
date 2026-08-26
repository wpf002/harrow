/**
 * physical_index_v1 — published, physics-based, versioned, fit to nothing (§12 6a).
 *
 * WHAT THIS IS
 * ------------
 * A description of the surface's mechanical state, on a 0-10 scale where higher means
 * firmer and more supportive. It is not a prediction, not a rating, and not a judgment
 * of anyone's track preparation. It is reported alongside the official going label as
 * description, never as accusation.
 *
 * WHAT THIS IS NOT
 * ----------------
 * It is not fitted to race outcomes. Not one weight below was chosen by regression.
 * The quantity fitted against race-time residuals is `predictive_feature`, it lives in
 * the modelling layer, and it is a different table, a different type and a different
 * endpoint (rule §2.2).
 *
 * THREE SCALES, ONE FRAMEWORK (§2.3)
 * ----------------------------------
 * Dirt, turf and synthetic are different physics, so they get different weights and
 * different reference ranges. There is deliberately no cross-surface composite: a
 * single number spanning all three would be meaningless, and looking authoritative
 * while being meaningless is the specific failure §12 warns about.
 *
 * IMMUTABILITY (§2.4)
 * -------------------
 * These constants are frozen and are asserted against a fixed expectation in the test
 * suite. Changing a weight here is not a bug fix, it is `physical_index_v2`, computed
 * alongside v1 and backfilled over all retained raw.
 */
import type { SurfaceType } from '@harrow/shared';

export const PHYSICAL_INDEX_NAME = 'physical_index' as const;
export const PHYSICAL_INDEX_VERSION_V1 = 'v1' as const;

/**
 * A term's contribution: the raw quantity, its normalised 0-1 position within a stated
 * reference range, and the weight applied. Published in full so a consumer can
 * reproduce the number rather than trust it (§14).
 */
export interface IndexComponent {
  term: string;
  raw: number;
  normalised: number;
  weight: number;
  contribution: number;
}

export interface PhysicalIndexResult {
  indexName: string;
  version: string;
  surfaceType: SurfaceType;
  value: number;
  components: IndexComponent[];
}

export interface PhysicalIndexInput {
  surfaceType: SurfaceType;
  /** N/mm, from derivation. */
  baseHardness: number;
  /** mm, from derivation. */
  cushionDepth: number;
  /** dimensionless ratio, from derivation. */
  transitionSharpness: number;
  /** volumetric water content as a fraction, 0-1. */
  vwc: number;
  surfaceTempC: number;
}

interface TermSpec {
  /** Reference range for normalisation: [low, high] in the term's own units. */
  range: readonly [number, number];
  /** Signed weight. Positive means "more of this reads as firmer". */
  weight: number;
  /** Why this weight, in mechanics. Published with the index. */
  rationale: string;
}

type SurfaceSpec = Readonly<Record<string, TermSpec>>;

/**
 * DIRT
 *
 * A dirt track is a loose cushion harrowed over a compacted base. The horse's forelimb
 * loads through the cushion into the base, so base hardness dominates the impact the
 * limb actually sees. Cushion depth cuts the other way: a deeper cushion absorbs load
 * and adds drag, so it reads as less firm. Moisture in dirt is strongly non-monotonic
 * in reality — bone dry is loose and unstable, damp is cohesive and fast, saturated is
 * deep and slow — and v1 models only the wet-side effect, which is the one that
 * dominates in the range where racing actually happens. That simplification is stated
 * here rather than hidden, and it is a leading candidate for what v2 fixes.
 */
const DIRT: SurfaceSpec = {
  baseHardness: {
    range: [2, 30],
    weight: 0.45,
    rationale:
      'The base carries the load once the cushion is displaced; it sets the impact ' +
      'the forelimb experiences. Largest single term on dirt.',
  },
  cushionDepth: {
    range: [40, 130],
    weight: -0.25,
    rationale:
      'Deeper cushion absorbs energy and adds drag. Negative: more cushion reads as ' +
      'less firm.',
  },
  transitionSharpness: {
    range: [1, 12],
    weight: 0.1,
    rationale:
      'An abrupt cushion-to-base boundary transfers load suddenly. Weighted lightly ' +
      'because the mechanical consequence is real but the magnitude is not established.',
  },
  vwc: {
    range: [0.05, 0.35],
    weight: -0.2,
    rationale:
      'Over the wet half of the range, added water deepens and softens the cushion. ' +
      'v1 models only this side; see the note above.',
  },
};

/**
 * TURF
 *
 * Turf is a root-bound sod over soil. There is no harrowed cushion to speak of, so
 * penetration resistance is dominated by soil moisture — which is exactly what the
 * GoingStick measures and why it works at all. Base hardness still matters but the
 * shallow layer is thin, so cushion depth carries little weight.
 */
const TURF: SurfaceSpec = {
  baseHardness: {
    range: [4, 40],
    weight: 0.35,
    rationale: 'Soil resistance below the sod. Firm ground is stiff ground.',
  },
  cushionDepth: {
    range: [10, 60],
    weight: -0.1,
    rationale:
      'Turf has a thin loose layer rather than a prepared cushion, so this term is ' +
      'small by construction.',
  },
  transitionSharpness: {
    range: [1, 8],
    weight: 0.05,
    rationale: 'Sod-to-soil boundary is weakly defined on turf. Nearly a rounding term.',
  },
  vwc: {
    range: [0.1, 0.45],
    weight: -0.5,
    rationale:
      'Water content dominates turf going. This is the single largest weight in any ' +
      'surface spec, and it is why a moisture-blind turf index would be worthless.',
  },
};

/**
 * SYNTHETIC
 *
 * A wax-coated synthetic surface behaves as a viscoelastic composite. Its stiffness is
 * temperature-dependent because the wax binder softens as it warms — this is the
 * defining mechanical property of the surface type and the reason a single scale
 * across all three surfaces is indefensible. Moisture matters far less: these surfaces
 * are engineered to drain and the wax is hydrophobic.
 */
const SYNTHETIC: SurfaceSpec = {
  baseHardness: {
    range: [3, 25],
    weight: 0.4,
    rationale: 'Stiffness of the compacted composite below the loose surface layer.',
  },
  cushionDepth: {
    range: [50, 140],
    weight: -0.2,
    rationale: 'A deeper loose layer absorbs more energy, as on dirt.',
  },
  transitionSharpness: {
    range: [1, 10],
    weight: 0.1,
    rationale: 'Engineered surfaces have a more uniform profile; boundary is less abrupt.',
  },
  surfaceTempC: {
    range: [0, 35],
    weight: -0.3,
    rationale:
      'Wax binder softens with temperature, so the same surface is measurably less ' +
      'firm when warm. No other surface type carries a temperature term.',
  },
};

export const PHYSICAL_INDEX_V1_SPEC: Readonly<Record<SurfaceType, SurfaceSpec>> = Object.freeze({
  DIRT,
  TURF,
  SYNTHETIC,
});

function normalise(value: number, [low, high]: readonly [number, number]): number {
  if (high === low) return 0;
  const t = (value - low) / (high - low);
  return Math.min(1, Math.max(0, t));
}

function pick(input: PhysicalIndexInput, term: string): number {
  switch (term) {
    case 'baseHardness':
      return input.baseHardness;
    case 'cushionDepth':
      return input.cushionDepth;
    case 'transitionSharpness':
      return input.transitionSharpness;
    case 'vwc':
      return input.vwc;
    case 'surfaceTempC':
      return input.surfaceTempC;
    default:
      throw new Error(`physical_index_v1 has no term "${term}"`);
  }
}

/**
 * Compute physical_index_v1.
 *
 * Weighted sum of normalised terms, rescaled so that the theoretical minimum of the
 * spec maps to 0 and the theoretical maximum to 10. The rescaling is derived from the
 * weights rather than tuned, so the endpoints mean the same thing on every surface
 * type even though the scales are not comparable across them.
 */
export function physicalIndexV1(input: PhysicalIndexInput): PhysicalIndexResult {
  const spec = PHYSICAL_INDEX_V1_SPEC[input.surfaceType];

  const components: IndexComponent[] = Object.entries(spec).map(([term, s]) => {
    const raw = pick(input, term);
    const normalised = normalise(raw, s.range);
    return {
      term,
      raw,
      normalised,
      weight: s.weight,
      contribution: normalised * s.weight,
    };
  });

  const total = components.reduce((a, c) => a + c.contribution, 0);
  const minTotal = Object.values(spec).reduce((a, s) => a + Math.min(0, s.weight), 0);
  const maxTotal = Object.values(spec).reduce((a, s) => a + Math.max(0, s.weight), 0);
  const value = ((total - minTotal) / (maxTotal - minTotal)) * 10;

  return {
    indexName: PHYSICAL_INDEX_NAME,
    version: PHYSICAL_INDEX_VERSION_V1,
    surfaceType: input.surfaceType,
    value: Number(value.toFixed(4)),
    components,
  };
}

/** The published rationale table, for the docs and the API's `/index/spec` endpoint. */
export function physicalIndexV1Spec(): Array<{
  surfaceType: SurfaceType;
  term: string;
  range: readonly [number, number];
  weight: number;
  rationale: string;
}> {
  return (Object.keys(PHYSICAL_INDEX_V1_SPEC) as SurfaceType[]).flatMap((surfaceType) =>
    Object.entries(PHYSICAL_INDEX_V1_SPEC[surfaceType]).map(([term, s]) => ({
      surfaceType,
      term,
      range: s.range,
      weight: s.weight,
      rationale: s.rationale,
    })),
  );
}
