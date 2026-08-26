# Harrow

Standardized racing surface measurement. A handheld force-vs-depth probe with volumetric
water content, surface temperature and sub-meter GPS, producing a versioned per-surface
index — separate dirt, turf and synthetic scales — with raw curves permanently retained
and every derived value recomputable.

Validation-gated. No index ships until measured surface state is proven to explain
race-time residual variance that the official going label does not, and that proof is
attempted against existing published data before any hardware is built.

**The asset is the longitudinal surface database and its read API** — consumed by
GateSmart, Furlong and TrackSense — not the instrument.

---

## Prior art

These constrain the build. They are not re-derived.

**UK GoingStick.** Mandatory on British racecourses since March 2007; a reading has been
required at declaration stage and again on raceday since January 2009, published alongside
the Clerk of the Course's subjective description on a 1–15 scale. An objective number
reported next to a subjective label is not a new idea and is not a marketing wedge. It is
a ~17-year public dataset — and that is the opportunity.

**Its known weakness:** operator dependence. Readings vary with the pressure and rate the
individual applies, and the same numeric value maps to different going descriptions at
different courses. Any hand-driven penetrometer inherits this.

**US: RSTL / MQS.** The Racing Surfaces Testing Laboratory runs pre-meet testing with the
Orono Biomechanical Surface Tester, ground-penetrating radar for base inspection, crossfall
and rail checks, and lab material sampling; this satisfies HISA surface requirements. RSTL
is also developing the Lexington Penetrometer for daily measurement and a mesh sensor
network for real-time moisture.

**Implication:** the incumbent holds regulatory standing, track access and superintendent
relationships. Harrow is not entering an empty field. It either finds a gap the incumbent
is not closing, or it becomes the analysis and API layer on top of what already exists.

---

## Non-negotiable rules

1. **Raw is permanent, derived is disposable.** Force-depth curves are never discarded or
   downsampled in storage. Every derived field is recomputable from raw + a stated
   calibration + a stated algorithm version.
2. **Two separate indices, never merged.**
   - `physical_index` — fixed, published, physics-based, versioned. Fit to nothing.
     Describes the surface.
   - `predictive_feature` — fitted against race-time residuals. Lives in the modeling
     layer, consumed by GateSmart/Furlong/TrackSense, never called a measurement and never
     published as a surface score.

   A fitted quantity must never wear a measured quantity's badge.

3. **Three scales, one framework.** Dirt, turf and synthetic are different physics. One
   composite number across all three is meaningless. Shared record format and shared
   pipeline; separate scales and separate weights.
4. **Index versions are immutable.** `physical_index_v1` never changes once published.
   Improvements ship as `v2`; both are computed going forward and backfilled across all
   retained raw data.
5. **Calibration is mandatory.** Every reading references the calibration in effect. An
   uncalibrated reading is stored, flagged, and excluded from index computation — never
   silently included.
6. **Sessions, not readings.** A session is a set of readings at one track on one day under
   a declared sampling pattern. Ad-hoc single readings are recorded but never feed an index.
7. **Operator effect is measured, not assumed away.** Every reading records operator ID and
   drive-rate telemetry. Operator variance is a reported quantity in every validation run.
8. **Nothing ships past a failed gate.** If a kill criterion fires, stop and re-scope.

### The two-index rule, in practice

|              | `physical_index`               | `predictive_feature`                   |
| ------------ | ------------------------------ | -------------------------------------- |
| Derived from | mechanics                      | race-time residuals                    |
| Fitted       | never                          | always                                 |
| Published    | yes, versioned and immutable   | never                                  |
| Lives in     | `packages/index`               | modeling layer (`analysis/`, Phase 6b) |
| Exposed to   | anyone, via the read API       | GateSmart / Furlong / TrackSense only  |
| Changes      | only by shipping a new version | on a refit schedule, version-pinned    |

The separation is enforced in the schema, not only in documentation.

### Index versioning policy

- A version is frozen at publish. Its inputs, weights and algorithm are fixed.
- Improvements are new versions. Old versions keep being computed.
- New versions are backfilled over all retained raw data, so every historical session
  carries a value under every live version.
- Recomputation writes alongside, never in place.
- Every value carries `indexName`, `version`, `derivationVersion`, `calibrationRef` and an
  `inputsHash`. A consumer must be able to reproduce any number it receives.

---

## The measurement record

```
Reading {
  id
  trackId
  sessionId
  surfaceType          enum          // DIRT | TURF | SYNTHETIC
  lat, lon, gpsAccuracy
  distanceFromRail     float | null  // derived, if track geometry known
  pathSegment          enum | null   // RAIL | MID | OUTSIDE — declared at capture
  forceDepthCurve      float[][]     // [depth_mm, force_N][] — raw, never discarded
  driveRateProfile     float[][]     // [t_ms, depth_mm][] — operator telemetry
  driveEnergyJ         float | null  // if controlled-energy mechanism present
  cushionDepth         float         // derived
  baseHardness         float         // derived
  transitionSharpness  float         // derived — cushion/base boundary
  vwc                  float
  surfaceTempC, ambientTempC, humidity
  takenAt
  operatorId
  instrumentId
  calibrationRef       string
  derivationVersion    string        // algorithm version that produced derived fields
  qualityFlags         string[]      // UNCALIBRATED | GPS_POOR | RATE_OUTLIER | ...
}
```

