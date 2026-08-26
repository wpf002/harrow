# 0.1 — GitHub repo setup

Run from the repo root, in order. Everything here is one-time.

## 1. Initialise and commit

`.gitignore` is written by `scripts/bootstrap.sh` (Node, Python, `analysis/data/`, `.env`,
build artifacts, `*.csv`, `*.parquet`). Run the bootstrap before the first commit.

```bash
git init -b main
```

```bash
git add -A && git status --short
```

Confirm before committing that `.env`, `node_modules/`, `.venv/`, `dist/`, `.turbo/` and
`analysis/data/` are absent from the staged list, and that `pnpm-lock.yaml` and
`analysis/uv.lock` are present — both lockfiles are committed, CI installs frozen.

```bash
git commit -m "Phase 0: bootstrap, CI, README"
```

## 2. Remote

```bash
git remote add origin git@github.com:wpf002/harrow.git
```

If the remote repository does not exist yet:

```bash
gh repo create wpf002/harrow --private --source=. --remote=origin
```

```bash
git push -u origin main
```

## 3. Branch protection

Apply after the first push, so the check names exist. Required status checks, exactly as
the workflows name them:

| Check       | Workflow       | Job           |
| ----------- | -------------- | ------------- |
| `lint`      | `ci.yml`       | `node` matrix |
| `typecheck` | `ci.yml`       | `node` matrix |
| `test`      | `ci.yml`       | `node` matrix |
| `format`    | `ci.yml`       | `format`      |
| `prisma`    | `ci.yml`       | `prisma`      |
| `pytest`    | `analysis.yml` | `pytest`      |

`pytest` is path-filtered — it does not run on PRs that leave `analysis/` untouched, so
it must be marked required only if you accept that such PRs will sit pending. Leave it
off the required list unless and until `analysis.yml` drops its `paths:` filter.

```bash
gh api -X PUT repos/wpf002/harrow/branches/main/protection \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["lint", "typecheck", "test", "format", "prisma"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
```

Solo work: set `"required_approving_review_count": 0` and keep everything else. The
value of protection here is the status checks and the force-push block, not the review.

```bash
gh api -X PATCH repos/wpf002/harrow \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false \
  -F delete_branch_on_merge=true
```

## 4. Verify

```bash
gh api repos/wpf002/harrow/branches/main/protection --jq '.required_status_checks.contexts'
```

Open a throwaway PR and confirm all five checks run and block the merge button until green.
