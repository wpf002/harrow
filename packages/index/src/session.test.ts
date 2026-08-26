import { describe, expect, test } from 'vitest';
import type { QualityFlag } from '@harrow/shared';
import {
  computeSessionPhysicalIndexV1,
  InsufficientReadingsError,
  MIN_ELIGIBLE_READINGS,
} from './session.js';

function reading(i: number, flags: QualityFlag[] = [], overrides: Record<string, number> = {}) {
  return {
    readingId: `r${i}`,
    qualityFlags: flags,
    derivationVersion: 'derivation_v1',
    baseHardness: 16,
    cushionDepth: 85,
    transitionSharpness: 6,
    vwc: 0.2,
    surfaceTempC: 18,
    ...overrides,
  };
}

const clean = Array.from({ length: 20 }, (_, i) => reading(i));

describe('eligibility', () => {
  test('an uncalibrated reading is excluded and counted, not dropped silently', () => {
    const readings = [...clean, reading(90, ['UNCALIBRATED']), reading(91, ['UNCALIBRATED'])];
    const r = computeSessionPhysicalIndexV1('DIRT', readings);
    expect(r.readingsUsed).toBe(20);
    expect(r.readingsExcluded).toBe(2);
    expect(r.excludedByFlag.UNCALIBRATED).toBe(2);
  });

  test('cosmetic flags do not exclude a reading', () => {
    const r = computeSessionPhysicalIndexV1('DIRT', [...clean, reading(92, ['GPS_POOR'])]);
    expect(r.readingsUsed).toBe(21);
    expect(r.readingsExcluded).toBe(0);
  });

  test('too few eligible readings yields no index at all', () => {
    const readings = Array.from({ length: MIN_ELIGIBLE_READINGS - 1 }, (_, i) => reading(i));
    expect(() => computeSessionPhysicalIndexV1('DIRT', readings)).toThrow(
      InsufficientReadingsError,
    );
  });

  test('a session of entirely flagged readings yields no index', () => {
    const readings = Array.from({ length: 20 }, (_, i) => reading(i, ['RATE_OUTLIER']));
    expect(() => computeSessionPhysicalIndexV1('DIRT', readings)).toThrow(
      InsufficientReadingsError,
    );
  });

  test('mixed derivation versions are refused rather than averaged', () => {
    const readings = [...clean, { ...reading(93), derivationVersion: 'derivation_v2' }];
    expect(() => computeSessionPhysicalIndexV1('DIRT', readings)).toThrow(/mixes derivation/);
  });
});

describe('aggregation', () => {
  test('a single wild reading does not move the session value', () => {
    const withOutlier = [...clean, reading(94, [], { baseHardness: 999, vwc: 0 })];
    expect(computeSessionPhysicalIndexV1('DIRT', withOutlier).value).toBeCloseTo(
      computeSessionPhysicalIndexV1('DIRT', clean).value,
      2,
    );
  });

  test('spread across readings is always reported', () => {
    const varied = Array.from({ length: 20 }, (_, i) =>
      reading(i, [], { baseHardness: 10 + i * 0.8 }),
    );
    const r = computeSessionPhysicalIndexV1('DIRT', varied);
    expect(r.medianAbsoluteDeviation).toBeGreaterThan(0);
    expect(computeSessionPhysicalIndexV1('DIRT', clean).medianAbsoluteDeviation).toBe(0);
  });
});

describe('provenance', () => {
  test('the same readings in any order produce the same hash', () => {
    const a = computeSessionPhysicalIndexV1('DIRT', clean);
    const b = computeSessionPhysicalIndexV1('DIRT', [...clean].reverse());
    expect(a.inputsHash).toBe(b.inputsHash);
    expect(a.value).toBe(b.value);
  });

  test('a different reading set produces a different hash', () => {
    const a = computeSessionPhysicalIndexV1('DIRT', clean);
    const b = computeSessionPhysicalIndexV1('DIRT', [...clean, reading(95)]);
    expect(a.inputsHash).not.toBe(b.inputsHash);
  });

  test('surface type is part of the identity of the value', () => {
    const dirt = computeSessionPhysicalIndexV1('DIRT', clean);
    const turf = computeSessionPhysicalIndexV1('TURF', clean);
    expect(dirt.inputsHash).not.toBe(turf.inputsHash);
    expect(dirt.value).not.toBe(turf.value);
  });
});
