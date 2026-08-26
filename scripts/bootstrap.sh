#!/usr/bin/env bash
# Harrow infrastructure bootstrap — Phase 0.
# Idempotent: existing files are left alone unless --force is passed.
# Usage: ./scripts/bootstrap.sh [--force] [--no-install]
set -euo pipefail

FORCE=0
INSTALL=1
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --no-install) INSTALL=0 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say()  { printf '  %s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }

# write <path> <<'EOF' ... EOF  — writes only if absent (or --force)
write() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  if [[ -e "$path" && $FORCE -eq 0 ]]; then
    cat >/dev/null   # drain heredoc
    say "skip   $path"
  else
    cat > "$path"
    say "write  $path"
  fi
}

step "Preflight"
command -v node >/dev/null || { echo "node not found (need >=20)"; exit 1; }
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
(( NODE_MAJOR >= 20 )) || { echo "node >=20 required, found $(node -v)"; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm not found — 'corepack enable && corepack prepare pnpm@9.15.0 --activate'"; exit 1; }
PNPM_MAJOR="$(pnpm -v | cut -d. -f1)"
(( PNPM_MAJOR >= 9 )) || { echo "pnpm >=9 required, found $(pnpm -v)"; exit 1; }
command -v uv >/dev/null || say "WARN: uv not found — analysis/ will be scaffolded but not synced"
say "node $(node -v), pnpm $(pnpm -v)"

step "Directory layout"
mkdir -p apps/api/src apps/field packages/db/prisma packages/index/src packages/shared/src \
         packages/config/eslint packages/config/tsconfig packages/config/prettier \
         analysis/src/harrow_analysis analysis/tests analysis/data analysis/notebooks \
         firmware docs .github/workflows scripts
say "ok"

step "Root workspace"

write package.json <<'EOF'
{
  "name": "harrow",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "turbo run build",
    "dev": "turbo run dev",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "db:validate": "pnpm --filter @harrow/db exec prisma validate",
    "db:generate": "pnpm --filter @harrow/db exec prisma generate",
    "db:migrate": "pnpm --filter @harrow/db exec prisma migrate dev"
  },
  "devDependencies": {
    "@harrow/config": "workspace:*",
    "@types/node": "^20.17.10",
    "eslint": "^9.17.0",
    "prettier": "^3.4.2",
    "turbo": "^2.3.3",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  }
}
EOF

write pnpm-workspace.yaml <<'EOF'
packages:
  - "apps/*"
  - "packages/*"
EOF

write turbo.json <<'EOF'
{
  "$schema": "https://turbo.build/schema.json",
  "globalEnv": ["DATABASE_URL", "NODE_ENV"],
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "typecheck": { "dependsOn": ["^build"] },
    "lint": {},
    "test": { "dependsOn": ["^build"] },
    "dev": { "cache": false, "persistent": true }
  }
}
EOF

write .npmrc <<'EOF'
engine-strict=true
strict-peer-dependencies=false
EOF

write .nvmrc <<'EOF'
20
EOF

write .gitignore <<'EOF'
# node
node_modules/
.pnpm-store/
*.tsbuildinfo

# build artifacts
dist/
build/
out/
.turbo/
coverage/

# env
.env
.env.*
!.env.example

# python
__pycache__/
*.py[cod]
.venv/
venv/
.pytest_cache/
.ruff_cache/
.ipynb_checkpoints/

# analysis data — raw acquisitions are never committed
analysis/data/
*.csv
*.parquet

# firmware
firmware/build/
sdkconfig.old

