"""Model ladder for the Phase 1 claim.

The claim under test (§7): an objective, professionally-operated surface instrument
explains variance in finishing times that the official going label does not.

The ladder, in the order §7 specifies:

    M0  baseline        controls + course fixed effects
    M1  + label         the incremental value of the subjective description
    M2  + GoingStick    the incremental value of the instrument OVER the label

M2's lift over M1 is the number the project turns on.

Course fixed effects are in every model from M0. That is deliberate: with course FE
present, the GoingStick coefficient is identified purely from within-course,
across-day variation, which per §7 step 5 is the only variation that is useful.
``pooled_ladder`` re-runs the ladder without course FE so the two can be compared and
the cross-course share made visible rather than assumed away.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from scipy import stats

CONTROLS = "log_distance + race_class + field_quality + mean_weight_kg + field_size"

FORMULAS: dict[str, str] = {
    "M0_baseline": f"log_time ~ {CONTROLS} + C(course)",
    "M1_label": f"log_time ~ {CONTROLS} + C(course) + C(going_label)",
    "M2_going_stick": f"log_time ~ {CONTROLS} + C(course) + C(going_label) + going_stick_raceday",
}

POOLED_FORMULAS: dict[str, str] = {
    "P0_baseline": f"log_time ~ {CONTROLS}",
    "P1_label": f"log_time ~ {CONTROLS} + C(going_label)",
    "P2_going_stick": f"log_time ~ {CONTROLS} + C(going_label) + going_stick_raceday",
}


@dataclass(frozen=True)
class Fit:
    name: str
    n: int
    k: int
    r2: float
    r2_adj: float
    rss: float
    llf: float


@dataclass(frozen=True)
class Increment:
    """One rung of the ladder: what the added term bought.

    ``delta_r2`` is the raw R2 gain. On finishing-time models it is always tiny,
    because distance alone explains ~99.9% of the variance in a race time. The number
    to read is ``partial_r2``: the share of the *remaining* residual variance that the
    added term explains. That is the quantity the gate should be stated in.
    """

    base: str
    added: str
    delta_r2: float
    delta_r2_adj: float
    partial_r2: float
    f_stat: float
    p_value: float
    n: int


@dataclass(frozen=True)
class Coefficient:
    term: str
    estimate: float
    std_err: float
    ci_low: float
    ci_high: float
    p_value: float


@dataclass(frozen=True)
class LadderResult:
    fits: list[Fit]
    increments: list[Increment]
    going_stick_coef: Coefficient | None
    sample: pd.DataFrame


def model_frame(df: pd.DataFrame, require_going_stick: bool = True) -> pd.DataFrame:
    """Rows eligible for the ladder.

    Every model in a ladder must run on an identical sample, or the incremental R²
    is comparing two different datasets and means nothing. Turf only — the GoingStick
    is a turf instrument.
    """
    cols = [
        "log_time",
        "log_distance",
        "race_class",
        "field_quality",
        "mean_weight_kg",
        "field_size",
        "course",
        "going_label",
        "going_stick_raceday",
        "raceday",
        "year",
        "date",
    ]
    sub = df.loc[df["surface"] == "TURF", [c for c in cols if c in df.columns]].copy()
    required = [c for c in sub.columns if c != "going_stick_raceday"]
    sub = sub.dropna(subset=required)
    if require_going_stick:
        sub = sub.dropna(subset=["going_stick_raceday"])
    sub["going_label"] = sub["going_label"].cat.remove_unused_categories()
    return sub


def _fit(name: str, formula: str, data: pd.DataFrame) -> tuple[Fit, object]:
    res = smf.ols(formula, data=data).fit()
    return (
        Fit(
            name=name,
            n=int(res.nobs),
            k=int(res.df_model),
            r2=float(res.rsquared),
            r2_adj=float(res.rsquared_adj),
            rss=float(res.ssr),
            llf=float(res.llf),
        ),
        res,
    )


def _increment(base: Fit, added: Fit) -> Increment:
    df_diff = added.k - base.k
    df_resid = added.n - added.k - 1
    if df_diff <= 0 or df_resid <= 0 or added.rss <= 0:
        f_stat = float("nan")
        p_value = float("nan")
    else:
        f_stat = ((base.rss - added.rss) / df_diff) / (added.rss / df_resid)
        p_value = float(stats.f.sf(f_stat, df_diff, df_resid))
    partial = (base.rss - added.rss) / base.rss if base.rss > 0 else float("nan")
    return Increment(
        base=base.name,
        added=added.name,
        delta_r2=added.r2 - base.r2,
        partial_r2=float(partial),
        delta_r2_adj=added.r2_adj - base.r2_adj,
        f_stat=float(f_stat),
        p_value=float(p_value),
        n=added.n,
    )


def run_ladder(df: pd.DataFrame, formulas: dict[str, str] | None = None) -> LadderResult:
    """Fit the ladder on one fixed sample and report each rung's increment."""
    formulas = formulas or FORMULAS
    data = model_frame(df)
    if data.empty:
        raise ValueError("no eligible rows: need turf races with a GoingStick reading")

    fits: list[Fit] = []
    results: dict[str, object] = {}
    for name, formula in formulas.items():
        fit, res = _fit(name, formula, data)
        fits.append(fit)
        results[name] = res

    increments = [_increment(fits[i - 1], fits[i]) for i in range(1, len(fits))]

    coef: Coefficient | None = None
    top = fits[-1].name
    res = results[top]
    if "going_stick_raceday" in getattr(res, "params", {}):
        ci = res.conf_int().loc["going_stick_raceday"]
        coef = Coefficient(
            term="going_stick_raceday",
            estimate=float(res.params["going_stick_raceday"]),
            std_err=float(res.bse["going_stick_raceday"]),
            ci_low=float(ci[0]),
            ci_high=float(ci[1]),
            p_value=float(res.pvalues["going_stick_raceday"]),
        )

    return LadderResult(fits=fits, increments=increments, going_stick_coef=coef, sample=data)


def label_discrimination(df: pd.DataFrame) -> pd.DataFrame:
    """Within-course discrimination of the going label (§7 step 3).

    For each course, how much of the GoingStick's within-course variance does the
    label account for? A label that is a good summary of the instrument leaves the
    instrument little room to add anything.
    """
    data = model_frame(df)
    rows: list[dict[str, object]] = []
    for course, grp in data.groupby("course", observed=True):
        if grp["going_label"].nunique() < 2 or len(grp) < 30:
            continue
        res = smf.ols("going_stick_raceday ~ C(going_label)", data=grp).fit()
        gs = grp["going_stick_raceday"]
        rows.append(
            {
                "course": course,
                "n_races": len(grp),
                "n_labels": int(grp["going_label"].nunique()),
                "gs_sd": float(gs.std()),
                "gs_sd_within_label": float(np.sqrt(res.mse_resid)),
                "r2_label_explains_gs": float(res.rsquared),
            }
        )
    return pd.DataFrame(rows).sort_values("course").reset_index(drop=True)
