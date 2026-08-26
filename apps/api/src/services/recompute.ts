/**
 * Recompute machinery (§11).
 *
 * Reruns derivation over historical raw at a new version and stores the result
 * ALONGSIDE the old one — never in place. This is what makes rule §2.1 operational
 * rather than aspirational: any number ever published can be reproduced, because the
 * raw and the derivation that produced it both still exist.
 *
 * The `Reading` row's own derived columns track the current best answer for query
 * convenience. `DerivedReading` is the record of every answer ever given.
 */
import { decodeDriveRate, decodeForceDepth, hashInputs, hashRawReading } from '@harrow/shared';
import { deriveV1 } from '@harrow/index';
import type { PrismaClient } from '@prisma/client';

export interface RecomputeOptions {
  derivationVersion: string;
  /** Restrict to one track, for a staged rollout. */
  trackCode?: string;
  batchSize?: number;
  /** Write the new values onto the Reading row as the current best. */
  promote?: boolean;
}

export interface RecomputeReport {
  runId: string;
  derivationVersion: string;
  readingCount: number;
  failureCount: number;
  changed: number;
  unchanged: number;
  failures: Array<{ readingId: string; reason: string }>;
}

type Deriver = (
  curve: ReturnType<typeof decodeForceDepth>,
  drive: ReturnType<typeof decodeDriveRate>,
) => DerivedColumns;

/**
 * The columns a derivation writes. Named explicitly rather than spread from the
 * deriver's return: a future version that reports an extra quantity must add a column
 * deliberately, not discover at runtime that Prisma rejects the write.
 */
interface DerivedColumns {
  cushionDepth: number;
  cushionStiffness: number;
  baseHardness: number;
  transitionSharpness: number;
  peakForceN: number;
  penetrationDepthMm: number;
  workJ: number;
  meanDriveRateMmS: number;
  fitRmseN: number;
}

function columns(d: DerivedColumns): DerivedColumns {
  return {
    cushionDepth: d.cushionDepth,
    cushionStiffness: d.cushionStiffness,
    baseHardness: d.baseHardness,
    transitionSharpness: d.transitionSharpness,
    peakForceN: d.peakForceN,
    penetrationDepthMm: d.penetrationDepthMm,
    workJ: d.workJ,
    meanDriveRateMmS: d.meanDriveRateMmS,
    fitRmseN: d.fitRmseN,
  };
}

const DERIVERS: Record<string, Deriver> = {
  derivation_v1: deriveV1,
};

export async function recompute(
  prisma: PrismaClient,
  options: RecomputeOptions,
): Promise<RecomputeReport> {
  const deriver = DERIVERS[options.derivationVersion];
  if (!deriver) {
    throw new Error(
      `no deriver registered for ${options.derivationVersion}; ` +
        `known versions: ${Object.keys(DERIVERS).join(', ')}`,
    );
  }

  const run = await prisma.derivationRun.create({
    data: { derivationVersion: options.derivationVersion },
  });

  const where = options.trackCode ? { track: { code: options.trackCode } } : {};
  const batchSize = options.batchSize ?? 200;

  let cursor: string | undefined;
  let readingCount = 0;
  let changed = 0;
  let unchanged = 0;
  const failures: RecomputeReport['failures'] = [];

  for (;;) {
    const batch = await prisma.reading.findMany({
      where,
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      include: {
        calibration: { select: { ref: true } },
        instrument: { select: { serial: true } },
      },
    });
    if (batch.length === 0) break;
    cursor = batch[batch.length - 1]!.id;

    for (const reading of batch) {
      readingCount++;
      try {
        const curveBytes = Buffer.from(reading.forceDepthCurve);
        const driveBytes = Buffer.from(reading.driveRateProfile);
        const curve = decodeForceDepth(curveBytes, reading.forceDepthSampleCount);
        const drive = decodeDriveRate(driveBytes, reading.driveRateSampleCount);
        const derived = columns(deriver(curve, drive));

        const inputsHash = hashInputs({
          derivationVersion: options.derivationVersion,
          calibrationRef: reading.calibration?.ref ?? null,
          curveSha: hashRawReading({
            instrumentSerial: reading.instrument.serial,
            takenAt: reading.takenAt,
            forceDepthCurve: curveBytes,
            driveRateProfile: driveBytes,
          }),
        });

        const existing = await prisma.derivedReading.findUnique({
          where: {
            readingId_derivationVersion: {
              readingId: reading.id,
              derivationVersion: options.derivationVersion,
            },
          },
        });

        if (existing && existing.inputsHash === inputsHash) {
          unchanged++;
          continue;
        }

        // Upsert, never delete: an existing row for this version is replaced only when
        // its inputs genuinely differ, which means raw or calibration changed and the
        // discrepancy is worth surfacing.
        await prisma.derivedReading.upsert({
          where: {
            readingId_derivationVersion: {
              readingId: reading.id,
              derivationVersion: options.derivationVersion,
            },
          },
          create: {
            readingId: reading.id,
            derivationVersion: options.derivationVersion,
            runId: run.id,
            ...derived,
            qualityFlags: reading.qualityFlags,
            inputsHash,
          },
          update: { runId: run.id, ...derived, inputsHash, computedAt: new Date() },
        });

        if (options.promote) {
          await prisma.reading.update({
            where: { id: reading.id },
            data: { ...derived, derivationVersion: options.derivationVersion },
          });
        }
        changed++;
      } catch (err) {
        failures.push({
          readingId: reading.id,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  await prisma.derivationRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      readingCount,
      failureCount: failures.length,
    },
  });

  return {
    runId: run.id,
    derivationVersion: options.derivationVersion,
    readingCount,
    failureCount: failures.length,
    changed,
    unchanged,
    failures,
  };
}