# os / editor
.DS_Store
.idea/
.vscode/*
!.vscode/extensions.json
EOF

write .env.example <<'EOF'
# Postgres 16
DATABASE_URL="postgresql://harrow:harrow@localhost:5432/harrow?schema=public"
# Shadow DB used by prisma migrate dev (local only)
SHADOW_DATABASE_URL="postgresql://harrow:harrow@localhost:5432/harrow_shadow?schema=public"

NODE_ENV=development
API_PORT=3000
API_HOST=0.0.0.0
LOG_LEVEL=info
EOF

write .prettierrc.json <<'EOF'
{
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "printWidth": 100
}
EOF

write .prettierignore <<'EOF'
node_modules
dist
.turbo
coverage
analysis/data
pnpm-lock.yaml
EOF

write eslint.config.mjs <<'EOF'
import base from '@harrow/config/eslint/base.js';

export default [
  ...base,
  { ignores: ['**/dist/**', '**/.turbo/**', '**/node_modules/**', 'analysis/**', 'firmware/**'] },
];
EOF

step "packages/config"

write packages/config/package.json <<'EOF'
{
  "name": "@harrow/config",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./eslint/base.js": "./eslint/base.js",
    "./tsconfig/base.json": "./tsconfig/base.json",
    "./tsconfig/node.json": "./tsconfig/node.json",
    "./tsconfig/lib.json": "./tsconfig/lib.json"
  },
  "scripts": {
    "lint": "echo 'no sources'",
    "typecheck": "echo 'no sources'",
    "test": "echo 'no tests'"
  },
  "dependencies": {
    "@eslint/js": "^9.17.0",
    "eslint-config-prettier": "^9.1.0",
    "typescript-eslint": "^8.18.0"
  }
}
EOF

write packages/config/tsconfig/base.json <<'EOF'
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "resolveJsonModule": true,
    "strict": true,
    "noImplicitOverride": true,
    "noUncheckedIndexedAccess": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
EOF

write packages/config/tsconfig/lib.json <<'EOF'
{
  "extends": "./base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*"]
}
EOF

write packages/config/tsconfig/node.json <<'EOF'
{
  "extends": "./lib.json",
  "compilerOptions": {
    "types": ["node"]
  }
}
EOF

write packages/config/eslint/base.js <<'EOF'
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];
EOF

write tsconfig.json <<'EOF'
{
  "files": [],
  "references": [
    { "path": "packages/shared" },
    { "path": "packages/index" },
    { "path": "packages/db" },
    { "path": "apps/api" }
  ]
}
EOF

step "packages/shared"

write packages/shared/package.json <<'EOF'
{
  "name": "@harrow/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc -b --noEmit false --emitDeclarationOnly",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "devDependencies": {
    "@harrow/config": "workspace:*",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  },
  "dependencies": {
    "zod": "^3.24.1"
  }
}
EOF

write packages/shared/tsconfig.json <<'EOF'
{
  "extends": "@harrow/config/tsconfig/lib.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
EOF

write packages/shared/src/index.ts <<'EOF'
// Phase 0 placeholder. Types, zod schemas, units and curve utilities land in Phase 5.
export const PACKAGE_NAME = '@harrow/shared' as const;
EOF

write packages/shared/src/index.test.ts <<'EOF'
import { expect, test } from 'vitest';
import { PACKAGE_NAME } from './index.js';

test('package identifies itself', () => {
  expect(PACKAGE_NAME).toBe('@harrow/shared');
});
EOF

step "packages/index"

write packages/index/package.json <<'EOF'
{
  "name": "@harrow/index",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" } },
  "scripts": {
    "build": "tsc -b",
    "typecheck": "tsc -b --noEmit false --emitDeclarationOnly",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "devDependencies": {
    "@harrow/config": "workspace:*",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  },
  "dependencies": {
    "@harrow/shared": "workspace:*"
  }
}
EOF

write packages/index/tsconfig.json <<'EOF'
{
  "extends": "@harrow/config/tsconfig/lib.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"],
  "references": [{ "path": "../shared" }]
}
EOF

write packages/index/src/index.ts <<'EOF'
// Phase 0 placeholder.
//
// Rule §2.2: this package computes physical_index ONLY — physics-based, published,
// immutable per version, fit to nothing. The fitted predictive_feature lives in the
// modeling layer (analysis/ + Phase 6b) and must never be computed here.
// Rule §2.4: a published version is frozen. Improvements ship as a new version.
export const INDEX_VERSIONS = [] as const;
EOF

write packages/index/src/index.test.ts <<'EOF'
import { expect, test } from 'vitest';
import { INDEX_VERSIONS } from './index.js';

test('no index version is published before Phase 6', () => {
  expect(INDEX_VERSIONS).toHaveLength(0);
});
EOF

step "packages/db (Prisma / Postgres 16)"

write packages/db/package.json <<'EOF'
{
  "name": "@harrow/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "echo 'no sources yet'",
    "lint": "echo 'no sources yet'",
    "test": "echo 'no tests yet'",
    "validate": "prisma validate",
    "generate": "prisma generate",
    "migrate": "prisma migrate dev"
  },
  "devDependencies": {
    "prisma": "^6.1.0"
  },
  "dependencies": {
    "@prisma/client": "^6.1.0"
  }
}
EOF

write packages/db/tsconfig.json <<'EOF'
{
  "extends": "@harrow/config/tsconfig/node.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"]
}
EOF

write packages/db/prisma/schema.prisma <<'EOF'
// Harrow — Phase 0 scaffold. Models are deliberately absent.
// The measurement record (Reading, Session, Track, TrackGeometry, Calibration,
// Instrument, Operator, IndexValue) is defined in Phase 5, not before.
//
// Constraints that the Phase 5 schema must honour:
//   §2.1 raw force-depth curves are permanent and never downsampled in storage
//   §2.2 physical_index and predictive_feature are stored separately; the fitted
//        value must not be reachable from any surface that publishes measurements
//   §2.5 every reading references a Calibration; uncalibrated readings are stored,
//        flagged, and excluded from index computation
//   §2.6 index computation consumes Sessions, never loose Readings

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
EOF

write packages/db/src/index.ts <<'EOF'
// Phase 0 placeholder — client export lands with the Phase 5 schema.
export const DB_PACKAGE = '@harrow/db' as const;
EOF

write packages/db/README.md <<'EOF'
# @harrow/db

Prisma schema, migrations and seed for Harrow. Targets Postgres 16.

Schema is empty by design until Phase 5. See `prisma/schema.prisma` for the
constraints the Phase 5 model set must satisfy.

```bash
cp ../../.env.example ../../.env   # then edit DATABASE_URL
pnpm --filter @harrow/db exec prisma validate
pnpm --filter @harrow/db exec prisma migrate dev
```
EOF

step "apps/api"

write apps/api/package.json <<'EOF'
{
  "name": "@harrow/api",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -b",
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js",
    "typecheck": "tsc -b --noEmit false --emitDeclarationOnly",
    "lint": "eslint src",
    "test": "vitest run"
  },
  "devDependencies": {
    "@harrow/config": "workspace:*",
    "@types/node": "^20.17.10",
    "tsx": "^4.19.2",
    "typescript": "^5.7.2",
    "vitest": "^2.1.8"
  },
  "dependencies": {
    "@harrow/index": "workspace:*",
    "@harrow/shared": "workspace:*",
    "fastify": "^4.29.0"
  }
}
EOF

write apps/api/tsconfig.json <<'EOF'
{
  "extends": "@harrow/config/tsconfig/node.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"],
  "references": [{ "path": "../../packages/shared" }, { "path": "../../packages/index" }]
}
EOF

write apps/api/src/app.ts <<'EOF'
import Fastify, { type FastifyInstance } from 'fastify';

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });
  app.get('/health', async () => ({ status: 'ok' }));
  return app;
}
EOF

write apps/api/src/server.ts <<'EOF'
import { buildApp } from './app.js';

const app = buildApp();
const port = Number(process.env.API_PORT ?? 3000);
const host = process.env.API_HOST ?? '0.0.0.0';

app.listen({ port, host }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
EOF

write apps/api/src/app.test.ts <<'EOF'
import { expect, test } from 'vitest';
import { buildApp } from './app.js';

test('health endpoint responds', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/health' });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toEqual({ status: 'ok' });
  await app.close();
});
EOF

step "Deferred surfaces (placeholder READMEs only)"

write apps/field/README.md <<'EOF'
# apps/field — capture app

Deferred to **Phase 7**. No code in this directory before Phases 5 and 6 clear.

The app is the sampling protocol: it enforces the declared pattern, displays the live
force-depth curve, rejects rate outliers at capture time, gates on GPS accuracy, and
syncs offline-first.
EOF

write firmware/README.md <<'EOF'
# firmware — ESP-IDF

Deferred to **Phase 3**, and only if Phases 1 and 2 both clear. No code here before then.

Target hardware (dev-board only at Phase 3): ESP32-S3, load cell + HX711 paired with a
linear position sensor, capacitive VWC with salinity correction, SHT40 + probe thermistor,
u-blox NEO-M9N. Raw logged at full rate to SD in a versioned binary format with a
documented decoder.

The open design decision is drive-rate control — controlled energy input versus full
drive-rate capture with normalisation and outlier rejection. It is documented before it
is built.
EOF

step "analysis/ (Python, uv)"

write analysis/pyproject.toml <<'EOF'
[project]
name = "harrow-analysis"
version = "0.0.0"
description = "Harrow validation harness and weight fitting"
requires-python = ">=3.11,<3.13"
dependencies = [
  "pandas==2.2.3",
  "numpy==2.1.3",
  "statsmodels==0.14.4",
  "scikit-learn==1.6.0",
  "pyarrow==18.1.0",
]

[dependency-groups]
dev = [
  "pytest==8.3.4",
  "ruff==0.8.4",
]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/harrow_analysis"]

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
EOF

write analysis/src/harrow_analysis/__init__.py <<'EOF'
"""Harrow analysis package.

Phase 1 lives here: the validation harness that tests whether an objective,
professionally-operated surface instrument (UK GoingStick) explains race-time
residual variance that the official going label does not.

Nothing in this package produces a published surface score. Fitted quantities are
predictive features (rule §2.2) and are labelled as such.
"""

__version__ = "0.0.0"
EOF

write analysis/tests/test_smoke.py <<'EOF'
from harrow_analysis import __version__


def test_package_imports() -> None:
    assert __version__ == "0.0.0"
EOF

write analysis/README.md <<'EOF'
# analysis

Python, uv-managed. Phase 1 validation harness and Phase 6b weight fitting.

```bash
uv sync
uv run pytest
```

`analysis/data/` is gitignored. Raw acquisitions are never committed; every source and
its licensing is documented before ingest.
EOF

write analysis/data/.gitkeep <<'EOF'
EOF

write analysis/notebooks/.gitkeep <<'EOF'
EOF

step "Railway"

write railway.json <<'EOF'
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS",
    "buildCommand": "pnpm install --frozen-lockfile && pnpm --filter @harrow/db exec prisma generate && pnpm build"
  },
  "deploy": {
    "startCommand": "pnpm --filter @harrow/api start",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 3
  }
}
EOF

write docs/railway.md <<'EOF'
# Railway services

Two services in one Railway project. Config lives in `railway.json` at the repo root;
this file records what must be created in the Railway UI/CLI, which is not
version-controlled.

| Service | Type | Notes |
|---|---|---|
| `harrow-postgres` | Postgres 16 plugin | Provides `DATABASE_URL` |
| `harrow-api` | Repo service, root `/` | Uses `railway.json`; healthcheck `/health` |

```bash
railway login
railway init --name harrow
railway add --database postgres
railway up
railway variables --set "NODE_ENV=production" --set "API_HOST=0.0.0.0"
```

`DATABASE_URL` is referenced from the Postgres service, never pasted. Migrations are run
as an explicit deploy step, not on boot — a service restart must never mutate the schema.
EOF

step "CI"

write .github/workflows/ci.yml <<'EOF'
name: ci

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  DATABASE_URL: postgresql://harrow:harrow@localhost:5432/harrow?schema=public

jobs:
  node:
    name: ${{ matrix.task }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        task: [lint, typecheck, test]
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm ${{ matrix.task }}

  format:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm format:check

  prisma:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9.15.0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm db:validate
EOF

write .github/workflows/analysis.yml <<'EOF'
name: analysis

on:
  push:
    branches: [main]
    paths: ["analysis/**", ".github/workflows/analysis.yml"]
  pull_request:
    paths: ["analysis/**", ".github/workflows/analysis.yml"]

jobs:
  pytest:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: analysis
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
        with:
          enable-cache: true
      - run: uv sync --all-groups
      - run: uv run ruff check .
      - run: uv run pytest
EOF

write .github/pull_request_template.md <<'EOF'
## What changed

## Phase / gate
<!-- Which roadmap phase does this belong to? If it crosses a gate, link the evidence. -->

## Rule check (§2)
- [ ] No raw force-depth data is discarded, downsampled, or mutated in place
- [ ] No fitted quantity is presented, named, or stored as a measurement
- [ ] Any published index version touched here is new — no published version was edited
- [ ] Derived values remain recomputable from raw + calibration + stated algorithm version
EOF

step "Local env"
if [[ ! -f .env ]]; then cp .env.example .env; say "write  .env (from .env.example)"; else say "skip   .env"; fi
# Prisma resolves .env relative to the schema's package. Link it so there is exactly one
# source of truth locally; in CI, DATABASE_URL comes from the workflow env instead.
if [[ ! -e packages/db/.env ]]; then ln -s ../../.env packages/db/.env; say "link   packages/db/.env -> ../../.env"; else say "skip   packages/db/.env"; fi

step "Install"
if [[ $INSTALL -eq 1 ]]; then
  pnpm install
  if command -v uv >/dev/null; then (cd analysis && uv sync --all-groups); fi
else
  say "skipped (--no-install)"
fi

step "Format"
if [[ $INSTALL -eq 1 ]]; then
  pnpm exec prettier --write . --log-level warn
  say "ok"
else
  say "skipped (--no-install)"
fi

printf '\n== Bootstrap complete\n'
say "next: edit .env, then pnpm build && pnpm test"
