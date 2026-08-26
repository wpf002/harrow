import { describe, expect, test } from 'vitest';
import {
  physicalIndexV1,
  physicalIndexV1Spec,
  PHYSICAL_INDEX_V1_SPEC,
  PHYSICAL_INDEX_VERSION_V1,
} from './v1.js';

const dirt = {
  surfaceType: 'DIRT' as const,
  baseHardness: 16,
  cushionDepth: 85,
  transitionSharpness: 6,
  vwc: 0.2,
  surfaceTempC: 18,
};

describe('scale', () => {
  test('lands inside 0-10', () => {
    expect(physicalIndexV1(dirt).value).toBeGreaterThanOrEqual(0);
    expect(physicalIndexV1(dirt).value).toBeLessThanOrEqual(10);
  });

  test('theoretical extremes map to the endpoints', () => {
    const firmest = physicalIndexV1({
      surfaceType: 'DIRT',
      baseHardness: 999,
      cushionDepth: 0,
      transitionSharpness: 999,
      vwc: 0,
      surfaceTempC: 0,
    });
    const softest = physicalIndexV1({
      surfaceType: 'DIRT',
      baseHardness: 0,
      cushionDepth: 999,
      transitionSharpness: 0,
      vwc: 1,
      surfaceTempC: 0,
    });
    expect(firmest.value).toBeCloseTo(10, 3);
    expect(softest.value).toBeCloseTo(0, 3);
  });

  test('out-of-range inputs clamp rather than extrapolate', () => {
    const a = physicalIndexV1({ ...dirt, baseHardness: 30 });
    const b = physicalIndexV1({ ...dirt, baseHardness: 3000 });
    expect(a.value).toBeCloseTo(b.value, 6);
  });
});

describe('direction of every term', () => {
  test('a harder base reads firmer', () => {
    expect(physicalIndexV1({ ...dirt, baseHardness: 25 }).value).toBeGreaterThan(
      physicalIndexV1({ ...dirt, baseHardness: 6 }).value,
    );
  });

  test('a deeper cushion reads less firm', () => {
    expect(physicalIndexV1({ ...dirt, cushionDepth: 120 }).value).toBeLessThan(
      physicalIndexV1({ ...dirt, cushionDepth: 50 }).value,
    );
  });

  test('more water reads less firm', () => {
    expect(physicalIndexV1({ ...dirt, vwc: 0.32 }).value).toBeLessThan(
      physicalIndexV1({ ...dirt, vwc: 0.08 }).value,
    );
  });

  test('temperature moves synthetic and nothing else', () => {
    const cold = { ...dirt, surfaceType: 'SYNTHETIC' as const, surfaceTempC: 2 };
    const hot = { ...cold, surfaceTempC: 32 };
    expect(physicalIndexV1(cold).value).toBeGreaterThan(physicalIndexV1(hot).value);

    const dirtCold = physicalIndexV1({ ...dirt, surfaceTempC: 2 }).value;
    const dirtHot = physicalIndexV1({ ...dirt, surfaceTempC: 32 }).value;
    expect(dirtCold).toBe(dirtHot);
  });
});

describe('three scales, never merged', () => {
  test('identical inputs give different values per surface type', () => {
    const shared = {
      baseHardness: 14,
      cushionDepth: 80,
      transitionSharpness: 5,
      vwc: 0.25,
      surfaceTempC: 15,
    };
    const values = (['DIRT', 'TURF', 'SYNTHETIC'] as const).map(
      (surfaceType) => physicalIndexV1({ ...shared, surfaceType }).value,
    );
    expect(new Set(values).size).toBe(3);
  });

  test('turf weights moisture most heavily; synthetic alone has a temperature term', () => {
    expect(Math.abs(PHYSICAL_INDEX_V1_SPEC.TURF.vwc!.weight)).toBeGreaterThan(
      Math.abs(PHYSICAL_INDEX_V1_SPEC.DIRT.vwc!.weight),
    );
    expect(PHYSICAL_INDEX_V1_SPEC.SYNTHETIC.surfaceTempC).toBeDefined();
    expect(PHYSICAL_INDEX_V1_SPEC.DIRT.surfaceTempC).toBeUndefined();
    expect(PHYSICAL_INDEX_V1_SPEC.TURF.surfaceTempC).toBeUndefined();
  });
});

describe('reproducibility and immutability', () => {
  test('components sum to the reported value', () => {
    const r = physicalIndexV1(dirt);
    const total = r.components.reduce((a, c) => a + c.contribution, 0);
    const spec = PHYSICAL_INDEX_V1_SPEC.DIRT;
    const min = Object.values(spec).reduce((a, s) => a + Math.min(0, s.weight), 0);
    const max = Object.values(spec).reduce((a, s) => a + Math.max(0, s.weight), 0);
    expect(((total - min) / (max - min)) * 10).toBeCloseTo(r.value, 3);
  });

  test('every weight carries a published rationale', () => {
    for (const row of physicalIndexV1Spec()) {
      expect(row.rationale.length).toBeGreaterThan(30);
    }
  });

  /**
   * §2.4: a published version is frozen. If this test fails, the change is not a fix -
   * it is physical_index_v2, computed alongside v1 and backfilled over retained raw.
   */
  test('v1 weights are frozen', () => {
    expect(PHYSICAL_INDEX_VERSION_V1).toBe('v1');
    const weights = Object.fromEntries(
      physicalIndexV1Spec().map((r) => [`${r.surfaceType}.${r.term}`, r.weight]),
    );
    expect(weights).toEqual({
      'DIRT.baseHardness': 0.45,
      'DIRT.cushionDepth': -0.25,
      'DIRT.transitionSharpness': 0.1,
      'DIRT.vwc': -0.2,
      'TURF.baseHardness': 0.35,
      'TURF.cushionDepth': -0.1,
      'TURF.transitionSharpness': 0.05,
      'TURF.vwc': -0.5,
      'SYNTHETIC.baseHardness': 0.4,
      'SYNTHETIC.cushionDepth': -0.2,
      'SYNTHETIC.transitionSharpness': 0.1,
      'SYNTHETIC.surfaceTempC': -0.3,
    });
  });
});
