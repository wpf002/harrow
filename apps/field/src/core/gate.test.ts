import { describe, expect, test } from 'vitest';

import { GOOD_FIX, POOR_FIX, layeredCurve, raggedDrive, steadyDrive } from './fixtures.js';
import { DEFAULT_GATES, gateCapture, gateGps, override } from './gate.js';

describe('GPS gate', () => {
  test('a good fix passes', () => {
    expect(gateGps(GOOD_FIX).verdict).toBe('ACCEPT');
  });

  test('a poor fix blocks, and says so before the probe goes in', () => {
    const r = gateGps(POOR_FIX);
    expect(r.verdict).toBe('BLOCKED');
    expect(r.flags).toContain('GPS_POOR');
    expect(r.overridable).toBe(true);
  });

  test('no fix at all blocks with a distinct flag', () => {
    expect(gateGps(null).flags).toContain('GPS_MISSING');
  });

  test('an override records that it was overridden (§13)', () => {
    const r = override(gateGps(POOR_FIX));
    expect(r.verdict).toBe('ACCEPT');
    expect(r.flags).toEqual(expect.arrayContaining(['GPS_POOR', 'MANUAL_OVERRIDE']));
  });

  test('a clean gate cannot be overridden — there is nothing to override', () => {
    expect(() => override(gateGps(GOOD_FIX))).toThrow();
  });
});

describe('capture gate', () => {
  test('a clean curve at target rate is accepted', () => {
    const r = gateCapture(layeredCurve(), steadyDrive());
    expect(r.verdict).toBe('ACCEPT');
    expect(r.flags).toEqual([]);
  });

  test('a ragged drive is a retake, not a block', () => {
    const r = gateCapture(layeredCurve(), raggedDrive());
    expect(r.verdict).toBe('RETAKE');
    expect(r.flags).toContain('RATE_OUTLIER');
  });

  test('a drive at the wrong mean rate is caught even when perfectly steady', () => {
    const r = gateCapture(layeredCurve(), steadyDrive(240, 60));
    expect(r.flags).toContain('RATE_OUTLIER');
    expect(r.reasons.join(' ')).toMatch(/drive rate/i);
  });

  test('a saturated load cell is caught', () => {
    const r = gateCapture(layeredCurve(60, 40), steadyDrive());
    expect(r.flags).toContain('FORCE_SATURATED');
  });

  test('a truncated traverse is caught', () => {
    const short = layeredCurve();
    const depthMm = short.depthMm.slice(0, 60).map((d) => d * 0.2);
    const forceN = short.forceN.slice(0, 60);
    const r = gateCapture({ depthMm, forceN }, steadyDrive(60));
    expect(r.flags).toContain('CURVE_TRUNCATED');
  });

  test('thresholds are injectable so a lab rig can differ from a track', () => {
    const strict = { ...DEFAULT_GATES, minPenetrationMm: 500 };
    expect(gateCapture(layeredCurve(), steadyDrive(), strict).flags).toContain('CURVE_TRUNCATED');
  });
});
