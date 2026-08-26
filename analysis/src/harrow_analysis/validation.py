"""Out-of-sample validation (§7 steps 5-6).

An in-sample incremental R² is not the gate. Three things have to hold:

1. The lift is *within-course*. Cross-course signal is course identity in disguise:
   the BHA states plainly that a reading "is specific to an individual racecourse and
   most valuable when considered in the context of historical readings at that course",
   and that its published cross-course scale "should not be used to give a specific
   indication of the Going at any individual course".
2. The lift survives out of sample, forward in time.
3. The lift is not carried by a handful of courses.

Each function below answers exactly one of those.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf

from .models import FORMULAS, model_frame
from .schema import going_stick_icc


@dataclass(frozen=True)
class Decomposition:
    """§7 step 5 — where does the GoingStick's variance live?"""

    icc_between_course: float
    sd_total: float
    sd_within_course: float
    pooled_delta_r2: float
    within_delta_r2: float
    pooled_partial_r2: float
    within_partial_r2: float

    @property
    def share_of_lift_that_is_course_identity(self) -> float:
        if self.pooled_partial_r2 <= 0:
            return float("nan")
        return max(0.0, 1.0 - self.within_partial_r2 / self.pooled_partial_r2)


def _oos_r2(train: pd.DataFrame, test: pd.DataFrame, formula: str) -> float:
    """R² of `formula` fitted on train, evaluated on test, against the test mean.

    Test rows whose course or going label never appeared in training are dropped —
    the model has no coefficient for them. The count of dropped rows is the caller's
    responsibility to report if it matters.
    """
    test = test[test["course"].isin(train["course"].unique())]
    train_labels = set(train["going_label"].dropna().unique())
    test = test[test["going_label"].isin(train_labels)]
    if len(test) < 30 or train["going_label"].nunique() < 2:
        return float("nan")
    try:
        res = smf.ols(formula, data=train).fit()
        pred = res.predict(test)
    except (ValueError, KeyError, np.linalg.LinAlgError):
        return float("nan")
    y = test["log_time"].to_numpy()
    resid = y - pred.to_numpy()
    sse = float(np.sum(resid**2))
    sst = float(np.sum((y - y.mean()) ** 2))
    return 1.0 - sse / sst if sst > 0 else float("nan")


def expanding_window_by_year(
    df: pd.DataFrame, min_train_years: int = 4, formulas: dict[str, str] | None = None
) -> pd.DataFrame:
    """Train on every year before Y, test on Y. One row per test year.

    ``delta`` is the out-of-sample gain of the GoingStick model over the label model.
    A gate that passes in-sample and fails here has found an artefact.
    """
    formulas = formulas or FORMULAS
    data = model_frame(df)
    years = sorted(data["year"].unique())
    rows: list[dict[str, object]] = []
    for i, year in enumerate(years):
        if i < min_train_years:
            continue
        train = data[data["year"] < year]
        test = data[data["year"] == year]
        r2_label = _oos_r2(train, test, formulas["M1_label"])
        r2_gs = _oos_r2(train, test, formulas["M2_going_stick"])
        rows.append(
            {
                "test_year": int(year),
                "n_train": len(train),
                "n_test": len(test),
                "oos_r2_label": r2_label,
                "oos_r2_going_stick": r2_gs,
                "delta": r2_gs - r2_label,
                "delta_partial": (r2_gs - r2_label) / (1 - r2_label)
                if r2_label < 1
                else float("nan"),
            }
        )
    return pd.DataFrame(rows)


def holdout_racedays(
    df: pd.DataFrame, n_folds: int = 5, seed: int = 7, formulas: dict[str, str] | None = None
) -> pd.DataFrame:
    """K-fold with whole racedays held out.

    Racedays, not races. Every race on a card shares one surface reading, so splitting
    within a card leaks the test answer into training and inflates the lift.
    """
    formulas = formulas or FORMULAS
    data = model_frame(df)
    rng = np.random.default_rng(seed)
    racedays = data["raceday"].unique()
    fold_of = dict(zip(racedays, rng.integers(0, n_folds, len(racedays)), strict=True))
    data = data.assign(_fold=data["raceday"].map(fold_of))

    rows: list[dict[str, object]] = []
    for fold in range(n_folds):
        train = data[data["_fold"] != fold]
        test = data[data["_fold"] == fold]
        r2_label = _oos_r2(train, test, formulas["M1_label"])
        r2_gs = _oos_r2(train, test, formulas["M2_going_stick"])
        rows.append(
            {
                "fold": fold,
                "n_train": len(train),
                "n_test": len(test),
                "oos_r2_label": r2_label,
                "oos_r2_going_stick": r2_gs,
                "delta": r2_gs - r2_label,
                "delta_partial": (r2_gs - r2_label) / (1 - r2_label)
                if r2_label < 1
                else float("nan"),
            }
        )
    return pd.DataFrame(rows)


def per_course_lift(df: pd.DataFrame, min_races: int = 200) -> pd.DataFrame:
    """In-sample incremental R² of the GoingStick over the label, one course at a time.

    A lift that is stable is a lift most courses show. A lift carried by three courses
    is a story about three courses.
    """
    data = model_frame(df)
    controls = "log_distance + race_class + field_quality + mean_weight_kg + field_size"
    rows: list[dict[str, object]] = []
    for course, grp in data.groupby("course", observed=True):
        if len(grp) < min_races or grp["going_label"].nunique() < 2:
            continue
        grp = grp.copy()
        grp["going_label"] = grp["going_label"].cat.remove_unused_categories()
        try:
            m1 = smf.ols(f"log_time ~ {controls} + C(going_label)", data=grp).fit()
            m2 = smf.ols(
                f"log_time ~ {controls} + C(going_label) + going_stick_raceday", data=grp
            ).fit()
        except (ValueError, np.linalg.LinAlgError):
            continue
        rows.append(
            {
                "course": course,
                "n_races": len(grp),
                "r2_label": float(m1.rsquared),
                "r2_going_stick": float(m2.rsquared),
                "delta_r2": float(m2.rsquared - m1.rsquared),
                "partial_r2": float((m1.ssr - m2.ssr) / m1.ssr) if m1.ssr > 0 else float("nan"),
                "gs_coef": float(m2.params.get("going_stick_raceday", np.nan)),
                "gs_p": float(m2.pvalues.get("going_stick_raceday", np.nan)),
            }
        )
    out = pd.DataFrame(rows)
    return out.sort_values("delta_r2", ascending=False).reset_index(drop=True) if len(out) else out


def decompose(df: pd.DataFrame) -> Decomposition:
    """Split the naive pooled lift into course identity and genuine within-course signal."""
    from .models import POOLED_FORMULAS, run_ladder

    data = model_frame(df)
    within = run_ladder(df)
    pooled = run_ladder(df, POOLED_FORMULAS)

    gs = data["going_stick_raceday"]
    within_course = gs - gs.groupby(data["course"], observed=True).transform("mean")
    return Decomposition(
        icc_between_course=going_stick_icc(data.assign(surface="TURF")),
        sd_total=float(gs.std()),
        sd_within_course=float(within_course.std()),
        pooled_delta_r2=pooled.increments[-1].delta_r2,
        within_delta_r2=within.increments[-1].delta_r2,
        pooled_partial_r2=pooled.increments[-1].partial_r2,
        within_partial_r2=within.increments[-1].partial_r2,
    )
