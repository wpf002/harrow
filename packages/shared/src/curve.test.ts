import { describe, expect, test } from 'vitest';
import {
  assertWellFormed,
  CurveError,
  decodeDriveRate,
  decodeForceDepth,
  driveRateVariability,
  encodeDriveRate,
  encodeForceDepth,
  meanDriveRateMmS,
  peakForceN,
  penetrationDepthMm,
  workJ,
} from './curve.js';

function bilinearCurve(kneeMm = 60, n = 200) {
  const depthMm = new Float64Array(n);
  const forceN = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * 180;
    depthMm[i] = d;
    forceN[i] = d < kneeMm ? d * 2 : kneeMm * 2 + (d - kneeMm) * 10;
  }
  return { depthMm, forceN };
}

describe('codec', () => {
  test('round trip is the identity', () => {
    const curve = bilinearCurve();
    const bytes = encodeForceDepth(curve);
    const back = decodeForceDepth(bytes, curve.depthMm.length);
    expect(Array.from(back.depthMm)).toEqual(Array.from(curve.depthMm));
    expect(Array.from(back.forceN)).toEqual(Array.from(curve.forceN));
  });

  test('encodes exactly 16 bytes per sample', () => {
    expect(encodeForceDepth(bilinearCurve(60, 200)).byteLength).toBe(200 * 16);
  });

  test('a truncated payload fails rather than decoding short', () => {
    const bytes = encodeForceDepth(bilinearCurve(60, 100));
    expect(() => decodeForceDepth(bytes.slice(0, 800), 100)).toThrow(CurveError);
  });

  test('decodes from a misaligned buffer slice', () => {
    const curve = bilinearCurve(60, 10);
    const encoded = encodeForceDepth(curve);
    const padded = new Uint8Array(encoded.byteLength + 1);
    padded.set(encoded, 1);
    const back = decodeForceDepth(padded.subarray(1), 10);
    expect(back.forceN[9]).toBeCloseTo(curve.forceN[9]!, 12);
  });

  test('drive rate profile round trips', () => {
    const profile = {
      timeMs: new Float64Array([0, 100, 200]),
      depthMm: new Float64Array([0, 5, 9]),
    };
    const back = decodeDriveRate(encodeDriveRate(profile), 3);
    expect(Array.from(back.timeMs)).toEqual([0, 100, 200]);
    expect(Array.from(back.depthMm)).toEqual([0, 5, 9]);
  });
});

describe('well-formedness', () => {
  test('accepts a monotonic curve', () => {
    expect(() => assertWellFormed(bilinearCurve())).not.toThrow();
  });

  test('rejects non-monotonic depth', () => {
    const c = bilinearCurve(60, 10);
    c.depthMm[5] = 0;
    expect(() => assertWellFormed(c)).toThrow(/monotonic/);
  });

  test('rejects non-finite samples', () => {
    const c = bilinearCurve(60, 10);
    c.forceN[3] = Number.NaN;
    expect(() => assertWellFormed(c)).toThrow(/non-finite/);
  });
});

describe('scalars', () => {
  test('peak force and penetration depth read off the ends', () => {
    const c = bilinearCurve(60, 200);
    expect(peakForceN(c)).toBeCloseTo(c.forceN[199]!, 9);
    expect(penetrationDepthMm(c)).toBeCloseTo(180, 9);
  });

  test('work is the integral of force over depth', () => {
    // Constant 10 N over 100 mm = 10 N x 0.1 m = 1 J.
    const depthMm = new Float64Array([0, 100]);
    const forceN = new Float64Array([10, 10]);
    expect(workJ({ depthMm, forceN })).toBeCloseTo(1, 12);
  });

  test('mean drive rate is depth over elapsed time', () => {
    const profile = {
      timeMs: new Float64Array([0, 1000]),
      depthMm: new Float64Array([0, 150]),
    };
    expect(meanDriveRateMmS(profile)).toBeCloseTo(150, 9);
  });

  test('a perfectly steady drive has zero rate variability', () => {
    const timeMs = new Float64Array(11);
    const depthMm = new Float64Array(11);
    for (let i = 0; i <= 10; i++) {
      timeMs[i] = i * 100;
      depthMm[i] = i * 15;
    }
    expect(driveRateVariability({ timeMs, depthMm })).toBeCloseTo(0, 12);
  });

  test('a ragged drive has high rate variability', () => {
    const timeMs = new Float64Array([0, 100, 200, 300, 400]);
    const depthMm = new Float64Array([0, 40, 45, 100, 105]);
    expect(driveRateVariability({ timeMs, depthMm })).toBeGreaterThan(0.5);
  });
});
