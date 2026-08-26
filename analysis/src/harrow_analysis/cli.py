"""Single-command entry point for the Phase 1 harness.

    uv run harrow-phase1                      # synthetic, default effect size
    uv run harrow-phase1 --power-sweep        # + detectability curve
    uv run harrow-phase1 --data path.parquet  # a real acquisition

Writes a markdown findings document and a JSON summary. Deterministic: the same
arguments produce byte-identical output.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

import pandas as pd

from . import models, report, schema, synthetic, validation

DEFAULT_OUT = Path("out")


def _load(path: Path) -> pd.DataFrame:
    if path.suffix == ".parquet":
        return pd.read_parquet(path)
    if path.suffix in (".csv", ".gz"):
        return pd.read_csv(path, parse_dates=["date"])
    raise SystemExit(f"unsupported data file: {path} (want .parquet or .csv)")


def _power_sweep(gammas: list[float], base: synthetic.SyntheticConfig) -> pd.DataFrame:
    from dataclasses import replace

    rows: list[dict[str, object]] = []
    for g in gammas:
        df = schema.prepare(synthetic.generate(replace(base, gamma=g)))
        ladder = models.run_ladder(df)
        inc = ladder.increments[-1]
        coef = ladder.going_stick_coef
        rows.append(
            {
                "true_gamma": g,
                "within_partial_r2": inc.partial_r2,
                "within_delta_r2": inc.delta_r2,
                "p": inc.p_value,
                "gs_coef": coef.estimate if coef else float("nan"),
                "gs_ci_low": coef.ci_low if coef else float("nan"),
                "gs_ci_high": coef.ci_high if coef else float("nan"),
            }
        )
    return pd.DataFrame(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="harrow-phase1", description=__doc__)
    ap.add_argument("--data", type=Path, help="parquet/csv in the canonical schema")
    ap.add_argument("--effect", type=float, default=0.010, help="synthetic gamma")
    ap.add_argument("--null", action="store_true", help="synthetic run with gamma = 0")
    ap.add_argument("--seed", type=int, default=20090101)
    ap.add_argument("--years", type=int, default=16, help="synthetic seasons")
    ap.add_argument("--power-sweep", action="store_true")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    is_synthetic = args.data is None
    true_gamma: float | None = None
    cfg: synthetic.SyntheticConfig | None = None

    if is_synthetic:
        gamma = 0.0 if args.null else args.effect
        cfg = synthetic.SyntheticConfig(
            gamma=gamma,
            seed=args.seed,
            year_start=2009,
            year_end=2009 + args.years - 1,
        )
        raw = synthetic.generate(cfg)
        true_gamma = gamma
        source = f"synthetic(gamma={gamma}, seed={args.seed}, years={args.years})"
    else:
        raw = _load(args.data)
        source = str(args.data)

    schema_report = schema.validate(raw)
    df = schema.prepare(raw)

    ladder = models.run_ladder(df)
    decomposition = validation.decompose(df)
    by_year = validation.expanding_window_by_year(df)
    by_fold = validation.holdout_racedays(df)
    by_course = validation.per_course_lift(df)
    discrimination = models.label_discrimination(df)

    power = None
    if args.power_sweep and cfg is not None:
        power = _power_sweep([0.0, 0.002, 0.005, 0.010, 0.020], cfg)

    md = report.render(
        source=source,
        synthetic=is_synthetic,
        schema=schema_report,
        ladder=ladder,
        decomposition=decomposition,
        by_year=by_year,
        by_fold=by_fold,
        by_course=by_course,
        discrimination=discrimination,
        power=power,
        true_gamma=true_gamma,
    )

    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "phase1_findings.md").write_text(md, encoding="utf-8")

    summary = {
        "source": source,
        "synthetic": is_synthetic,
        "true_gamma": true_gamma,
        "sample": {
            **{k: (str(v) if hasattr(v, "isoformat") else v)
               for k, v in asdict(schema_report).items()}
        },
        "fits": [asdict(f) for f in ladder.fits],
        "increments": [asdict(i) for i in ladder.increments],
        "going_stick_coef": asdict(ladder.going_stick_coef) if ladder.going_stick_coef else None,
        "decomposition": {
            **asdict(decomposition),
            "share_from_course_identity": decomposition.share_of_lift_that_is_course_identity,
        },
        "oos_by_year_mean_delta": float(by_year["delta"].mean()) if len(by_year) else None,
        "oos_by_fold_mean_delta": float(by_fold["delta"].mean()) if len(by_fold) else None,
        "n_courses_with_positive_delta": int((by_course["delta_r2"] > 0).sum())
        if len(by_course)
        else 0,
        "n_courses_evaluated": len(by_course),
    }
    (out_dir / "phase1_summary.json").write_text(
        json.dumps(summary, indent=2, default=str), encoding="utf-8"
    )
    if power is not None:
        power.to_csv(out_dir / "phase1_power.csv", index=False)

    if not args.quiet:
        inc = ladder.increments[-1]
        print(f"source                : {source}")
        print(f"races (turf, with GS) : {inc.n}")
        print(f"within-course partial : {inc.partial_r2:+.5f}  (p = {inc.p_value:.3g})")
        print(f"pooled partial        : {decomposition.pooled_partial_r2:+.5f}")
        print(f"course-identity share : {decomposition.share_of_lift_that_is_course_identity:.3f}")
        print(f"OOS by year, mean d   : {by_year['delta_partial'].mean():+.5f}")
        print(f"OOS by raceday, mean d: {by_fold['delta_partial'].mean():+.5f}")
        print(f"report                : {out_dir / 'phase1_findings.md'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
