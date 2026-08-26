/**
 * The capture flow — the piece that ties the pattern, the gates and the store together.
 *
 * Order matters and is deliberate:
 *
 *   1. Ask the pattern where the probe goes. Refuse anything else.
 *   2. Gate GPS *before* the traverse. There is no point driving a probe if the reading
 *      cannot be placed on the track.
 *   3. Drive, capture the curve.
 *   4. Gate the curve.
 *   5. **Persist regardless of the verdict**, then tell the operator.
 *
 * Step 5 is the one worth defending. A rejected reading is still data: it is evidence of
 * a ragged drive, a saturated cell, or a surface that did not behave. Rule §2.1 says raw
 * is permanent, and "permanent unless we didn't like it" is not permanent. The reading is
 * stored with `accepted: false` and its flags, and the index computation excludes it
 * later, by rule, in the open.
 */
import {
  encodeDriveRate,
  encodeForceDepth,
  hashRawReading,
  type QualityFlag,
} from '@harrow/shared';
import type { DriveRateProfile, ForceDepthCurve } from '@harrow/shared';

import {
  DEFAULT_GATES,
  gateCapture,
  gateGps,
  override,
  type GateResult,
  type GpsFix,
  type GateThresholds,
} from './gate.js';
import { PatternRun } from './pattern.js';
import type { StoredReading, StoredSession, Store } from './store.js';

export interface CaptureInput {
  curve: ForceDepthCurve;
  drive: DriveRateProfile;
  fix: GpsFix | null;
  takenAt: Date;
  vwc?: number | null;
  surfaceTempC?: number | null;
  ambientTempC?: number | null;
  humidity?: number | null;
  /** Set only when the operator has explicitly overridden a blocked gate. */
  overrideGps?: boolean;
}

export interface CaptureOutcome {
  sourceHash: string;
  accepted: boolean;
  verdict: GateResult['verdict'];
  reasons: string[];
  flags: QualityFlag[];
  /** Present when the capture was rejected and the pattern allows another attempt. */
  retake?: { canRetake: boolean; reason: string };
}

export class CaptureBlocked extends Error {
  constructor(
    message: string,
    readonly gate: GateResult,
  ) {
    super(message);
  }
}

/**
 * Pre-flight, before the operator drives the probe. Returns the gate result so the UI
 * can show why it is blocked and offer an override.
 */
export function preflight(
  fix: GpsFix | null,
  thresholds: GateThresholds = DEFAULT_GATES,
): GateResult {
  return gateGps(fix, thresholds);
}

export async function capture(
  store: Store,
  session: StoredSession,
  run: PatternRun,
  pointId: string,
  input: CaptureInput,
  thresholds: GateThresholds = DEFAULT_GATES,
): Promise<CaptureOutcome> {
  const progress = run.at(pointId);
  if (progress.state === 'CAPTURED' || progress.state === 'SPENT') {
    throw new CaptureBlocked(
      `point ${pointId} has already been probed; probing it again measures the first hole`,
      { verdict: 'BLOCKED', reasons: [], flags: [], overridable: false },
    );
  }

  let gpsGate = gateGps(input.fix, thresholds);
  if (gpsGate.verdict === 'BLOCKED') {
    if (!input.overrideGps) {
      throw new CaptureBlocked(gpsGate.reasons.join(' '), gpsGate);
    }
    gpsGate = override(gpsGate);
  }

  const captureGate = gateCapture(input.curve, input.drive, thresholds);
  const flags = [...new Set([...gpsGate.flags, ...captureGate.flags])].sort() as QualityFlag[];
  const reasons = [...gpsGate.reasons, ...captureGate.reasons];
  const accepted = captureGate.verdict === 'ACCEPT';

  const curveBytes = encodeForceDepth(input.curve);
  const driveBytes = encodeDriveRate(input.drive);
  const sourceHash = hashRawReading({
    instrumentSerial: session.instrumentSerial,
    takenAt: input.takenAt,
    forceDepthCurve: curveBytes,
    driveRateProfile: driveBytes,
  });

  const reading: StoredReading = {
    sourceHash,
    sessionLocalId: session.localId,
    pointId,
    attempt: progress.attempts + 1,
    accepted,
    takenAt: input.takenAt.toISOString(),
    surfaceType: session.surfaceType,
    pathSegment: progress.point.segment,
    latitude: input.fix?.latitude ?? null,
    longitude: input.fix?.longitude ?? null,
    gpsAccuracy: input.fix?.accuracy ?? null,
    forceDepthCurve: curveBytes.buffer.slice(
      curveBytes.byteOffset,
      curveBytes.byteOffset + curveBytes.byteLength,
    ) as ArrayBuffer,
    forceDepthSampleCount: input.curve.depthMm.length,
    driveRateProfile: driveBytes.buffer.slice(
      driveBytes.byteOffset,
      driveBytes.byteOffset + driveBytes.byteLength,
    ) as ArrayBuffer,
    driveRateSampleCount: input.drive.timeMs.length,
    vwc: input.vwc ?? null,
    surfaceTempC: input.surfaceTempC ?? null,
    ambientTempC: input.ambientTempC ?? null,
    humidity: input.humidity ?? null,
    qualityFlags: flags,
    gateReasons: reasons,
  };

  // Persist before acknowledging. If the browser dies here, the probe is not lost.
  await store.saveReading(reading);

  let retake: CaptureOutcome['retake'];
  if (accepted) {
    run.accept(pointId);
  } else {
    retake = run.reject(pointId, reasons.join(' '));
  }

  session.progress = run.snapshot();
  await store.putSession(session);

  return {
    sourceHash,
    accepted,
    verdict: captureGate.verdict,
    reasons,
    flags,
    ...(retake ? { retake } : {}),
  };
}
