/**
 * Derivation v1 — force-depth curve to cushion, base and transition.
 *
 * This is the computation nothing else in the market performs. Every fielded
 * instrument returns a scalar: the GoingStick returns an index, a drop-mass
 * penetrometer returns a total penetration depth. A drop mass integrates cushion and
 * base into one number by construction. A full curve does not have to.
 *
 * Physical model
 * --------------
 * A prepared racing surface is layered: a loose, low-stiffness cushion over a
 * compacted base. Driving a probe through it produces a force-depth curve with two
 * regimes — a shallow slope while the tip is in the cushion, a steep slope once it
 * engages the base — joined by a transition whose abruptness is itself informative.
 *
 * So: fit two straight lines with a shared breakpoint, choosing the breakpoint that
 * minimises total squared error. Segmented least squares, exhaustive over candidate
 * breakpoints. No smoothing, no resampling, no priors.
 *
 *   cushionDepth         breakpoint depth (mm)
 *   cushionStiffness     slope below the breakpoint (N/mm)
 *   baseHardness         slope above the breakpoint (N/mm)
 *   transitionSharpness  baseHardness / cushionStiffness (dimensionless)
 *
 * Rule §2.1: raw is untouched. This reads the curve and returns numbers; it never
 * writes back. Rule §2.4 applies to the version: v1 is frozen. An improvement is v2,
 * computed alongside, backfilled over retained raw.
 */
import {
  meanDriveRateMmS,
  peakForceN,
  penetrationDepthMm,
  workJ,
  type DriveRateProfile,
  type ForceDepthCurve,
} from '@harrow/shared';

export const DERIVATION_VERSION_V1 = 'derivation_v1' as const;

export interface DerivedValues {
  derivationVersion: string;
  cushionDepth: number;
  cushionStiffness: number;
  baseHardness: number;
  transitionSharpness: number;
  peakForceN: number;
  penetrationDepthMm: number;
  workJ: number;
  meanDriveRateMmS: number;
  /** Residual standard error of the two-segment fit, in newtons. */
  fitRmseN: number;
}

/**
 * Minimum samples either side of the breakpoint. Two points define a line exactly and
 * tell you nothing about whether it is the right line, so a segment shorter than this
 * would let noise choose the breakpoint.
 */
const MIN_SEGMENT_SAMPLES = 8;

interface LineFit {
  slope: number;
  intercept: number;
  sse: number;
}

function fitLine(x: Float64Array, y: Float64Array, from: number, to: number): LineFit {
  const n = to - from;
  let sx = 0;
  let sy = 0;
  for (let i = from; i < to; i++) {
    sx += x[i]!;
    sy += y[i]!;
  }
  const mx = sx / n;
  const my = sy / n;

  let sxx = 0;
  let sxy = 0;
  for (let i = from; i < to; i++) {
    const dx = x[i]! - mx;
    sxx += dx * dx;
    sxy += dx * (y[i]! - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;

  let sse = 0;
  for (let i = from; i < to; i++) {
    const r = y[i]! - (intercept + slope * x[i]!);
    sse += r * r;
  }
  return { slope, intercept, sse };
}

export class DerivationError extends Error {}

export function deriveV1(curve: ForceDepthCurve, driveRate: DriveRateProfile): DerivedValues {
  const n = curve.depthMm.length;
  if (n < MIN_SEGMENT_SAMPLES * 2) {
    throw new DerivationError(
      `curve has ${n} samples, need at least ${MIN_SEGMENT_SAMPLES * 2} to locate a transition`,
    );
  }

  let best: { k: number; sse: number; lower: LineFit; upper: LineFit } | null = null;
  for (let k = MIN_SEGMENT_SAMPLES; k <= n - MIN_SEGMENT_SAMPLES; k++) {
    const lower = fitLine(curve.depthMm, curve.forceN, 0, k);
    const upper = fitLine(curve.depthMm, curve.forceN, k, n);
    const sse = lower.sse + upper.sse;
    if (best === null || sse < best.sse) best = { k, sse, lower, upper };
  }
  if (best === null) throw new DerivationError('no valid breakpoint');

  // Four fitted parameters plus one breakpoint.
  const dof = Math.max(1, n - 5);
  const cushionStiffness = best.lower.slope;
  const baseHardness = best.upper.slope;

  return {
    derivationVersion: DERIVATION_VERSION_V1,
    cushionDepth: curve.depthMm[best.k]!,
    cushionStiffness,
    baseHardness,
    // A non-positive cushion slope means the two-segment model did not describe this
    // curve. Reporting Infinity would be arithmetically tidy and physically a lie, so
    // the ratio is reported as 0 and the caller sees it alongside fitRmseN.
    transitionSharpness: cushionStiffness > 0 ? baseHardness / cushionStiffness : 0,
    peakForceN: peakForceN(curve),
    penetrationDepthMm: penetrationDepthMm(curve),
    workJ: workJ(curve),
    meanDriveRateMmS: meanDriveRateMmS(driveRate),
    fitRmseN: Math.sqrt(best.sse / dof),
  };
}
