/**
 * Ingest (§11).
 *
 * Idempotent, resumable, integrity-checked:
 *   - idempotent   every reading carries a hash of its raw bytes; re-sending a batch
 *                  counts duplicates and writes nothing
 *   - resumable    batches are independent, so a dropped connection is re-sent, not
 *                  reconciled
 *   - checked      curves are decoded and structurally validated at the boundary; a
 *                  malformed payload is rejected with its index, and the rest of the
 *                  batch still lands
 *
 * Quality flags are computed here and stored beside the raw, never over it (§2.1).
 * A flagged reading is accepted, kept and visible; exclusion from index computation is
 * a separate decision made at index time (§2.5).
 */
import {
  assertWellFormed,
  computeQualityFlags,
  decodeDriveRate,
  decodeForceDepth,
  hashRawReading,
  type IngestBatch,
  type IngestResult,
  type ReadingPayload,
} from '@harrow/shared';
import { CURRENT_DERIVATION_VERSION, deriveV1 } from '@harrow/index';
import { hashInputs } from '@harrow/shared';
import type { PrismaClient } from '@prisma/client';

export class IngestError extends Error {}

interface PreparedReading {
  sourceHash: string;
  payload: ReadingPayload;
  curveBytes: Buffer;
  driveBytes: Buffer;
  flags: string[];
  derived: ReturnType<typeof deriveV1>;
  calibrationId: string | null;
  calibrationRef: string | null;
  inputsHash: string;
}

function prepare(
  payload: ReadingPayload,
  instrumentSerial: string,
  calibration: { id: string; ref: string; validUntil: Date | null } | null,
): PreparedReading {
  const curveBytes = Buffer.from(payload.forceDepthCurve, 'base64');
  const driveBytes = Buffer.from(payload.driveRateProfile, 'base64');

  const curve = decodeForceDepth(curveBytes, payload.forceDepthSampleCount);
  const drive = decodeDriveRate(driveBytes, payload.driveRateSampleCount);
  assertWellFormed(curve);

  const expired =
    calibration?.validUntil != null && calibration.validUntil.getTime() < payload.takenAt.getTime();

  const flags = computeQualityFlags({
    curve,
    driveRate: drive,
    gpsAccuracy: payload.gpsAccuracy ?? null,
    hasCalibration: calibration !== null,
    calibrationExpired: expired,
    vwc: payload.vwc ?? null,
    surfaceTempC: payload.surfaceTempC ?? null,
  });

  const derived = deriveV1(curve, drive);

  return {
    sourceHash: hashRawReading({
      instrumentSerial,
      takenAt: payload.takenAt,
      forceDepthCurve: curveBytes,
      driveRateProfile: driveBytes,
    }),
    payload,
    curveBytes,
    driveBytes,
    flags,
    derived,
    calibrationId: calibration?.id ?? null,
    calibrationRef: expired ? (calibration?.ref ?? null) : (calibration?.ref ?? null),
    inputsHash: hashInputs({
      derivationVersion: CURRENT_DERIVATION_VERSION,
      calibrationRef: calibration?.ref ?? null,
      curveSha: hashRawReading({
        instrumentSerial,
        takenAt: payload.takenAt,
        forceDepthCurve: curveBytes,
        driveRateProfile: driveBytes,
      }),
    }),
  };
}

