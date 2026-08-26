/**
 * Phase 5 benchmark — how to store a force-depth curve.
 *
 * Rule §2.1 makes this decision load-bearing: raw curves are permanent and are never
 * downsampled, so whatever this picks is carried for the life of the dataset.
 *
 * Projected volume, stated so the numbers below mean something:
 *   ~60 tracks x ~300 measuring days x ~40 readings  = ~720,000 readings/year
 *   ~1,000 samples per curve x 2 values (depth, force)
 *
 * Candidates:
 *   A  double precision[]   — flat [d0,f0,d1,f1,...], queryable in SQL
 *   B  bytea, float64       — packed, lossless, opaque to SQL
 *   C  bytea, float32       — packed, HALVES the storage, loses mantissa bits
 *
 * Run: pnpm --filter @harrow/db bench
 */
import { performance } from 'node:perf_hooks';
import { Client } from 'pg';

const N_READINGS = Number(process.env.BENCH_N ?? 2000);
const N_SAMPLES = Number(process.env.BENCH_SAMPLES ?? 1000);

type Curve = Float64Array;

function makeCurve(seed: number): Curve {
  // A plausible cushion-then-base profile: soft linear rise, then a knee, then stiff.
  const out = new Float64Array(N_SAMPLES * 2);
  const knee = 60 + (seed % 40);
  for (let i = 0; i < N_SAMPLES; i++) {
    const depth = (i / N_SAMPLES) * 180;
    const force =
      depth < knee ? 4 + depth * 1.8 : 4 + knee * 1.8 + (depth - knee) * 9.4 + Math.sin(i) * 0.5;
    out[i * 2] = depth;
    out[i * 2 + 1] = force;
  }
  return out;
}

function toBytes64(c: Curve): Buffer {
  return Buffer.from(c.buffer, c.byteOffset, c.byteLength);
}

function toBytes32(c: Curve): Buffer {
  const f32 = Float32Array.from(c);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

async function time<T>(label: string, fn: () => Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const value = await fn();
  const ms = performance.now() - t0;
  console.log(`  ${label.padEnd(34)} ${ms.toFixed(0).padStart(7)} ms`);
  return [value, ms];
}

async function main(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(`
    drop table if exists bench_arr, bench_b64, bench_b32;
    create table bench_arr (id int primary key, curve double precision[]);
    create table bench_b64 (id int primary key, n int, curve bytea);
    create table bench_b32 (id int primary key, n int, curve bytea);
  `);

  const curves = Array.from({ length: N_READINGS }, (_, i) => makeCurve(i));
  console.log(
    `\nfixture: ${N_READINGS} readings x ${N_SAMPLES} samples ` +
      `(${((N_READINGS * N_SAMPLES * 2 * 8) / 1e6).toFixed(1)} MB of float64)\n`,
  );

  console.log('insert');
  await time('A  double precision[]', async () => {
    for (let i = 0; i < curves.length; i++) {
      await client.query('insert into bench_arr values ($1, $2)', [i, Array.from(curves[i]!)]);
    }
  });
  await time('B  bytea float64', async () => {
    for (let i = 0; i < curves.length; i++) {
      await client.query('insert into bench_b64 values ($1, $2, $3)', [
        i,
        N_SAMPLES,
        toBytes64(curves[i]!),
      ]);
    }
  });
  await time('C  bytea float32', async () => {
    for (let i = 0; i < curves.length; i++) {
      await client.query('insert into bench_b32 values ($1, $2, $3)', [
        i,
        N_SAMPLES,
        toBytes32(curves[i]!),
      ]);
    }
  });

  console.log('\nread 1 row by id (x200)');
  for (const t of ['bench_arr', 'bench_b64', 'bench_b32']) {
    await time(t, async () => {
      for (let i = 0; i < 200; i++) {
        await client.query(`select curve from ${t} where id = $1`, [i]);
      }
    });
  }

  console.log('\nread 500 rows in one query');
  for (const t of ['bench_arr', 'bench_b64', 'bench_b32']) {
    await time(t, async () => {
      await client.query(`select curve from ${t} where id < 500`);
    });
  }

  console.log('\nSQL-side computation (peak force per curve, all rows)');
  await time('A  unnest + max', async () => {
    await client.query(`
      select id, max(v) from (
        select id, unnest(curve) as v from bench_arr
      ) s group by id
    `);
  });
  console.log('  B/C  bytea                              n/a — opaque to SQL');

  console.log('\nstorage (total relation size, incl. TOAST)');
  const sizes = await client.query<{ t: string; bytes: string; pretty: string }>(`
    select t, pg_total_relation_size(t) as bytes, pg_size_pretty(pg_total_relation_size(t)) as pretty
    from (values ('bench_arr'), ('bench_b64'), ('bench_b32')) as x(t)
  `);
  const perYear = 720_000 / N_READINGS;
  for (const r of sizes.rows) {
    const gbYear = (Number(r.bytes) * perYear) / 1e9;
    console.log(
      `  ${r.t.padEnd(34)} ${r.pretty.padStart(10)}   ->  ${gbYear.toFixed(1)} GB/year at projected volume`,
    );
  }

  console.log('\nround-trip fidelity');
  const a = await client.query('select curve from bench_b64 where id = 7');
  const back = new Float64Array(
    (a.rows[0].curve as Buffer).buffer,
    (a.rows[0].curve as Buffer).byteOffset,
    N_SAMPLES * 2,
  );
  const orig = curves[7]!;
  let maxErr64 = 0;
  for (let i = 0; i < orig.length; i++)
    maxErr64 = Math.max(maxErr64, Math.abs(back[i]! - orig[i]!));
  const c = await client.query('select curve from bench_b32 where id = 7');
  const back32 = new Float32Array(
    (c.rows[0].curve as Buffer).buffer,
    (c.rows[0].curve as Buffer).byteOffset,
    N_SAMPLES * 2,
  );
  let maxErr32 = 0;
  for (let i = 0; i < orig.length; i++)
    maxErr32 = Math.max(maxErr32, Math.abs(back32[i]! - orig[i]!));
  console.log(`  B  float64 max abs error               ${maxErr64}`);
  console.log(`  C  float32 max abs error               ${maxErr32.toExponential(3)}`);

  await client.query('drop table bench_arr, bench_b64, bench_b32');
  await client.end();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
