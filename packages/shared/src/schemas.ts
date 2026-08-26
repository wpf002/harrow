/**
 * Wire schemas for ingest and the read API.
 *
 * Curves arrive as base64 plus a sample count, not as JSON arrays: a 1,000-sample curve
 * is 16 KB of float64 and roughly 40 KB as JSON text. The count is carried explicitly so
 * a truncated upload fails at the boundary instead of decoding into a shorter curve.
 */
import { z } from 'zod';

export const surfaceTypeSchema = z.enum(['DIRT', 'TURF', 'SYNTHETIC']);
export type SurfaceType = z.infer<typeof surfaceTypeSchema>;

export const pathSegmentSchema = z.enum(['RAIL', 'MID', 'OUTSIDE']);
export type PathSegment = z.infer<typeof pathSegmentSchema>;

export const sessionStatusSchema = z.enum(['OPEN', 'CLOSED', 'VALIDATED', 'FINALIZED', 'REJECTED']);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

const base64Curve = z
  .string()
  .min(1)
  .refine((s) => /^[A-Za-z0-9+/]+={0,2}$/.test(s), 'not base64');

export const readingPayloadSchema = z
  .object({
    takenAt: z.coerce.date(),
    surfaceType: surfaceTypeSchema,
    latitude: z.number().min(-90).max(90).nullish(),
    longitude: z.number().min(-180).max(180).nullish(),
    gpsAccuracy: z.number().nonnegative().nullish(),
    pathSegment: pathSegmentSchema.nullish(),

    forceDepthCurve: base64Curve,
    forceDepthSampleCount: z.number().int().positive(),
    driveRateProfile: base64Curve,
    driveRateSampleCount: z.number().int().positive(),
    driveEnergyJ: z.number().nonnegative().nullish(),

    vwc: z.number().min(0).max(1).nullish(),
    surfaceTempC: z.number().nullish(),
    ambientTempC: z.number().nullish(),
    humidity: z.number().min(0).max(1).nullish(),
  })
  .strict();
export type ReadingPayload = z.infer<typeof readingPayloadSchema>;

export const openSessionSchema = z
  .object({
    trackCode: z.string().min(1),
    surfaceType: surfaceTypeSchema,
    date: z.coerce.date(),
    /** Declared before capture. The pattern is the protocol (§13). */
    samplingPattern: z.string().min(1),
    operatorRef: z.string().min(1),
    instrumentSerial: z.string().min(1),
    weatherRef: z.string().nullish(),
    maintenanceLog: z.string().nullish(),
    officialGoingLabel: z.string().nullish(),
    notes: z.string().nullish(),
  })
  .strict();
export type OpenSessionInput = z.infer<typeof openSessionSchema>;

export const ingestBatchSchema = z
  .object({
    sessionId: z.string().min(1),
    instrumentSerial: z.string().min(1),
    operatorRef: z.string().min(1),
    /** Ingest is idempotent and resumable: re-sending a batch is safe (§11). */
    readings: z.array(readingPayloadSchema).min(1).max(500),
  })
  .strict();
export type IngestBatch = z.infer<typeof ingestBatchSchema>;

export const ingestResultSchema = z.object({
  accepted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  rejected: z.array(z.object({ index: z.number().int(), reason: z.string() })),
});
export type IngestResult = z.infer<typeof ingestResultSchema>;

/**
 * Provenance carried on every read-API response (§14).
 *
 * A consumer must be able to reproduce any number they receive. That is only true if
 * the response says which index version, which derivation, which calibration, and what
 * was flagged.
 */
export const provenanceSchema = z.object({
  indexVersion: z.string().nullable(),
  derivationVersion: z.string(),
  calibrationRef: z.string().nullable(),
  qualityFlags: z.array(z.string()),
  inputsHash: z.string().nullable(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const readingQuerySchema = z
  .object({
    trackCode: z.string().optional(),
    surfaceType: surfaceTypeSchema.optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    pathSegment: pathSegmentSchema.optional(),
    /** Point-in-time: what did we know at time T (§14). */
    asOf: z.coerce.date().optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    cursor: z.string().optional(),
  })
  .strict();
export type ReadingQuery = z.infer<typeof readingQuerySchema>;

export const indexQuerySchema = readingQuerySchema
  .omit({ pathSegment: true })
  .extend({
    indexName: z.string().optional(),
    indexVersion: z.string().optional(),
  })
  .strict();
export type IndexQuery = z.infer<typeof indexQuerySchema>;