```
Session { id, trackId, surfaceType, date, samplingPattern, operatorId, instrumentId,
          weatherRef, maintenanceLog, officialGoingLabel, notes }
```

Also modeled: `Track`, `TrackGeometry`, `Calibration`, `Instrument`, `Operator`,
`IndexValue { sessionId, indexName, version, value, computedAt, inputsHash }`.

The Prisma schema is written in Phase 5. `packages/db/prisma/schema.prisma` currently
carries only the datasource, the generator, and the constraints that schema must satisfy.

---

## Repo layout

```
harrow/
├─ apps/
│  ├─ api/                 # Fastify — ingest, sessions, index compute, read API
│  └─ field/               # offline-first capture app (PWA)
├─ packages/
│  ├─ db/                  # Prisma schema, migrations, seed
│  ├─ index/               # physical index computation, versioned, pure functions
│  ├─ shared/              # types, zod schemas, units, curve utilities
│  └─ config/              # eslint, tsconfig, prettier bases
├─ analysis/               # Python, uv — validation harness, weight fitting
├─ firmware/               # ESP-IDF — Phase 3
├─ .github/workflows/
└─ docs/
```

## Stack

pnpm 9 · Turborepo · TypeScript strict · Node 20 · Fastify 4 · Prisma · Postgres 16 ·
Railway. Python only in `analysis/`, uv-managed. Firmware in C++ (ESP-IDF), from Phase 3.
Vitest for TypeScript, pytest for Python.

## Dev quickstart

Requires Node ≥20, pnpm ≥9, uv, and a local Postgres 16.

```bash
./scripts/bootstrap.sh
```

Idempotent — existing files are left alone. Pass `--force` to overwrite, `--no-install` to
scaffold without installing. It also creates `.env` from `.env.example` and links
`packages/db/.env` to it, since Prisma resolves `.env` relative to the schema's package.

```bash
createdb harrow && createdb harrow_shadow
```

```bash
pnpm --filter @harrow/db exec prisma migrate deploy && pnpm --filter @harrow/db exec prisma generate
```

```bash
pnpm --filter @harrow/db seed
```

```bash
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm db:validate
```

```bash
pnpm --filter @harrow/api dev
```

```bash
pnpm --filter @harrow/field dev
```

The API tests run against a real Postgres. They exercise idempotency on a unique
constraint, insert-only index values and point-in-time reads, all of which are
properties of the database rather than of the code.

Re-run the curve storage benchmark that decided how raw is stored
([docs/curve-storage-benchmark.md](docs/curve-storage-benchmark.md)):

```bash
pnpm --filter @harrow/db bench
```

```bash
cd analysis && uv sync --all-groups && uv run pytest
```

`analysis/data/` is gitignored. Raw acquisitions are never committed, and every source
and its licensing is documented before ingest.

## The read API

Versioned under `/v1`. Every response carries the index version, derivation version,
calibration ref and quality flags, because a consumer who cannot reproduce a value has
been handed an opinion.

| Route                             | Does                                                 |
| --------------------------------- | ---------------------------------------------------- |
| `GET /v1/index/spec`              | Every published weight, range and rationale          |
| `GET /v1/index`                   | Session index values; `asOf` for point-in-time       |
| `GET /v1/readings`                | Readings with derived scalars and provenance         |
| `GET /v1/readings/:id/curve`      | The raw force-depth curve, base64, never downsampled |
| `GET /v1/export/readings.ndjson`  | Bulk export                                          |
| `POST /v1/sessions` … `/finalize` | Session lifecycle                                    |
| `POST /v1/ingest`                 | Idempotent batch ingest                              |
| `POST /v1/recompute`              | Rerun a derivation version over retained raw         |

Set `API_KEYS` as comma-separated `key:consumer` pairs to turn on auth, per-consumer
rate limits and usage metering. Unset means unauthenticated, which is right for local
development and wrong everywhere else — the server logs a warning at boot.

There is deliberately no route that returns a `predictive_feature`.

## Documents

|                                                                      |                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------ |
| [docs/repo-setup.md](docs/repo-setup.md)                             | GitHub setup, branch protection, required checks |
| [docs/railway.md](docs/railway.md)                                   | Railway services                                 |
| [docs/competitive-landscape.md](docs/competitive-landscape.md)       | What the incumbents do, and what nobody does     |
| [docs/positioning.md](docs/positioning.md)                           | Phase 2 decision — **draft, unsigned**           |
| [docs/phase-1-data-acquisition.md](docs/phase-1-data-acquisition.md) | Source register and licensing                    |
| [docs/phase-1-findings.md](docs/phase-1-findings.md)                 | Validation findings — **gate open**              |
| [docs/curve-storage-benchmark.md](docs/curve-storage-benchmark.md)   | How raw is stored, and why                       |
| [docs/design-system.md](docs/design-system.md)                       | Visual language                                  |