export async function ingestBatch(prisma: PrismaClient, batch: IngestBatch): Promise<IngestResult> {
  const session = await prisma.session.findUnique({ where: { id: batch.sessionId } });
  if (!session) throw new IngestError(`unknown session ${batch.sessionId}`);
  if (session.status !== 'OPEN') {
    throw new IngestError(
      `session ${batch.sessionId} is ${session.status}; readings are only accepted while OPEN`,
    );
  }

  const instrument = await prisma.instrument.findUnique({
    where: { serial: batch.instrumentSerial },
  });
  if (!instrument) throw new IngestError(`unknown instrument ${batch.instrumentSerial}`);

  const operator = await prisma.operator.findUnique({ where: { externalRef: batch.operatorRef } });
  if (!operator) throw new IngestError(`unknown operator ${batch.operatorRef}`);

  const rejected: IngestResult['rejected'] = [];
  const prepared: PreparedReading[] = [];

  for (const [i, payload] of batch.readings.entries()) {
    try {
      // The calibration in effect at the moment of capture, not the latest one (§2.5).
      const calibration = await prisma.calibration.findFirst({
        where: {
          instrumentId: instrument.id,
          validFrom: { lte: payload.takenAt },
          OR: [{ validUntil: null }, { validUntil: { gte: payload.takenAt } }],
        },
        orderBy: { validFrom: 'desc' },
      });
      prepared.push(prepare(payload, batch.instrumentSerial, calibration));
    } catch (err) {
      rejected.push({ index: i, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  const hashes = prepared.map((p) => p.sourceHash);
  const existing = await prisma.reading.findMany({
    where: { sourceHash: { in: hashes } },
    select: { sourceHash: true },
  });
  const seen = new Set(existing.map((e) => e.sourceHash));

  const fresh = prepared.filter((p) => !seen.has(p.sourceHash));
  // A batch can also repeat a reading within itself.
  const withinBatch = new Set<string>();
  const toWrite = fresh.filter((p) => {
    if (withinBatch.has(p.sourceHash)) return false;
    withinBatch.add(p.sourceHash);
    return true;
  });

  for (const p of toWrite) {
    await prisma.reading.create({
      data: {
        trackId: session.trackId,
        sessionId: session.id,
        surfaceType: p.payload.surfaceType,
        latitude: p.payload.latitude ?? null,
        longitude: p.payload.longitude ?? null,
        gpsAccuracy: p.payload.gpsAccuracy ?? null,
        pathSegment: p.payload.pathSegment ?? null,

        forceDepthCurve: new Uint8Array(p.curveBytes),
        forceDepthSampleCount: p.payload.forceDepthSampleCount,
        driveRateProfile: new Uint8Array(p.driveBytes),
        driveRateSampleCount: p.payload.driveRateSampleCount,
        driveEnergyJ: p.payload.driveEnergyJ ?? null,

        cushionDepth: p.derived.cushionDepth,
        cushionStiffness: p.derived.cushionStiffness,
        baseHardness: p.derived.baseHardness,
        transitionSharpness: p.derived.transitionSharpness,
        peakForceN: p.derived.peakForceN,
        penetrationDepthMm: p.derived.penetrationDepthMm,
        workJ: p.derived.workJ,
        meanDriveRateMmS: p.derived.meanDriveRateMmS,
        fitRmseN: p.derived.fitRmseN,

        vwc: p.payload.vwc ?? null,
        surfaceTempC: p.payload.surfaceTempC ?? null,
        ambientTempC: p.payload.ambientTempC ?? null,
        humidity: p.payload.humidity ?? null,

        takenAt: p.payload.takenAt,
        operatorId: operator.id,
        instrumentId: instrument.id,
        calibrationId: p.calibrationId,
        calibrationRef: p.calibrationRef,
        derivationVersion: CURRENT_DERIVATION_VERSION,
        qualityFlags: p.flags as never,
        sourceHash: p.sourceHash,

        derivations: {
          create: {
            derivationVersion: CURRENT_DERIVATION_VERSION,
            cushionDepth: p.derived.cushionDepth,
            cushionStiffness: p.derived.cushionStiffness,
            baseHardness: p.derived.baseHardness,
            transitionSharpness: p.derived.transitionSharpness,
            peakForceN: p.derived.peakForceN,
            penetrationDepthMm: p.derived.penetrationDepthMm,
            workJ: p.derived.workJ,
            meanDriveRateMmS: p.derived.meanDriveRateMmS,
            fitRmseN: p.derived.fitRmseN,
            qualityFlags: p.flags as never,
            inputsHash: p.inputsHash,
          },
        },
      },
    });
  }

  return {
    accepted: toWrite.length,
    duplicates: prepared.length - toWrite.length,
    rejected,
  };
}
