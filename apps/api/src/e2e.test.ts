/**
 * Phase 5 exit condition, end to end: a full session imports, validates, queries and
 * fully recomputes.
 *
 * These tests run against a real Postgres, because the properties under test —
 * idempotency on a unique constraint, insert-only index values, point-in-time reads —
 * are properties of the database, and a mock would assert that the mock works.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { PrismaClient } from '@prisma/client';
import {
  encodeDriveRate,
  encodeForceDepth,
  type IngestBatch,
  type ReadingPayload,
} from '@harrow/shared';

import { buildApp } from './app.js';
import { ingestBatch } from './services/ingest.js';
import { recompute } from './services/recompute.js';
import {
  closeSession,
  finalizeSession,
  openSession,
  validateSession,
} from './services/sessions.js';

const prisma = new PrismaClient();
const app = buildApp();

const SUFFIX = 'E2E';
const TRACK = `T-${SUFFIX}`;
const INSTRUMENT = `I-${SUFFIX}`;
const OPERATOR = `O-${SUFFIX}`;
const SESSION_DATE = new Date('2026-07-01T00:00:00Z');

function curve(cushionMm: number, seed: number) {
  const n = 240;
  const depthMm = new Float64Array(n);
  const forceN = new Float64Array(n);
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000 - 0.5;
  };
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * 190;
    depthMm[i] = d;
    forceN[i] = Math.max(
      0,
      (d < cushionMm ? d * 1.6 : cushionMm * 1.6 + (d - cushionMm) * 13) + rand() * 4,
    );
  }
  return { depthMm, forceN };
}

function steadyDrive() {
  const n = 240;
  return {
    timeMs: Float64Array.from({ length: n }, (_, i) => i * 8),
    depthMm: Float64Array.from({ length: n }, (_, i) => i * 0.79),
  };
}

function payload(i: number): ReadingPayload {
  const c = curve(55 + (i % 5) * 3, 7 + i);
  const d = steadyDrive();
  return {
    takenAt: new Date(SESSION_DATE.getTime() + 7 * 3600_000 + i * 60_000),
    surfaceType: 'TURF',
    latitude: 51.41 + i * 0.0001,
    longitude: -0.74,
    gpsAccuracy: 0.4,
    pathSegment: (['RAIL', 'MID', 'OUTSIDE'] as const)[i % 3]!,
    forceDepthCurve: Buffer.from(encodeForceDepth(c)).toString('base64'),
    forceDepthSampleCount: c.depthMm.length,
    driveRateProfile: Buffer.from(encodeDriveRate(d)).toString('base64'),
    driveRateSampleCount: d.timeMs.length,
    vwc: 0.24,
    surfaceTempC: 16,
    ambientTempC: 15,
    humidity: 0.66,
  };
}

async function cleanup(): Promise<void> {
  const track = await prisma.track.findUnique({ where: { code: TRACK } });
  if (track) {
    await prisma.indexValue.deleteMany({ where: { session: { trackId: track.id } } });
    await prisma.derivedReading.deleteMany({ where: { reading: { trackId: track.id } } });
    await prisma.reading.deleteMany({ where: { trackId: track.id } });
    await prisma.session.deleteMany({ where: { trackId: track.id } });
    await prisma.trackGeometry.deleteMany({ where: { trackId: track.id } });
  }
  await prisma.calibration.deleteMany({ where: { instrument: { serial: INSTRUMENT } } });
  await prisma.instrument.deleteMany({ where: { serial: INSTRUMENT } });
  await prisma.operator.deleteMany({ where: { externalRef: OPERATOR } });
  await prisma.track.deleteMany({ where: { code: TRACK } });
}

let sessionId: string;

beforeAll(async () => {
  await cleanup();
  await prisma.track.create({
    data: { code: TRACK, name: 'E2E Park', country: 'GB', timezone: 'Europe/London' },
  });
  await prisma.operator.create({ data: { externalRef: OPERATOR, name: 'E2E Operator' } });
  const instrument = await prisma.instrument.create({
    data: {
      serial: INSTRUMENT,
      model: 'harrow-devkit',
      firmwareVersion: '0.0.0',
      commissionedAt: new Date('2026-01-01T00:00:00Z'),
    },
  });
  await prisma.calibration.create({
    data: {
      ref: `CAL-${SUFFIX}`,
      instrumentId: instrument.id,
      procedureVersion: 'cal_v1',
      performedAt: new Date('2026-06-01T00:00:00Z'),
      validFrom: new Date('2026-06-01T00:00:00Z'),
      forceCoefficients: { gain: 1, offset: 0 },
      vwcCoefficients: { a: 1, b: 0 },
    },
  });
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await prisma.$disconnect();
});

describe('session lifecycle', () => {
  test('opens with a declared sampling pattern', async () => {
    const session = await openSession(prisma, {
      trackCode: TRACK,
      surfaceType: 'TURF',
      date: SESSION_DATE,
      samplingPattern: 'grid_20pt_3segment_v1',
      operatorRef: OPERATOR,
      instrumentSerial: INSTRUMENT,
      officialGoingLabel: 'GOOD',
    });
    sessionId = session.id;
    expect(session.status).toBe('OPEN');
    expect(session.samplingPattern).toBe('grid_20pt_3segment_v1');
  });
});

describe('ingest', () => {
  const batch = (): IngestBatch => ({
    sessionId,
    instrumentSerial: INSTRUMENT,
    operatorRef: OPERATOR,
    readings: Array.from({ length: 21 }, (_, i) => payload(i)),
  });

  test('accepts a full batch and derives every reading', async () => {
    const result = await ingestBatch(prisma, { ...batch(), sessionId });
    expect(result.accepted).toBe(21);
    expect(result.duplicates).toBe(0);
    expect(result.rejected).toEqual([]);

    const stored = await prisma.reading.findMany({
      where: { sessionId },
      include: { derivations: true },
    });
    expect(stored).toHaveLength(21);
    for (const r of stored) {
      expect(r.cushionDepth).toBeGreaterThan(30);
      expect(r.baseHardness).toBeGreaterThan(r.cushionDepth === 0 ? 0 : 5);
      expect(r.derivations).toHaveLength(1);
      expect(r.calibrationRef).toBe(`CAL-${SUFFIX}`);
      expect(r.qualityFlags).not.toContain('UNCALIBRATED');
    }
  });

  test('re-sending the identical batch writes nothing (§11 idempotent)', async () => {
    const result = await ingestBatch(prisma, { ...batch(), sessionId });
    expect(result.accepted).toBe(0);
    expect(result.duplicates).toBe(21);
    expect(await prisma.reading.count({ where: { sessionId } })).toBe(21);
  });

  test('a malformed reading is rejected by index; the rest of the batch still lands', async () => {
    const good = payload(90);
    const bad = { ...payload(91), forceDepthSampleCount: 999_999 };
    const result = await ingestBatch(prisma, {
      sessionId,
      instrumentSerial: INSTRUMENT,
      operatorRef: OPERATOR,
      readings: [good, bad],
    });
    expect(result.accepted).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]!.index).toBe(1);
    expect(result.rejected[0]!.reason).toMatch(/bytes, expected/);
  });

  test('raw survives the round trip byte for byte (§2.1)', async () => {
    const source = payload(0);
    const stored = await prisma.reading.findFirst({
      where: { sessionId },
      orderBy: { takenAt: 'asc' },
    });
    expect(Buffer.from(stored!.forceDepthCurve).toString('base64')).toBe(source.forceDepthCurve);
  });
});

describe('validate and finalize', () => {
  test('closes, then validates with a flag and coverage report', async () => {
    await closeSession(prisma, sessionId);
    const report = await validateSession(prisma, sessionId);
    expect(report.passed).toBe(true);
    expect(report.eligibleReadings).toBeGreaterThanOrEqual(20);
    expect(report.pathSegmentsCovered).toEqual(['MID', 'OUTSIDE', 'RAIL']);
    expect(report.driveRateSpreadMmS).not.toBeNull();
  });

  test('finalize writes physical_index_v1 with reproducible provenance', async () => {
    const { indexValue, result } = await finalizeSession(prisma, sessionId);
    expect(indexValue.indexName).toBe('physical_index');
    expect(indexValue.version).toBe('v1');
    expect(indexValue.value).toBeGreaterThan(0);
    expect(indexValue.value).toBeLessThan(10);
    expect(indexValue.inputsHash).toHaveLength(64);
    expect(result.readingsUsed).toBeGreaterThanOrEqual(20);
  });

  test('a finalized session cannot be re-finalized (§2.4)', async () => {
    await expect(finalizeSession(prisma, sessionId)).rejects.toThrow(/cannot move a session/);
  });

  test('a closed session refuses further readings', async () => {
    await expect(
      ingestBatch(prisma, {
        sessionId,
        instrumentSerial: INSTRUMENT,
        operatorRef: OPERATOR,
        readings: [payload(500)],
      }),
    ).rejects.toThrow(/only accepted while OPEN/);
  });
});

describe('read API', () => {
  test('every reading response carries its provenance (§14)', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/readings?trackCode=${TRACK}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBeGreaterThan(0);
    for (const row of body.data) {
      expect(row.provenance.derivationVersion).toBe('derivation_v1');
      expect(row.provenance.calibrationRef).toBe(`CAL-${SUFFIX}`);
      expect(Array.isArray(row.provenance.qualityFlags)).toBe(true);
    }
  });

  test('the raw curve is retrievable and decodes to the stored sample count', async () => {
    const list = await app.inject({
      method: 'GET',
      url: `/v1/readings?trackCode=${TRACK}&limit=1`,
    });
    const id = list.json().data[0].id;
    const res = await app.inject({ method: 'GET', url: `/v1/readings/${id}/curve` });
    const body = res.json();
    expect(body.forceDepth.encoding).toBe('f64le-interleaved-depth_mm-force_n-v1');
    expect(Buffer.from(body.forceDepth.base64, 'base64').byteLength).toBe(
      body.forceDepth.sampleCount * 16,
    );
  });

  test('index values are returned with the official label alongside, not scored', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/index?trackCode=${TRACK}` });
    const body = res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].officialGoingLabel).toBe('GOOD');
    expect(body.data[0].provenance.indexVersion).toBe('v1');
    expect(body.data[0]).not.toHaveProperty('agreement');
    expect(body.data[0]).not.toHaveProperty('delta');
  });

  test('point-in-time: nothing was known before it was computed', async () => {
    const before = new Date('2026-01-01T00:00:00Z').toISOString();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/index?trackCode=${TRACK}&asOf=${before}`,
    });
    expect(res.json().data).toEqual([]);

    const after = new Date(Date.now() + 60_000).toISOString();
    const res2 = await app.inject({
      method: 'GET',
      url: `/v1/index?trackCode=${TRACK}&asOf=${after}`,
    });
    expect(res2.json().data).toHaveLength(1);
  });

  test('the published index spec is served in full', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/index/spec' });
    const body = res.json();
    expect(body.terms.length).toBe(12);
    for (const t of body.terms) expect(typeof t.rationale).toBe('string');
    expect(body.note).toMatch(/fitted to nothing/);
  });

  test('no route serves a predictive_feature (§2.2)', async () => {
    for (const url of ['/v1/predictive', '/v1/features', '/v1/predictive_feature']) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    }
  });

  test('an invalid query is refused rather than silently ignored', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/readings?surfaceType=GRAVEL' });
    expect(res.statusCode).toBe(400);
  });
});

describe('recompute', () => {
  test('rerunning the same version changes nothing and destroys nothing', async () => {
    const before = await prisma.derivedReading.count();
    const report = await recompute(prisma, { derivationVersion: 'derivation_v1' });
    expect(report.failureCount).toBe(0);
    expect(report.unchanged).toBeGreaterThan(0);
    expect(report.changed).toBe(0);
    expect(await prisma.derivedReading.count()).toBe(before);
  });

  test('an unknown derivation version is refused', async () => {
    await expect(recompute(prisma, { derivationVersion: 'derivation_v99' })).rejects.toThrow(
      /no deriver registered/,
    );
  });

  test('a run is recorded with its counts', async () => {
    const run = await prisma.derivationRun.findFirst({ orderBy: { startedAt: 'desc' } });
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.readingCount).toBeGreaterThan(0);
  });
});
