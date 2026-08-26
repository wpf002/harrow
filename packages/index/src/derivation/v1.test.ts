import { describe, expect, test } from 'vitest';
import { DerivationError, deriveV1 } from './v1.js';

/** A textbook two-layer surface: soft cushion to `kneeMm`, stiff base below. */
function layered(kneeMm: number, cushionSlope: number, baseSlope: number, n = 200, noise = 0) {
  const depthMm = new Float64Array(n);
  const forceN = new Float64Array(n);
  let rng = 42;
  const rand = () => {
    rng = (rng * 1103515245 + 12345) % 2147483648;
    return rng / 2147483648 - 0.5;
  };
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * 200;
    depthMm[i] = d;
    const f = d < kneeMm ? d * cushionSlope : kneeMm * cushionSlope + (d - kneeMm) * baseSlope;
    forceN[i] = f + rand() * noise;
  }
  return { depthMm, forceN };
}

const steadyDrive = (n = 200) => ({
  timeMs: Float64Array.from({ length: n }, (_, i) => i * 10),
  depthMm: Float64Array.from({ length: n }, (_, i) => (i / (n - 1)) * 200),
});

describe('two-segment fit', () => {
  test('recovers a clean breakpoint', () => {
    const d = deriveV1(layered(80, 1.5, 12), steadyDrive());
    expect(d.cushionDepth).toBeCloseTo(80, 0);
    expect(d.cushionStiffness).toBeCloseTo(1.5, 1);
    expect(d.baseHardness).toBeCloseTo(12, 1);
    expect(d.transitionSharpness).toBeCloseTo(8, 0);
    expect(d.fitRmseN).toBeLessThan(1);
  });

  test('recovers the breakpoint under noise', () => {
    const d = deriveV1(layered(60, 2, 14, 400, 8), steadyDrive(400));
    expect(d.cushionDepth).toBeGreaterThan(50);
    expect(d.cushionDepth).toBeLessThan(70);
    expect(d.baseHardness / d.cushionStiffness).toBeGreaterThan(4);
  });

  test('a shallow cushion and a deep cushion are distinguished', () => {
    const shallow = deriveV1(layered(40, 2, 12), steadyDrive());
    const deep = deriveV1(layered(120, 2, 12), steadyDrive());
    expect(deep.cushionDepth).toBeGreaterThan(shallow.cushionDepth + 50);
  });

  test('this is what a scalar penetrometer cannot see', () => {
    // Two surfaces, deliberately constructed to reach the same peak force at the same
    // depth by different routes: shallow cushion over a soft base, versus deep cushion
    // over a hard base. A drop-mass device reports one number for both.
    const a = deriveV1(layered(40, 2, 8.5), steadyDrive());
    const b = deriveV1(layered(120, 1 / 3, 17.5), steadyDrive());
    expect(Math.abs(a.peakForceN - b.peakForceN) / a.peakForceN).toBeLessThan(0.01);
    expect(b.cushionDepth).toBeGreaterThan(a.cushionDepth * 2);
    expect(b.baseHardness).toBeGreaterThan(a.baseHardness * 2);
  });
});

describe('guards', () => {
  test('refuses a curve too short to locate a transition', () => {
    const depthMm = new Float64Array([0, 10, 20, 30]);
    const forceN = new Float64Array([0, 5, 10, 15]);
    expect(() => deriveV1({ depthMm, forceN }, { timeMs: depthMm, depthMm })).toThrow(
      DerivationError,
    );
  });

  test('reports sharpness of zero rather than Infinity on a degenerate cushion', () => {
    // Flat then rising: the lower segment has no slope at all.
    const n = 100;
    const depthMm = Float64Array.from({ length: n }, (_, i) => i);
    const forceN = Float64Array.from({ length: n }, (_, i) => (i < 50 ? 0 : (i - 50) * 5));
    const d = deriveV1({ depthMm, forceN }, { timeMs: depthMm, depthMm });
    expect(Number.isFinite(d.transitionSharpness)).toBe(true);
  });

  test('is deterministic', () => {
    const c = layered(70, 2, 10, 300, 5);
    expect(deriveV1(c, steadyDrive(300))).toEqual(deriveV1(c, steadyDrive(300)));
  });
});
