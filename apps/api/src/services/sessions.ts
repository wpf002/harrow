/**
 * Session lifecycle (§11): open, declare, capture, close, validate, finalize.
 *
 * The transitions are one-way. A finalized session's index values are immutable (§2.4),
 * so re-opening one to add a reading would silently change a published number. If a
 * session is wrong, it is rejected and re-captured, not edited.
 *
 *   OPEN -> CLOSED -> VALIDATED -> FINALIZED
 *     \        \          \
 *      `--------`----------`--> REJECTED
 */
import {
  computeSessionPhysicalIndexV1,
  CURRENT_DERIVATION_VERSION,
  InsufficientReadingsError,
  MIN_ELIGIBLE_READINGS,
  type SessionReading,
} from '@harrow/index';
import { blocksIndexComputation, type OpenSessionInput, type QualityFlag } from '@harrow/shared';
import type { PrismaClient, SessionStatus } from '@prisma/client';

export class SessionError extends Error {}

const ALLOWED: Record<SessionStatus, SessionStatus[]> = {
  OPEN: ['CLOSED', 'REJECTED'],
  CLOSED: ['VALIDATED', 'REJECTED'],
  VALIDATED: ['FINALIZED', 'REJECTED'],
  FINALIZED: [],
  REJECTED: [],
};

function assertTransition(from: SessionStatus, to: SessionStatus): void {
  if (!ALLOWED[from].includes(to)) {
    throw new SessionError(`cannot move a session from ${from} to ${to}`);
  }
}

export async function openSession(prisma: PrismaClient, input: OpenSessionInput) {
  const track = await prisma.track.findUnique({ where: { code: input.trackCode } });
  if (!track) throw new SessionError(`unknown track ${input.trackCode}`);

  const operator = await prisma.operator.findUnique({ where: { externalRef: input.operatorRef } });
  if (!operator) throw new SessionError(`unknown operator ${input.operatorRef}`);

  const instrument = await prisma.instrument.findUnique({
    where: { serial: input.instrumentSerial },
  });
  if (!instrument) throw new SessionError(`unknown instrument ${input.instrumentSerial}`);

  return prisma.session.create({
    data: {
      trackId: track.id,
      surfaceType: input.surfaceType,
      date: input.date,
      // Declared before capture. The pattern is the protocol, and recording it after
      // the fact would make it a description of what happened rather than a rule.
      samplingPattern: input.samplingPattern,
      operatorId: operator.id,
      instrumentId: instrument.id,
      weatherRef: input.weatherRef ?? null,
      maintenanceLog: input.maintenanceLog ?? null,
      officialGoingLabel: input.officialGoingLabel ?? null,
      notes: input.notes ?? null,
    },
  });
}

export async function closeSession(prisma: PrismaClient, sessionId: string) {
  const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
  assertTransition(session.status, 'CLOSED');
  return prisma.session.update({
    where: { id: sessionId },
    data: { status: 'CLOSED', closedAt: new Date() },
  });
}

export interface ValidationReport {
  sessionId: string;
  totalReadings: number;
  eligibleReadings: number;
  excludedReadings: number;
  flagCounts: Record<string, number>;
  pathSegmentsCovered: string[];
  /** Between-operator variance is a reported quantity in every run (§2.7). */
  driveRateSpreadMmS: number | null;
  passed: boolean;
  problems: string[];
}

