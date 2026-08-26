/**
 * Quality flags, applied at ingest (§11) and never mutating raw.
 *
 * A flag is a statement about a reading, stored beside it. Nothing here rejects data;
 * rejection is for malformed payloads. A flagged reading is kept, is visible, and is
 * excluded from index computation by an explicit rule (§2.5) rather than by deletion.
 */
import {
  driveRateVariability,
  peakForceN,
  type DriveRateProfile,
  type ForceDepthCurve,
} from './curve.js';

export const QUALITY_FLAGS = [
  'UNCALIBRATED',
  'CALIBRATION_EXPIRED',
  'GPS_POOR',
  'GPS_MISSING',
  'RATE_OUTLIER',
  'CURVE_TRUNCATED',
  'CURVE_TOO_SHORT',
  'FORCE_SATURATED',
  'VWC_OUT_OF_RANGE',
  'TEMPERATURE_OUT_OF_RANGE',
  'DUPLICATE_LOCATION',
  'MANUAL_OVERRIDE',
] as const;

export type QualityFlag = (typeof QUALITY_FLAGS)[number];

/**
 * Flags that bar a reading from index computation.
 *
 * §2.5 names UNCALIBRATED explicitly. The others are here because a reading that
 * saturated the load cell or was driven at an outlying rate is not measuring the
 * surface — it is measuring the instrument or the operator.
 */
export const INDEX_BLOCKING_FLAGS: readonly QualityFlag[] = [
  'UNCALIBRATED',
  'CALIBRATION_EXPIRED',
  'FORCE_SATURATED',
  'CURVE_TRUNCATED',
  'CURVE_TOO_SHORT',
  'RATE_OUTLIER',
];

export interface QualityThresholds {
  gpsAccuracyWarnM: number;
  minSamples: number;
  minPenetrationMm: number;
  /** Load cell full scale. A curve that touches it has been clipped. */
  forceSaturationN: number;
  /** Coefficient of variation of drive rate above which the drive was not steady. */
  maxDriveRateCv: number;
  vwcRange: readonly [number, number];
  surfaceTempRangeC: readonly [number, number];
}

export const DEFAULT_THRESHOLDS: QualityThresholds = {
  gpsAccuracyWarnM: 1.0,
  minSamples: 50,
  minPenetrationMm: 40,
  forceSaturationN: 2000,
  maxDriveRateCv: 0.35,
  vwcRange: [0, 0.6],
  surfaceTempRangeC: [-15, 60],
};

export interface QualityInput {
  curve: ForceDepthCurve;
  driveRate: DriveRateProfile;
  gpsAccuracy?: number | null;
  hasCalibration: boolean;
  calibrationExpired?: boolean;
  vwc?: number | null;
  surfaceTempC?: number | null;
}

export function computeQualityFlags(
  input: QualityInput,
  thresholds: QualityThresholds = DEFAULT_THRESHOLDS,
): QualityFlag[] {
  const flags = new Set<QualityFlag>();

  if (!input.hasCalibration) flags.add('UNCALIBRATED');
  else if (input.calibrationExpired) flags.add('CALIBRATION_EXPIRED');

  if (input.gpsAccuracy == null) flags.add('GPS_MISSING');
  else if (input.gpsAccuracy > thresholds.gpsAccuracyWarnM) flags.add('GPS_POOR');

  const n = input.curve.depthMm.length;
  if (n < thresholds.minSamples) flags.add('CURVE_TOO_SHORT');

  const deepest = input.curve.depthMm[n - 1] ?? 0;
  if (deepest < thresholds.minPenetrationMm) flags.add('CURVE_TRUNCATED');

  if (peakForceN(input.curve) >= thresholds.forceSaturationN) flags.add('FORCE_SATURATED');

  if (driveRateVariability(input.driveRate) > thresholds.maxDriveRateCv) {
    flags.add('RATE_OUTLIER');
  }

  if (input.vwc != null) {
    const [lo, hi] = thresholds.vwcRange;
    if (input.vwc < lo || input.vwc > hi) flags.add('VWC_OUT_OF_RANGE');
  }
  if (input.surfaceTempC != null) {
    const [lo, hi] = thresholds.surfaceTempRangeC;
    if (input.surfaceTempC < lo || input.surfaceTempC > hi) {
      flags.add('TEMPERATURE_OUT_OF_RANGE');
    }
  }

  return [...flags].sort();
}

export function blocksIndexComputation(flags: readonly QualityFlag[]): boolean {
  return flags.some((f) => INDEX_BLOCKING_FLAGS.includes(f));
}
