# Railway services

Two services in one Railway project. Config lives in `railway.json` at the repo root;
this file records what must be created in the Railway UI/CLI, which is not
version-controlled.

| Service           | Type                   | Notes                                      |
| ----------------- | ---------------------- | ------------------------------------------ |
| `harrow-postgres` | Postgres 16 plugin     | Provides `DATABASE_URL`                    |
| `harrow-api`      | Repo service, root `/` | Uses `railway.json`; healthcheck `/health` |

```bash
railway login
railway init --name harrow
railway add --database postgres
railway up
railway variables --set "NODE_ENV=production" --set "API_HOST=0.0.0.0"
```

`DATABASE_URL` is referenced from the Postgres service, never pasted. Migrations are run
as an explicit deploy step, not on boot — a service restart must never mutate the schema.
