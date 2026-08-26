/**
 * The read API (§14) — designed as a first-class product surface, because per §0 it is
 * the actual asset.
 *
 * Two rules shape every handler here:
 *
 * 1. **Every response carries its provenance.** Index version, derivation version,
 *    calibration ref, quality flags and inputs hash travel with the number. A consumer
 *    who cannot reproduce a value they were given has been handed an opinion.
 *
 * 2. **Point-in-time is a first-class query, not a filter.** `asOf` answers "what did
 *    we know at time T", not "what do we now believe about time T". Downstream
 *    backtests are invalid without it: a model tested against values that were computed
 *    after the race it is predicting has been shown the answer.
 *
 * Rule §2.2 is enforced by omission: there is no route in this file that can return a
 * `predictive_feature`. Fitted values are served separately, to named consumers.
 */
import type { FastifyInstance } from 'fastify';
import { indexQuerySchema, readingQuerySchema } from '@harrow/shared';
import { physicalIndexV1Spec, INDEX_VERSIONS, DERIVATION_VERSIONS } from '@harrow/index';

import { db } from '../db.js';

export async function readRoutes(app: FastifyInstance): Promise<void> {
  /** The published index specification: every weight, range and rationale (§12 6a). */
  app.get('/v1/index/spec', async () => ({
    indexVersions: INDEX_VERSIONS,
    derivationVersions: DERIVATION_VERSIONS,
    terms: physicalIndexV1Spec(),
    note:
      'physical_index is physics-based and fitted to nothing. Fitted quantities are ' +
      'predictive_feature values, are never published as surface scores, and are not ' +
      'served by this API.',
  }));

  app.get('/v1/readings', async (request, reply) => {
    const parsed = readingQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', detail: parsed.error.issues });
    }
    const q = parsed.data;

    const rows = await db().reading.findMany({
      where: {
        ...(q.trackCode ? { track: { code: q.trackCode } } : {}),
        ...(q.surfaceType ? { surfaceType: q.surfaceType } : {}),
        ...(q.pathSegment ? { pathSegment: q.pathSegment } : {}),
        ...(q.from || q.to
          ? { takenAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
          : {}),
        // Point-in-time: a reading ingested after T was not known at T.
        ...(q.asOf ? { ingestedAt: { lte: q.asOf } } : {}),
      },
      take: q.limit,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      orderBy: { id: 'asc' },
      include: { track: { select: { code: true } } },
    });

    return {
      data: rows.map((r) => ({
        id: r.id,
        trackCode: r.track.code,
        sessionId: r.sessionId,
        surfaceType: r.surfaceType,
        pathSegment: r.pathSegment,
        takenAt: r.takenAt,
        latitude: r.latitude,
        longitude: r.longitude,
        gpsAccuracy: r.gpsAccuracy,
        cushionDepth: r.cushionDepth,
        baseHardness: r.baseHardness,
        transitionSharpness: r.transitionSharpness,
        peakForceN: r.peakForceN,
        penetrationDepthMm: r.penetrationDepthMm,
        vwc: r.vwc,
        surfaceTempC: r.surfaceTempC,
        // Raw is retained but not inlined: a curve is 16 KB and this is a list endpoint.
        forceDepthSampleCount: r.forceDepthSampleCount,
        forceDepthEncoding: r.forceDepthEncoding,
        provenance: {
          indexVersion: null,
          derivationVersion: r.derivationVersion,
          calibrationRef: r.calibrationRef,
          qualityFlags: r.qualityFlags,
          inputsHash: null,
        },
      })),
      nextCursor: rows.length === q.limit ? rows[rows.length - 1]?.id : null,
      asOf: q.asOf ?? null,
    };
  });

  /** The raw curve for one reading. Permanent, never downsampled (§2.1). */
  app.get<{ Params: { id: string } }>('/v1/readings/:id/curve', async (request, reply) => {
    const reading = await db().reading.findUnique({ where: { id: request.params.id } });
    if (!reading) return reply.code(404).send({ error: 'not found' });
    return {
      id: reading.id,
      forceDepth: {
        encoding: reading.forceDepthEncoding,
        sampleCount: reading.forceDepthSampleCount,
        base64: Buffer.from(reading.forceDepthCurve).toString('base64'),
      },
      driveRate: {
        encoding: reading.driveRateEncoding,
        sampleCount: reading.driveRateSampleCount,
        base64: Buffer.from(reading.driveRateProfile).toString('base64'),
      },
      provenance: {
        indexVersion: null,
        derivationVersion: reading.derivationVersion,
        calibrationRef: reading.calibrationRef,
        qualityFlags: reading.qualityFlags,
        inputsHash: null,
      },
    };
  });

  app.get('/v1/index', async (request, reply) => {
    const parsed = indexQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', detail: parsed.error.issues });
    }
    const q = parsed.data;

    const rows = await db().indexValue.findMany({
      where: {
        ...(q.indexName ? { indexName: q.indexName } : {}),
        ...(q.indexVersion ? { version: q.indexVersion } : {}),
        // A value computed after T was not known at T, even if it describes a session
        // before T. This is the whole point of the parameter.
        ...(q.asOf ? { computedAt: { lte: q.asOf } } : {}),
        session: {
          ...(q.trackCode ? { track: { code: q.trackCode } } : {}),
          ...(q.surfaceType ? { surfaceType: q.surfaceType } : {}),
          ...(q.from || q.to
            ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } }
            : {}),
        },
      },
      take: q.limit,
      ...(q.cursor ? { skip: 1, cursor: { id: q.cursor } } : {}),
      orderBy: { id: 'asc' },
      include: {
        session: {
          include: { track: { select: { code: true } } },
        },
      },
    });

    return {
      data: rows.map((v) => ({
        sessionId: v.sessionId,
        trackCode: v.session.track.code,
        surfaceType: v.session.surfaceType,
        date: v.session.date,
        indexName: v.indexName,
        value: v.value,
        components: v.components,
        computedAt: v.computedAt,
        // Shown alongside, never scored against (docs/positioning.md).
        officialGoingLabel: v.session.officialGoingLabel,
        provenance: {
          indexVersion: v.version,
          derivationVersion: v.derivationVersion,
          calibrationRef: null,
          qualityFlags: [],
          inputsHash: v.inputsHash,
        },
      })),
      nextCursor: rows.length === q.limit ? rows[rows.length - 1]?.id : null,
      asOf: q.asOf ?? null,
    };
  });

  /**
   * Bulk export. NDJSON today; §14 also calls for Parquet, which is not implemented —
   * saying so here is cheaper than a consumer discovering it.
   */
  app.get('/v1/export/readings.ndjson', async (request, reply) => {
    const parsed = readingQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'invalid query', detail: parsed.error.issues });
    }
    const q = parsed.data;
    const rows = await db().reading.findMany({
      where: {
        ...(q.trackCode ? { track: { code: q.trackCode } } : {}),
        ...(q.asOf ? { ingestedAt: { lte: q.asOf } } : {}),
      },
      take: Math.min(q.limit, 1000),
      orderBy: { id: 'asc' },
      include: { track: { select: { code: true } } },
    });
    reply.header('content-type', 'application/x-ndjson');
    return rows
      .map((r) =>
        JSON.stringify({
          id: r.id,
          trackCode: r.track.code,
          takenAt: r.takenAt,
          surfaceType: r.surfaceType,
          pathSegment: r.pathSegment,
          cushionDepth: r.cushionDepth,
          baseHardness: r.baseHardness,
          transitionSharpness: r.transitionSharpness,
          vwc: r.vwc,
          derivationVersion: r.derivationVersion,
          calibrationRef: r.calibrationRef,
          qualityFlags: r.qualityFlags,
        }),
      )
      .join('\n');
  });
}
