-- CreateEnum
CREATE TYPE "SurfaceType" AS ENUM ('DIRT', 'TURF', 'SYNTHETIC');

-- CreateEnum
CREATE TYPE "PathSegment" AS ENUM ('RAIL', 'MID', 'OUTSIDE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('OPEN', 'CLOSED', 'VALIDATED', 'FINALIZED', 'REJECTED');

-- CreateEnum
CREATE TYPE "QualityFlag" AS ENUM ('UNCALIBRATED', 'CALIBRATION_EXPIRED', 'GPS_POOR', 'GPS_MISSING', 'RATE_OUTLIER', 'CURVE_TRUNCATED', 'CURVE_TOO_SHORT', 'FORCE_SATURATED', 'VWC_OUT_OF_RANGE', 'TEMPERATURE_OUT_OF_RANGE', 'DUPLICATE_LOCATION', 'MANUAL_OVERRIDE');

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Track_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackGeometry" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "surfaceType" "SurfaceType" NOT NULL,
    "version" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "railOffsetM" DOUBLE PRECISION,
    "railGeoJson" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackGeometry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operator" (
    "id" TEXT NOT NULL,
    "externalRef" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Operator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "firmwareVersion" TEXT NOT NULL,
    "commissionedAt" TIMESTAMP(3) NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Calibration" (
    "id" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "procedureVersion" TEXT NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "forceCoefficients" JSONB NOT NULL,
    "vwcCoefficients" JSONB NOT NULL,
    "salinityCorrection" JSONB,
    "referenceDevice" TEXT,
    "performedBy" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Calibration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "surfaceType" "SurfaceType" NOT NULL,
    "date" DATE NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'OPEN',
    "samplingPattern" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "weatherRef" TEXT,
    "maintenanceLog" TEXT,
    "officialGoingLabel" TEXT,
    "notes" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reading" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "sessionId" TEXT,
    "surfaceType" "SurfaceType" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "gpsAccuracy" DOUBLE PRECISION,
    "distanceFromRail" DOUBLE PRECISION,
    "pathSegment" "PathSegment",
    "forceDepthCurve" BYTEA NOT NULL,
    "forceDepthSampleCount" INTEGER NOT NULL,
    "forceDepthEncoding" TEXT NOT NULL DEFAULT 'f64le-interleaved-depth_mm-force_n-v1',
    "driveRateProfile" BYTEA NOT NULL,
    "driveRateSampleCount" INTEGER NOT NULL,
    "driveRateEncoding" TEXT NOT NULL DEFAULT 'f64le-interleaved-t_ms-depth_mm-v1',
    "driveEnergyJ" DOUBLE PRECISION,
    "cushionDepth" DOUBLE PRECISION,
    "baseHardness" DOUBLE PRECISION,
    "transitionSharpness" DOUBLE PRECISION,
    "peakForceN" DOUBLE PRECISION,
    "penetrationDepthMm" DOUBLE PRECISION,
    "meanDriveRateMmS" DOUBLE PRECISION,
    "vwc" DOUBLE PRECISION,
    "surfaceTempC" DOUBLE PRECISION,
    "ambientTempC" DOUBLE PRECISION,
    "humidity" DOUBLE PRECISION,
    "takenAt" TIMESTAMP(3) NOT NULL,
    "operatorId" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "calibrationRef" TEXT,
    "calibrationId" TEXT,
    "derivationVersion" TEXT NOT NULL,
    "qualityFlags" "QualityFlag"[],
    "sourceHash" TEXT NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DerivedReading" (
    "id" TEXT NOT NULL,
    "readingId" TEXT NOT NULL,
    "derivationVersion" TEXT NOT NULL,
    "runId" TEXT,
    "cushionDepth" DOUBLE PRECISION,
    "baseHardness" DOUBLE PRECISION,
    "transitionSharpness" DOUBLE PRECISION,
    "peakForceN" DOUBLE PRECISION,
    "penetrationDepthMm" DOUBLE PRECISION,
    "meanDriveRateMmS" DOUBLE PRECISION,
    "qualityFlags" "QualityFlag"[],
    "inputsHash" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DerivedReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DerivationRun" (
    "id" TEXT NOT NULL,
    "derivationVersion" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "readingCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,

    CONSTRAINT "DerivationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexValue" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "indexName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "components" JSONB,
    "inputsHash" TEXT NOT NULL,
    "derivationVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IndexValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PredictiveFeatureValue" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "featureName" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "fitRef" TEXT NOT NULL,
    "inputsHash" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PredictiveFeatureValue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Track_code_key" ON "Track"("code");

-- CreateIndex
CREATE INDEX "Track_country_idx" ON "Track"("country");

-- CreateIndex
CREATE INDEX "TrackGeometry_trackId_surfaceType_effectiveAt_idx" ON "TrackGeometry"("trackId", "surfaceType", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrackGeometry_trackId_surfaceType_version_key" ON "TrackGeometry"("trackId", "surfaceType", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Operator_externalRef_key" ON "Operator"("externalRef");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_serial_key" ON "Instrument"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "Calibration_ref_key" ON "Calibration"("ref");

-- CreateIndex
CREATE INDEX "Calibration_instrumentId_validFrom_idx" ON "Calibration"("instrumentId", "validFrom");

-- CreateIndex
CREATE INDEX "Session_trackId_date_idx" ON "Session"("trackId", "date");

-- CreateIndex
CREATE INDEX "Session_status_idx" ON "Session"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Session_trackId_surfaceType_date_samplingPattern_instrument_key" ON "Session"("trackId", "surfaceType", "date", "samplingPattern", "instrumentId");

-- CreateIndex
CREATE UNIQUE INDEX "Reading_sourceHash_key" ON "Reading"("sourceHash");

-- CreateIndex
CREATE INDEX "Reading_sessionId_idx" ON "Reading"("sessionId");

-- CreateIndex
CREATE INDEX "Reading_trackId_takenAt_idx" ON "Reading"("trackId", "takenAt");

-- CreateIndex
CREATE INDEX "Reading_derivationVersion_idx" ON "Reading"("derivationVersion");

-- CreateIndex
CREATE INDEX "DerivedReading_derivationVersion_idx" ON "DerivedReading"("derivationVersion");

-- CreateIndex
CREATE UNIQUE INDEX "DerivedReading_readingId_derivationVersion_key" ON "DerivedReading"("readingId", "derivationVersion");

-- CreateIndex
CREATE INDEX "DerivationRun_derivationVersion_idx" ON "DerivationRun"("derivationVersion");

-- CreateIndex
CREATE INDEX "IndexValue_indexName_version_idx" ON "IndexValue"("indexName", "version");

-- CreateIndex
CREATE UNIQUE INDEX "IndexValue_sessionId_indexName_version_key" ON "IndexValue"("sessionId", "indexName", "version");

-- CreateIndex
CREATE INDEX "PredictiveFeatureValue_featureName_version_idx" ON "PredictiveFeatureValue"("featureName", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PredictiveFeatureValue_sessionId_featureName_version_key" ON "PredictiveFeatureValue"("sessionId", "featureName", "version");

-- AddForeignKey
ALTER TABLE "TrackGeometry" ADD CONSTRAINT "TrackGeometry_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Calibration" ADD CONSTRAINT "Calibration_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_calibrationId_fkey" FOREIGN KEY ("calibrationId") REFERENCES "Calibration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DerivedReading" ADD CONSTRAINT "DerivedReading_readingId_fkey" FOREIGN KEY ("readingId") REFERENCES "Reading"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DerivedReading" ADD CONSTRAINT "DerivedReading_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DerivationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexValue" ADD CONSTRAINT "IndexValue_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PredictiveFeatureValue" ADD CONSTRAINT "PredictiveFeatureValue_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
