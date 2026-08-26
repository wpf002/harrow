# @harrow/db

Prisma schema, migrations and seed for Harrow. Targets Postgres 16.

Schema is empty by design until Phase 5. See `prisma/schema.prisma` for the
constraints the Phase 5 model set must satisfy.

```bash
cp ../../.env.example ../../.env   # then edit DATABASE_URL
pnpm --filter @harrow/db exec prisma validate
pnpm --filter @harrow/db exec prisma migrate dev
```
