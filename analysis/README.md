# analysis

Python, uv-managed. The Phase 1 validation harness, and later the Phase 6b weight fitting.

```bash
uv sync --all-groups
uv run harrow-phase1 --power-sweep
uv run pytest
```

Outputs land in `out/` (gitignored): `phase1_findings.md`, `phase1_summary.json`,
`phase1_power.csv`.

## Running against real data

```bash
uv run harrow-phase1 --data data/uk_races.parquet --out out/uk
```

The file must satisfy the canonical race-level schema in `schema.py` — one row per race,
turf rows carrying a GoingStick reading. `schema.validate()` fails loudly rather than
letting a malformed frame reach a model.

## Modules

| Module          | Does                                                                        |
| --------------- | --------------------------------------------------------------------------- |
| `schema.py`     | Canonical columns, validation, derived fields, between-course ICC           |
| `synthetic.py`  | Generated worlds with a known effect size, and a null world                 |
| `models.py`     | The M0 → M1 → M2 ladder and label discrimination                            |
| `validation.py` | Decomposition, expanding window by year, held-out racedays, per-course lift |
| `report.py`     | Markdown rendering                                                          |
| `cli.py`        | `harrow-phase1`                                                             |

## Rules this code is bound by

- Nothing here produces a published surface score. Everything fitted is a
  `predictive_feature` (rule §2.2) and is labelled as such.
- `data/` is gitignored. Raw acquisitions are never committed, and every source and its
  licensing is documented in [../docs/phase-1-data-acquisition.md](../docs/phase-1-data-acquisition.md)
  before ingest.
- A report generated from synthetic data says so, in its own first paragraph.
