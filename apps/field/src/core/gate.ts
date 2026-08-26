/**
 * Capture-time gates (§13).
 *
 * Two things must be caught while the operator is still standing at the point, because
 * afterwards the only remedy is a missing reading:
 *
 *   - GPS accuracy below threshold. Refuse to record without an explicit override, and
 *     an override sets a quality flag rather than silently passing.
 *   - Rate outliers. Reject and offer a retake on fresh ground.
 *
 * Nothing here discards data. A gate decides whether the operator is told to try again;
 * the reading is stored either way (§2.1).
 */
import {
  driveRateVariability,
  meanDriveRateMmS,
  peakForceN,
  penetrationDepthMm,
  type DriveRateProfile,
  type ForceDepthCurve,
  type QualityFlag,
} from '@harrow/shared';

export interface GateThresholds {
  /** Metres. Sub-metre matters: rail, mid and outside are different surfaces. */
  gpsAccuracyM: number;
  /** Target drive rate, mm/s. 20 mm/s follows cone penetrometer practice. */
  targetRateMmS: number;
  /** Fractional tolerance on mean rate. */
  rateTolerance: number;
  /** Coefficient of variation of instantaneous rate above which the drive was ragged. */
  maxRateCv: number;
  minPenetrationMm: number;
  minSamples: number;
  forceSaturationN: number;
}

export const DEFAULT_GATES: GateThresholds = {
  gpsAccuracyM: 1.0,
  targetRateMmS: 20,
  rateTolerance: 0.2,
  maxRateCv: 0.35,
  minPenetrationMm: 40,
  minSamples: 50,
  forceSaturationN: 2000,
};

export type GateVerdict = 'ACCEPT' | 'RETAKE' | 'BLOCKED';

export interface GateResult {
  verdict: GateVerdict;
  reasons: string[];
  /** Flags to attach to the reading if it is stored despite the verdict. */
  flags: QualityFlag[];
  /** True when an operator override could turn BLOCKED into a flagged accept. */
  overridable: boolean;
}

export interface GpsFix {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

/**
 * The GPS gate. Runs before capture, not after — there is no point driving a probe if
 * the reading cannot be placed on the track.
 */
export function gateGps(
  fix: GpsFix | null,
  thresholds: GateThresholds = DEFAULT_GATES,
): GateResult {
  if (fix === null || fix.accuracy === null) {
    return {
      verdict: 'BLOCKED',
      reasons: ['No GPS fix. A reading with no position cannot be assigned to a path segment.'],
      flags: ['GPS_MISSING'],
      overridable: true,
    };
  }
  if (fix.accuracy > thresholds.gpsAccuracyM) {
    return {
      verdict: 'BLOCKED',
      reasons: [
        `GPS accuracy ${fix.accuracy.toFixed(1)} m is worse than the ${thresholds.gpsAccuracyM} m ` +
          'threshold. Wait for a better fix, or override.',
      ],
      flags: ['GPS_POOR'],
      overridable: true,
    };
  }
  return { verdict: 'ACCEPT', reasons: [], flags: [], overridable: false };
}

/**
 * Applying an operator override.
 *
 * The override is recorded as `MANUAL_OVERRIDE` alongside the flag that caused the
 * block. A reading that only got captured because someone insisted must be
 * distinguishable later from one that passed cleanly.
 */
export function override(result: GateResult): GateResult {
  if (!result.overridable) {
    throw new Error('this gate result cannot be overridden');
  }
  return {
    verdict: 'ACCEPT',
    reasons: result.reasons,
    flags: [...result.flags, 'MANUAL_OVERRIDE'],
    overridable: false,
  };
}

/**
 * The capture gate: judge a curve the moment the traverse finishes.
 *
 * A ragged drive is a RETAKE rather than a BLOCK, because the remedy is another attempt
 * on fresh ground and the operator is standing right there.
 */
export function gateCapture(
  curve: ForceDepthCurve,
  drive: DriveRateProfile,
  thresholds: GateThresholds = DEFAULT_GATES,
): GateResult {
  const reasons: string[] = [];
  const flags: QualityFlag[] = [];

  const n = curve.depthMm.length;
  if (n < thresholds.minSamples) {
    reasons.push(`Only ${n} samples; expected at least ${thresholds.minSamples}.`);
    flags.push('CURVE_TOO_SHORT');
  }

  const depth = penetrationDepthMm(curve);
  if (depth < thresholds.minPenetrationMm) {
    reasons.push(
      `Reached only ${depth.toFixed(0)} mm; expected ${thresholds.minPenetrationMm} mm.`,
    );
    flags.push('CURVE_TRUNCATED');
  }

  const peak = peakForceN(curve);
  if (peak >= thresholds.forceSaturationN) {
    reasons.push(
      `Peak force ${peak.toFixed(0)} N hit the load cell ceiling — the curve is clipped.`,
    );
    flags.push('FORCE_SATURATED');
  }

  const rate = meanDriveRateMmS(drive);
  const lo = thresholds.targetRateMmS * (1 - thresholds.rateTolerance);
  const hi = thresholds.targetRateMmS * (1 + thresholds.rateTolerance);
  const cv = driveRateVariability(drive);

  if (rate < lo || rate > hi) {
    reasons.push(
      `Mean drive rate ${rate.toFixed(1)} mm/s is outside ${lo.toFixed(0)}–${hi.toFixed(0)} mm/s.`,
    );
    flags.push('RATE_OUTLIER');
  } else if (cv > thresholds.maxRateCv) {
    reasons.push(`Drive was ragged (rate CV ${cv.toFixed(2)}). Steady traverse, no pausing.`);
    flags.push('RATE_OUTLIER');
  }

  return {
    verdict: reasons.length === 0 ? 'ACCEPT' : 'RETAKE',
    reasons,
    flags,
    overridable: false,
  };
}
