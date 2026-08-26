/**
 * Curve codec.
 *
 * The binary layout is fixed by the Phase 5 benchmark (docs/curve-storage-benchmark.md):
 * little-endian IEEE-754 float64, interleaved pairs, no header, no padding.
 *
 * Rule §2.1: this is the permanent representation. Nothing in this module downsamples,
 * smooths, or reinterpolates. Decoding a curve and re-encoding it must be the identity.
 */

export const FORCE_DEPTH_ENCODING = 'f64le-interleaved-depth_mm-force_n-v1' as const;
export const DRIVE_RATE_ENCODING = 'f64le-interleaved-t_ms-depth_mm-v1' as const;

export type CurveEncoding = typeof FORCE_DEPTH_ENCODING | typeof DRIVE_RATE_ENCODING;

/** A force-depth curve: parallel arrays, always the same length. */
export interface ForceDepthCurve {
  readonly depthMm: Float64Array;
  readonly forceN: Float64Array;
}

/** Operator telemetry: how fast the probe was driven (§2.7). */
export interface DriveRateProfile {
  readonly timeMs: Float64Array;
  readonly depthMm: Float64Array;
}

export class CurveError extends Error {}

function encodePairs(a: Float64Array, b: Float64Array): Uint8Array {
  if (a.length !== b.length) {
    throw new CurveError(`interleaved arrays must be equal length: ${a.length} vs ${b.length}`);
  }
  const out = new Float64Array(a.length * 2);
  for (let i = 0; i < a.length; i++) {
    out[i * 2] = a[i]!;
    out[i * 2 + 1] = b[i]!;
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

function decodePairs(
  bytes: Uint8Array<ArrayBufferLike>,
  sampleCount: number,
): [Float64Array, Float64Array] {
  const expected = sampleCount * 2 * 8;
  if (bytes.byteLength !== expected) {
    throw new CurveError(
      `curve is ${bytes.byteLength} bytes, expected ${expected} for ${sampleCount} samples`,
    );
  }
  // The source buffer may be a slice of a larger one, and may be misaligned for a
  // Float64Array view; copy rather than assume.
  const copy = new Uint8Array(bytes);
  const flat = new Float64Array(copy.buffer, copy.byteOffset, sampleCount * 2);
  const a = new Float64Array(sampleCount);
  const b = new Float64Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    a[i] = flat[i * 2]!;
    b[i] = flat[i * 2 + 1]!;
  }
  return [a, b];
}

export function encodeForceDepth(curve: ForceDepthCurve): Uint8Array {
  return encodePairs(curve.depthMm, curve.forceN);
}

export function decodeForceDepth(
  bytes: Uint8Array<ArrayBufferLike>,
  sampleCount: number,
): ForceDepthCurve {
  const [depthMm, forceN] = decodePairs(bytes, sampleCount);
  return { depthMm, forceN };
}

export function encodeDriveRate(profile: DriveRateProfile): Uint8Array {
  return encodePairs(profile.timeMs, profile.depthMm);
}

export function decodeDriveRate(
  bytes: Uint8Array<ArrayBufferLike>,
  sampleCount: number,
): DriveRateProfile {
  const [timeMs, depthMm] = decodePairs(bytes, sampleCount);
  return { timeMs, depthMm };
}

export function sampleCount(curve: ForceDepthCurve | DriveRateProfile): number {
  return 'forceN' in curve ? curve.forceN.length : curve.timeMs.length;
}

/**
 * Structural checks on a decoded curve. These are not quality flags — they are the
 * difference between a curve and a pile of numbers. A curve that fails here is
 * malformed and is rejected at ingest rather than flagged.
 */
export function assertWellFormed(curve: ForceDepthCurve): void {
  const n = curve.depthMm.length;
  if (n < 2) throw new CurveError('curve needs at least 2 samples');
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(curve.depthMm[i]!) || !Number.isFinite(curve.forceN[i]!)) {
      throw new CurveError(`non-finite sample at index ${i}`);
    }
  }
  for (let i = 1; i < n; i++) {
    if (curve.depthMm[i]! < curve.depthMm[i - 1]!) {
      throw new CurveError(`depth is not monotonic at index ${i}`);
    }
  }
}

/** Peak force reached anywhere on the curve, in newtons. */
export function peakForceN(curve: ForceDepthCurve): number {
  let max = -Infinity;
  for (const f of curve.forceN) if (f > max) max = f;
  return max;
}

/** Deepest sample, in millimetres. */
export function penetrationDepthMm(curve: ForceDepthCurve): number {
  return curve.depthMm[curve.depthMm.length - 1] ?? 0;
}

/**
 * Work done driving the probe, in joules: the integral of force over depth.
 * Trapezoidal, because the samples are what we have and fitting a model to them here
 * would make a derived quantity depend on an unstated choice.
 */
export function workJ(curve: ForceDepthCurve): number {
  let sum = 0;
  for (let i = 1; i < curve.depthMm.length; i++) {
    const dz = (curve.depthMm[i]! - curve.depthMm[i - 1]!) / 1000; // mm -> m
    sum += ((curve.forceN[i]! + curve.forceN[i - 1]!) / 2) * dz;
  }
  return sum;
}

/** Mean drive rate in mm/s over the whole insertion. */
export function meanDriveRateMmS(profile: DriveRateProfile): number {
  const n = profile.timeMs.length;
  if (n < 2) return 0;
  const dt = (profile.timeMs[n - 1]! - profile.timeMs[0]!) / 1000;
  if (dt <= 0) return 0;
  return (profile.depthMm[n - 1]! - profile.depthMm[0]!) / dt;
}

/** Coefficient of variation of instantaneous drive rate — how steady the operator was. */
export function driveRateVariability(profile: DriveRateProfile): number {
  const rates: number[] = [];
  for (let i = 1; i < profile.timeMs.length; i++) {
    const dt = (profile.timeMs[i]! - profile.timeMs[i - 1]!) / 1000;
    if (dt > 0) rates.push((profile.depthMm[i]! - profile.depthMm[i - 1]!) / dt);
  }
  if (rates.length < 2) return 0;
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mean === 0) return 0;
  const variance = rates.reduce((a, r) => a + (r - mean) ** 2, 0) / (rates.length - 1);
  return Math.sqrt(variance) / Math.abs(mean);
}
