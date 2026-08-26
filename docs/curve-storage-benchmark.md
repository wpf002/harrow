# Curve storage decision

§11 requires this to be decided "with a documented benchmark at projected volume".
Run 2026-08-26 on Postgres 16.14, local, `pnpm --filter @harrow/db bench`.

Rule §2.1 makes it load-bearing: raw curves are permanent and never downsampled, so this
choice is carried for the life of the dataset.

## Projected volume

```
~60 tracks x ~300 measuring days x ~40 readings   = ~720,000 readings/year
~1,000 samples per curve x 2 values (depth, force)
```

## Candidates

|     | Storage                                | Queryable in SQL | Lossless |
| --- | -------------------------------------- | ---------------- | -------- |
| A   | `double precision[]`, flat interleaved | yes              | yes      |
| B   | `bytea`, packed float64                | no               | yes      |
| C   | `bytea`, packed float32                | no               | **no**   |

## Results — 2,000 readings x 1,000 samples (32 MB of float64)

| Operation                    | A array   | B bytea f64   | C bytea f32 |
| ---------------------------- | --------- | ------------- | ----------- |
| Insert 2,000                 | 3,555 ms  | **749 ms**    | 251 ms      |
| Read 1 row by id, x200       | 123 ms    | **16 ms**     | 11 ms       |
| Read 500 rows, one query     | 222 ms    | **22 ms**     | 4 ms        |
| Peak force per curve, in SQL | 224 ms    | n/a           | n/a         |
| Total relation size          | 24 MB     | 24 MB         | 16 MB       |
| **At projected volume**      | 9.0 GB/yr | **9.0 GB/yr** | 6.1 GB/yr   |
| Max round-trip error         | 0         | **0**         | 5.87e-5     |

## Decision: B — `bytea`, packed float64

- **4.7x faster to write, 7.7x faster to read one, 10x faster to read many.** Ingest is a
  bulk operation and recompute (§11) rereads every curve in the archive; both are exactly
  the access patterns arrays are worst at.
- **Identical storage to arrays.** TOAST compresses the array representation down to the
  same 24 MB, so the array's SQL-queryability is not being bought with disk — it is bought
  with a 10x read penalty.
- **C is rejected outright.** float32 halves storage and is the fastest option, and it
  loses mantissa bits. A max round-trip error of 5.9e-5 N is physically negligible and
  contractually fatal: §2.1 says raw is never downsampled, and silently discarding
  precision at write time is downsampling with better manners. Rejected on the rule, not
  on the number.
- **9 GB/year is not a problem.** A decade fits comfortably in a single Postgres instance.
  Object storage is not needed yet, and adding it now would be complexity bought against a
  volume that does not exist.

## Consequences

1. Every curve column is accompanied by `*SampleCount` and `*Encoding`. The encoding
   string is versioned and documented, never inferred.
2. Layout, fixed and asserted in tests:
   `f64le` little-endian IEEE-754 doubles, interleaved `[depth_mm, force_N, ...]`,
   `2 x sampleCount` values, no header, no padding.
3. **Derived scalars are stored as columns.** Losing SQL-side curve math is only
   acceptable because `cushionDepth`, `baseHardness`, `transitionSharpness` and peak force
   are materialised at ingest and recomputed by version. Anything the API needs to filter
   or aggregate on must be a column, not a curve traversal.
4. Bulk export uses Parquet sidecars (§14), generated on demand. That is an export format,
   not the store of record.

## Revisit when

- A single track exceeds ~50 GB of curves, or
- an access pattern appears that genuinely needs per-sample SQL filtering across the whole
  archive, or
- sample counts rise by an order of magnitude — a 10,000-sample curve changes the
  arithmetic and the decision should be re-run, not assumed.