---

## Phases and gates

| Phase | Scope                     | Exit                                          | Kill                              |
| ----- | ------------------------- | --------------------------------------------- | --------------------------------- |
| 0     | Repo, bootstrap, README   | Clean run, CI green, pushed                   | —                                 |
| 1     | UK GoingStick validation  | Stable within-course lift over label          | No lift → stop building a device  |
| 2     | Positioning decision      | Decision written and dated                    | No track access → data-layer only |
| 3     | Firmware prototype        | Repeatable curves, rate controlled            | —                                 |
| 4     | Calibration               | VWC in tolerance; operator < surface variance | Operator effect dominates         |
| 5     | Backend + ingest          | Session imports, queries, recomputes          | —                                 |
| 6     | Index v1 + fitted feature | Feature beats label out of sample             | No beat → publish nothing         |
| 7     | Field app                 | Full offline session captured                 | —                                 |
| 8     | Read API + downstream     | Measurable downstream improvement             | —                                 |

- [x] **Phase 0 — Repo, bootstrap, README.** Bootstrap runs clean on an empty directory,
      CI defined, repo pushed.
- [ ] **Phase 1 — Validation on existing data.** No hardware. Acquire UK flat and national
      hunt results 2009→present with published GoingStick readings; baseline model, then
      incremental R² of the label, then of the GoingStick reading _over_ the label; decompose
      cross-course versus within-course-across-days; test out-of-sample stability by year and
      by course. **Kill: no stable within-course lift → a better hand instrument is not the
      product.**
- [x] **Phase 2 — Positioning decision (blocking).** Recorded and dated 2026-08-26 in
      [docs/positioning.md](docs/positioning.md): buyer is the modeller, critic not vendor,
      **licence rather than build**, data layer alone is viable. Under §8 that means Phases 3
      and 4 do not start; Phase 5 proceeds as ingest for licensed third-party readings.
- [ ] **Phase 3 — Firmware prototype.** _Not started — closed out by the Phase 2 decision.
      Specification held in reserve at [docs/hardware.md](docs/hardware.md)._ Dev-board only. The critical element is drive-rate
      control — controlled energy input, or full rate capture with normalisation and outlier
      rejection. Repeatability is measured on a declared adjacent-point grid and reported as
      combined spatial + instrument variance, with a separate lab-substrate test isolating
      the instrument. You cannot take 20 readings at one spot; the first destroys it.
- [ ] **Phase 4 — Calibration.** _Not started — depends on Phase 3._ Versioned `Calibration` records, VWC referenced against a
      TEROS 12 or equivalent across the moisture range and ≥3 soil compositions with salinity
      correction, force against known masses, load-cell drift with temperature, and an
      operator study. **Kill: operator effect dominates surface effect.**
- [x] **Phase 5 — Backend, schema, ingest.** Prisma schema per the record above, idempotent
      resumable ingest, session lifecycle (open → close → validate → finalize), curve storage
      decided by benchmark, quality flags applied at ingest without mutating raw, and
      recompute machinery that writes alongside. A full session imports, validates, queries
      and recomputes end to end.
- [~] **Phase 6 — Index v1 and the fitted feature.** `physical_index_v1` ships: per surface
  type, weights justified by mechanics and published in full through `/v1/index/spec`,
  frozen and guarded by test. **6b is blocked on Phase 1 data** — `predictive_feature` has
  its own table and no computation, because fitting it needs the race-time residuals that
  the licence conversation gates. The latency and path model is likewise outstanding.
  **Kill: the feature does not beat the label out of sample → publish nothing. An
  unvalidated index is worse than the subjective label, because it looks authoritative.**
- [x] **Phase 7 — Field app.** Offline-first PWA. The declared sampling pattern drives the
      capture order; GPS is gated before the traverse and an override sets a flag; rate
      outliers are rejected at capture with the reading still stored; a retake is displaced
      onto fresh ground, once, because the first reading destroys the point. Sync is
      conflict-free by construction — readings are immutable and keyed by a hash of their own
      bytes — resumable, and integrity-verified. A full 21-point session captures offline and
      syncs clean. **Built but not in use:** the Phase 2 decision means Harrow does not operate
      its own instrument; the live case is forward collection agreed with a racecourse.
- [~] **Phase 8 — Read API.** Versioned REST with per-consumer keys, rate limits and usage
  metering; provenance on every response; point-in-time `asOf` queries. Bulk export is
  NDJSON, not yet Parquet. Downstream integration with GateSmart / Furlong / TrackSense
  has not started, so the phase exit — a measured improvement against a pre-registered
  baseline — remains open.
