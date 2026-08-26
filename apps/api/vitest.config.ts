import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// The integration tests need a real Postgres. Load the repo .env the way the dev
// scripts do, so `pnpm test` and `pnpm dev` see the same database.
try {
  for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m?.[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2]!.replace(/^"(.*)"$/, '$1');
    }
  }
} catch {
  // No .env — CI supplies DATABASE_URL directly.
}

export default defineConfig({
  test: {
    // Integration tests share one database; running files in parallel would let them
    // delete each other's fixtures.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
