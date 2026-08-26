/**
 * Seed: a fixture set of synthetic sessions (§11).
 *
 * The curves here are generated from a two-layer model with known cushion depth and
 * base stiffness, so a developer can check that what comes out of derivation matches
 * what went in. Deliberately includes readings that will be flagged — an uncalibrated
 * instrument window, a ragged drive, a poor GPS fix — because a fixture set where
 * everything is clean never exercises the paths that matter.
 *
 * Run: pnpm --filter @harrow/db seed
 */
import { PrismaClient, type PathSegment, type SurfaceType } from '@prisma/client';
import {
  computeQualityFlags,
  decodeDriveRate,
  decodeForceDepth,
  encodeDriveRate,
  encodeForceDepth,
  hashInputs,
  hashRawReading,
} from '@harrow/shared';
import { CURRENT_DERIVATION_VERSION, deriveV1 } from '@harrow/index';

const prisma = new PrismaClient();

/** Deterministic PRNG — a seed script that differs between runs is not a fixture. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

function layeredCurve(
  cushionMm: number,
  cushionSlope: number,
  baseSlope: number,
  rng: () => number,
) {
  const n = 240;
  const depthMm = new Float64Array(n);
  const forceN = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = (i / (n - 1)) * 190;
    depthMm[i] = d;
    const f =
      d < cushionMm ? d * cushionSlope : cushionMm * cushionSlope + (d - cushionMm) * baseSlope;
    forceN[i] = Math.max(0, f + (rng() - 0.5) * 6);
  }
  return { depthMm, forceN };
}

function drive(n: number, rng: () => number, ragged: boolean) {
  const timeMs = new Float64Array(n);
  const depthMm = new Float64Array(n);
  let d = 0;
  for (let i = 0; i < n; i++) {
    timeMs[i] = i * 8;
    const step = ragged ? (rng() < 0.5 ? 0.05 : 1.5) : 0.79 + (rng() - 0.5) * 0.02;
    d += step;
    depthMm[i] = d;
  }
  return { timeMs, depthMm };
}

const TRACKS = [
  { code: 'ASC', name: 'Ascot', country: 'GB', timezone: 'Europe/London', surface: 'TURF' },
  { code: 'NEW', name: 'Newmarket', country: 'GB', timezone: 'Europe/London', surface: 'TURF' },
  { code: 'KEE', name: 'Keeneland', country: 'US', timezone: 'America/New_York', surface: 'DIRT' },
  {
    code: 'LIN',
    name: 'Lingfield Park',
    country: 'GB',
    timezone: 'Europe/London',
    surface: 'SYNTHETIC',
  },
] as const;

const SEGMENTS: PathSegment[] = ['RAIL', 'MID', 'OUTSIDE'];

async function main(): Promise<void> {
  console.log('seeding...');

  // Idempotent: wipe the fixture graph, leave migrations alone.
  await prisma.$transaction([
    prisma.predictiveFeatureValue.deleteMany(),
    prisma.indexValue.deleteMany(),
    prisma.derivedReading.deleteMany(),
    prisma.derivationRun.deleteMany(),
    prisma.reading.deleteMany(),
    prisma.session.deleteMany(),
    prisma.trackGeometry.deleteMany(),
    prisma.calibration.deleteMany(),
    prisma.instrument.deleteMany(),
    prisma.operator.deleteMany(),
    prisma.track.deleteMany(),
  ]);

  const operators = await Promise.all(
    [
      { externalRef: 'OP-001', name: 'Operator One' },
      { externalRef: 'OP-002', name: 'Operator Two' },
    ].map((data) => prisma.operator.create({ data })),
  );

  const instrument = await prisma.instrument.create({
    data: {
      serial: 'HR-0001',
      model: 'harrow-devkit-esp32s3',
      firmwareVersion: '0.0.0-dev',
      commissionedAt: new Date('2026-01-05T00:00:00Z'),
    },
  });

  // Two calibrations with a deliberate gap between them: readings taken in the gap are
  // stored, flagged UNCALIBRATED, and excluded from index computation (§2.5).
  const calibrations = await Promise.all([
    prisma.calibration.create({
      data: {
        ref: 'CAL-0001-2026-01-06',
        instrumentId: instrument.id,
        procedureVersion: 'cal_v1',
        performedAt: new Date('2026-01-06T09:00:00Z'),
        validFrom: new Date('2026-01-06T00:00:00Z'),
        validUntil: new Date('2026-03-31T23:59:59Z'),
        forceCoefficients: { gain: 1.0021, offset: -0.4 },
        vwcCoefficients: { a: 0.0003879, b: -0.6956 },
        salinityCorrection: { model: 'linear', slope: -0.011 },
        referenceDevice: 'METER TEROS 12',
        performedBy: 'OP-001',
      },
    }),
    prisma.calibration.create({
      data: {
        ref: 'CAL-0002-2026-05-02',
        instrumentId: instrument.id,
        procedureVersion: 'cal_v1',
        performedAt: new Date('2026-05-02T09:00:00Z'),
        validFrom: new Date('2026-05-02T00:00:00Z'),
        forceCoefficients: { gain: 1.0018, offset: -0.35 },
        vwcCoefficients: { a: 0.0003881, b: -0.6949 },
        salinityCorrection: { model: 'linear', slope: -0.011 },
        referenceDevice: 'METER TEROS 12',
        performedBy: 'OP-002',
      },
    }),
  ]);
  console.log(`  ${calibrations.length} calibrations, with an uncovered gap in April`);

  let sessionCount = 0;
  let readingCount = 0;

  for (const [ti, t] of TRACKS.entries()) {
    const track = await prisma.track.create({
      data: { code: t.code, name: t.name, country: t.country, timezone: t.timezone },
    });

    await prisma.trackGeometry.create({
      data: {
        trackId: track.id,
        surfaceType: t.surface as SurfaceType,
        version: 'geom_v1',
        effectiveAt: new Date('2026-01-01T00:00:00Z'),
        railOffsetM: 0,
      },
    });

    // Three sessions per track: one inside each calibration window, one in the gap.
    const dates = [
      new Date('2026-02-14T00:00:00Z'),
      new Date('2026-04-11T00:00:00Z'), // no calibration in force
      new Date('2026-06-20T00:00:00Z'),
    ];

    for (const [si, date] of dates.entries()) {
      const rng = makeRng(1000 * (ti + 1) + si);
      const session = await prisma.session.create({
        data: {
          trackId: track.id,
          surfaceType: t.surface as SurfaceType,
          date,
          samplingPattern: 'grid_20pt_3segment_v1',
          operatorId: operators[si % operators.length]!.id,
          instrumentId: instrument.id,
          officialGoingLabel: ['GOOD TO FIRM', 'GOOD', 'GOOD TO SOFT'][si]!,
          weatherRef: `openmeteo:${t.code}:${date.toISOString().slice(0, 10)}`,
          maintenanceLog: si === 1 ? 'harrowed 06:00, watered 12mm overnight' : 'harrowed 06:00',
          notes: 'seed fixture',
        },
      });
      sessionCount++;

      // Surface state drifts across the session, as a real track does.
      const baseCushion = 55 + si * 18 + ti * 6;
      const baseStiffness = 10 - si * 1.6 + ti * 0.6;

      for (let r = 0; r < 21; r++) {
        const segment = SEGMENTS[r % SEGMENTS.length]!;
        const ragged = r === 7; // one deliberately ragged drive -> RATE_OUTLIER
        const takenAt = new Date(date.getTime() + 7 * 3600_000 + r * 90_000);

        const curve = layeredCurve(
          baseCushion + (rng() - 0.5) * 10,
          1.6 + (rng() - 0.5) * 0.2,
          baseStiffness + (rng() - 0.5) * 1.5,
          rng,
        );
        const profile = drive(240, rng, ragged);

        const curveBytes = encodeForceDepth(curve);
        const driveBytes = encodeDriveRate(profile);

        const calibration = calibrations.find(
          (c) => c.validFrom <= takenAt && (c.validUntil === null || c.validUntil >= takenAt),
        );

        const flags = computeQualityFlags({
          curve: decodeForceDepth(curveBytes, curve.depthMm.length),
          driveRate: decodeDriveRate(driveBytes, profile.timeMs.length),
          gpsAccuracy: r === 3 ? 4.2 : 0.3 + rng() * 0.3, // one deliberately poor fix
          hasCalibration: calibration != null,
          vwc: 0.18 + si * 0.05,
          surfaceTempC: 9 + si * 4,
        });

        const derived = deriveV1(curve, profile);
        const sourceHash = hashRawReading({
          instrumentSerial: instrument.serial,
          takenAt,
          forceDepthCurve: curveBytes,
          driveRateProfile: driveBytes,
        });

        await prisma.reading.create({
          data: {
            trackId: track.id,
            sessionId: session.id,
            surfaceType: t.surface as SurfaceType,
            latitude: 51.4 + ti * 0.1 + r * 0.0001,
            longitude: -0.7 - ti * 0.1,
            gpsAccuracy: r === 3 ? 4.2 : 0.4,
            pathSegment: segment,
            distanceFromRail: segment === 'RAIL' ? 1.5 : segment === 'MID' ? 12 : 24,

            forceDepthCurve: new Uint8Array(curveBytes),
            forceDepthSampleCount: curve.depthMm.length,
            driveRateProfile: new Uint8Array(driveBytes),
            driveRateSampleCount: profile.timeMs.length,

            cushionDepth: derived.cushionDepth,
            cushionStiffness: derived.cushionStiffness,
            baseHardness: derived.baseHardness,
            transitionSharpness: derived.transitionSharpness,
            peakForceN: derived.peakForceN,
            penetrationDepthMm: derived.penetrationDepthMm,
            workJ: derived.workJ,
            meanDriveRateMmS: derived.meanDriveRateMmS,
            fitRmseN: derived.fitRmseN,

            vwc: 0.18 + si * 0.05,
            surfaceTempC: 9 + si * 4,
            ambientTempC: 8 + si * 4,
            humidity: 0.7,

            takenAt,
            operatorId: operators[si % operators.length]!.id,
            instrumentId: instrument.id,
            calibrationId: calibration?.id ?? null,
            calibrationRef: calibration?.ref ?? null,
            derivationVersion: CURRENT_DERIVATION_VERSION,
            qualityFlags: flags as never,
            sourceHash,

            derivations: {
              create: {
                derivationVersion: CURRENT_DERIVATION_VERSION,
                cushionDepth: derived.cushionDepth,
                cushionStiffness: derived.cushionStiffness,
                baseHardness: derived.baseHardness,
                transitionSharpness: derived.transitionSharpness,
                peakForceN: derived.peakForceN,
                penetrationDepthMm: derived.penetrationDepthMm,
                workJ: derived.workJ,
                meanDriveRateMmS: derived.meanDriveRateMmS,
                fitRmseN: derived.fitRmseN,
                qualityFlags: flags as never,
                inputsHash: hashInputs({
                  derivationVersion: CURRENT_DERIVATION_VERSION,
                  calibrationRef: calibration?.ref ?? null,
                  curveSha: sourceHash,
                }),
              },
            },
          },
        });
        readingCount++;
      }
    }
  }

  console.log(`  ${TRACKS.length} tracks, ${sessionCount} sessions, ${readingCount} readings`);
  console.log('  sessions are left OPEN — close, validate and finalize them via the API');
  console.log('done.');
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
