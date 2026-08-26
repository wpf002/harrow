import { describe, expect, test } from 'vitest';
import { blocksIndexComputation, computeQualityFlags, DEFAULT_THRESHOLDS } from './quality.js';

function goodCurve(n = 200, maxForce = 900) {
  const depthMm = new Float64Array(n);
  const forceN = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    depthMm[i] = (i / (n - 1)) * 160;
    forceN[i] = (i / (n - 1)) * maxForce;
  }
  return { depthMm, forceN };
}

function steadyDrive(n = 200) {
  const timeMs = new Float64Array(n);
  const depthMm = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    timeMs[i] = i * 10;
    depthMm[i] = (i / (n - 1)) * 160;
  }
  return { timeMs, depthMm };
}

const clean = {
  curve: goodCurve(),
  driveRate: steadyDrive(),
  gpsAccuracy: 0.4,
  hasCalibration: true,
  vwc: 0.28,
  surfaceTempC: 14,
};

describe('flagging', () => {
  test('a clean reading carries no flags', () => {
    expect(computeQualityFlags(clean)).toEqual([]);
  });

  test('missing calibration flags but does not reject (§2.5)', () => {
    const flags = computeQualityFlags({ ...clean, hasCalibration: false });
    expect(flags).toContain('UNCALIBRATED');
    expect(blocksIndexComputation(flags)).toBe(true);
  });

  test('an expired calibration is distinct from no calibration', () => {
    const flags = computeQualityFlags({ ...clean, calibrationExpired: true });
    expect(flags).toEqual(['CALIBRATION_EXPIRED']);
    expect(flags).not.toContain('UNCALIBRATED');
  });

  test('poor and missing GPS are separate facts', () => {
    expect(computeQualityFlags({ ...clean, gpsAccuracy: 3.5 })).toContain('GPS_POOR');
    expect(computeQualityFlags({ ...clean, gpsAccuracy: null })).toContain('GPS_MISSING');
  });

  test('a saturated load cell is flagged', () => {
    const flags = computeQualityFlags({
      ...clean,
      curve: goodCurve(200, DEFAULT_THRESHOLDS.forceSaturationN + 10),
    });
    expect(flags).toContain('FORCE_SATURATED');
  });

  test('a short curve is both too short and truncated', () => {
    const depthMm = new Float64Array([0, 10, 20]);
    const forceN = new Float64Array([0, 50, 90]);
    const flags = computeQualityFlags({ ...clean, curve: { depthMm, forceN } });
    expect(flags).toContain('CURVE_TOO_SHORT');
    expect(flags).toContain('CURVE_TRUNCATED');
  });

  test('a ragged drive is a rate outlier (§2.7)', () => {
    const timeMs = new Float64Array([0, 100, 200, 300, 400, 500]);
    const depthMm = new Float64Array([0, 60, 62, 130, 132, 160]);
    const flags = computeQualityFlags({ ...clean, driveRate: { timeMs, depthMm } });
    expect(flags).toContain('RATE_OUTLIER');
  });

  test('out-of-range environment values are flagged', () => {
    expect(computeQualityFlags({ ...clean, vwc: 0.95 })).toContain('VWC_OUT_OF_RANGE');
    expect(computeQualityFlags({ ...clean, surfaceTempC: 120 })).toContain(
      'TEMPERATURE_OUT_OF_RANGE',
    );
  });

  test('flags are sorted and deduplicated', () => {
    const flags = computeQualityFlags({ ...clean, hasCalibration: false, gpsAccuracy: null });
    expect(flags).toEqual([...flags].sort());
    expect(new Set(flags).size).toBe(flags.length);
  });
});

describe('index eligibility', () => {
  test('cosmetic flags do not block index computation', () => {
    expect(blocksIndexComputation(['GPS_POOR'])).toBe(false);
    expect(blocksIndexComputation(['VWC_OUT_OF_RANGE'])).toBe(false);
  });

  test('flags that mean the reading did not measure the surface do block it', () => {
    expect(blocksIndexComputation(['FORCE_SATURATED'])).toBe(true);
    expect(blocksIndexComputation(['RATE_OUTLIER'])).toBe(true);
    expect(blocksIndexComputation([])).toBe(false);
  });
});