export async function validateSession(
  prisma: PrismaClient,
  sessionId: string,
): Promise<ValidationReport> {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { readings: true },
  });
  assertTransition(session.status, 'VALIDATED');

  const flagCounts: Record<string, number> = {};
  let eligible = 0;
  const rates: number[] = [];
  const segments = new Set<string>();

  for (const r of session.readings) {
    for (const f of r.qualityFlags) flagCounts[f] = (flagCounts[f] ?? 0) + 1;
    if (!blocksIndexComputation(r.qualityFlags as QualityFlag[])) eligible++;
    if (r.meanDriveRateMmS != null) rates.push(r.meanDriveRateMmS);
    if (r.pathSegment) segments.add(r.pathSegment);
  }

  const problems: string[] = [];
  if (eligible < MIN_ELIGIBLE_READINGS) {
    problems.push(`only ${eligible} eligible readings, need ${MIN_ELIGIBLE_READINGS}`);
  }
  if (session.readings.length === 0) problems.push('session has no readings');
  if (segments.size < 2) {
    // A rail-only session does not describe the track a field runs on (§12).
    problems.push(`only ${segments.size} path segment(s) covered`);
  }

  let spread: number | null = null;
  if (rates.length > 1) {
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    spread = Math.sqrt(rates.reduce((a, r) => a + (r - mean) ** 2, 0) / (rates.length - 1));
  }

  const passed = problems.length === 0;
  if (passed) {
    await prisma.session.update({ where: { id: sessionId }, data: { status: 'VALIDATED' } });
  }

  return {
    sessionId,
    totalReadings: session.readings.length,
    eligibleReadings: eligible,
    excludedReadings: session.readings.length - eligible,
    flagCounts,
    pathSegmentsCovered: [...segments].sort(),
    driveRateSpreadMmS: spread,
    passed,
    problems,
  };
}

/**
 * Finalize: compute and store physical_index_v1 for the session.
 *
 * Insert-only. If a value already exists for (session, index, version) it is returned
 * unchanged — a published version is immutable (§2.4), and recomputing it must either
 * agree or ship as a new version.
 */
export async function finalizeSession(prisma: PrismaClient, sessionId: string) {
  const session = await prisma.session.findUniqueOrThrow({
    where: { id: sessionId },
    include: { readings: { include: { derivations: true } } },
  });
  assertTransition(session.status, 'FINALIZED');

  const readings: SessionReading[] = session.readings.map((r) => {
    const derived =
      r.derivations.find((d) => d.derivationVersion === CURRENT_DERIVATION_VERSION) ?? null;
    return {
      readingId: r.id,
      qualityFlags: r.qualityFlags as QualityFlag[],
      derivationVersion: derived?.derivationVersion ?? r.derivationVersion,
      baseHardness: derived?.baseHardness ?? r.baseHardness ?? 0,
      cushionDepth: derived?.cushionDepth ?? r.cushionDepth ?? 0,
      transitionSharpness: derived?.transitionSharpness ?? r.transitionSharpness ?? 0,
      vwc: r.vwc ?? 0,
      surfaceTempC: r.surfaceTempC ?? 0,
    };
  });

  let result;
  try {
    result = computeSessionPhysicalIndexV1(session.surfaceType, readings);
  } catch (err) {
    if (err instanceof InsufficientReadingsError) {
      throw new SessionError(
        `cannot finalize: ${err.message}. An index computed from too few readings ` +
          'would look authoritative without being one.',
      );
    }
    throw err;
  }

  const existing = await prisma.indexValue.findUnique({
    where: {
      sessionId_indexName_version: {
        sessionId,
        indexName: result.indexName,
        version: result.version,
      },
    },
  });

  const indexValue =
    existing ??
    (await prisma.indexValue.create({
      data: {
        sessionId,
        indexName: result.indexName,
        version: result.version,
        value: result.value,
        components: {
          medianAbsoluteDeviation: result.medianAbsoluteDeviation,
          readingsUsed: result.readingsUsed,
          readingsExcluded: result.readingsExcluded,
          excludedByFlag: result.excludedByFlag,
        },
        inputsHash: result.inputsHash,
        derivationVersion: result.derivationVersion,
      },
    }));

  await prisma.session.update({
    where: { id: sessionId },
    data: { status: 'FINALIZED', finalizedAt: new Date() },
  });

  return {
    session: await prisma.session.findUniqueOrThrow({ where: { id: sessionId } }),
    indexValue,
    result,
  };
}

export async function rejectSession(prisma: PrismaClient, sessionId: string, reason: string) {
  const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
  assertTransition(session.status, 'REJECTED');
  return prisma.session.update({
    where: { id: sessionId },
    data: {
      status: 'REJECTED',
      notes: [session.notes, `REJECTED: ${reason}`].filter(Boolean).join('\n'),
    },
  });
}
