"""Canonical race-level schema for the Phase 1 validation harness.

One row per race. This is the shape any acquired dataset must be normalised into
before it reaches the models, so that a swap of source does not change the harness.

The GoingStick is a turf instrument. Rows with ``surface != "TURF"`` carry no reading
and are excluded from any model that uses one.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

# Official going descriptions, ordered firm -> soft. Used for the ordered categorical
# encoding and for the label-monotonicity check. "HARD" is in the Rules but has zero
# logged reports in the BHA 2008-2013 summary, so it is accepted and not expected.
GOING_LABELS: tuple[str, ...] = (
    "HARD",
    "FIRM",
    "GOOD TO FIRM",
    "GOOD",
    "GOOD TO SOFT",
    "SOFT",
    "HEAVY",
)

CODES: tuple[str, ...] = ("FLAT", "JUMP")
SURFACES: tuple[str, ...] = ("TURF", "AW")

REQUIRED_COLUMNS: dict[str, str] = {
    "race_id": "string",
    "date": "datetime64[ns]",
    "course": "string",
    "code": "string",
    "surface": "string",
    "distance_m": "float64",
    "winning_time_s": "float64",
    "going_label": "string",
    "going_stick_raceday": "float64",
    "race_class": "float64",
    "field_size": "float64",
    "field_quality": "float64",
    "mean_weight_kg": "float64",
}

OPTIONAL_COLUMNS: dict[str, str] = {
    "going_stick_declaration": "float64",
    "rail_position_m": "float64",
    "rainfall_mm_24h": "float64",
    "watering_mm_24h": "float64",
}


class SchemaError(ValueError):
    """Raised when a frame does not satisfy the canonical schema."""


@dataclass(frozen=True)
class SchemaReport:
    n_rows: int
    n_courses: int
    n_racedays: int
    date_min: pd.Timestamp
    date_max: pd.Timestamp
    n_with_going_stick: int
    coverage_going_stick: float


def validate(df: pd.DataFrame) -> SchemaReport:
    """Validate ``df`` against the canonical schema and summarise it.

    Raises SchemaError on anything that would silently corrupt a model fit.
    """
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise SchemaError(f"missing required columns: {missing}")

    if df.empty:
        raise SchemaError("frame is empty")

    bad_code = set(df["code"].dropna().unique()) - set(CODES)
    if bad_code:
        raise SchemaError(f"unknown code values: {sorted(bad_code)}")

    bad_surface = set(df["surface"].dropna().unique()) - set(SURFACES)
    if bad_surface:
        raise SchemaError(f"unknown surface values: {sorted(bad_surface)}")

    bad_label = set(df["going_label"].dropna().unique()) - set(GOING_LABELS)
    if bad_label:
        raise SchemaError(f"unknown going_label values: {sorted(bad_label)}")

    for col in ("distance_m", "winning_time_s"):
        if not np.isfinite(df[col]).all():
            raise SchemaError(f"{col} contains non-finite values")
        if (df[col] <= 0).any():
            raise SchemaError(f"{col} contains non-positive values")

    turf = df["surface"] == "TURF"
    if df.loc[~turf, "going_stick_raceday"].notna().any():
        raise SchemaError("going_stick_raceday present on a non-turf row")

    n_gs = int(df["going_stick_raceday"].notna().sum())
    n_turf = int(turf.sum())
    return SchemaReport(
        n_rows=len(df),
        n_courses=int(df["course"].nunique()),
        n_racedays=int(df.groupby(["course", "date"], observed=True).ngroups),
        date_min=df["date"].min(),
        date_max=df["date"].max(),
        n_with_going_stick=n_gs,
        coverage_going_stick=(n_gs / n_turf) if n_turf else 0.0,
    )


def prepare(df: pd.DataFrame) -> pd.DataFrame:
    """Add the derived columns every model in this harness expects.

    - ``log_time`` / ``log_distance``: the response and its dominant control.
    - ``raceday``: the unit of surface measurement (rule §2.6 — sessions, not readings).
    - ``gs_course_mean`` / ``gs_within``: the Mundlak split. ``gs_within`` is the only
      part of the reading that is not course identity in disguise (§7 step 5).
    """
    out = df.copy()
    out["log_time"] = np.log(out["winning_time_s"])
    out["log_distance"] = np.log(out["distance_m"])
    out["raceday"] = out["course"].astype(str) + "|" + out["date"].dt.strftime("%Y-%m-%d")
    out["year"] = out["date"].dt.year
    out["going_label"] = pd.Categorical(out["going_label"], categories=GOING_LABELS, ordered=True)

    gs = out["going_stick_raceday"]
    course_mean = gs.groupby(out["course"], observed=True).transform("mean")
    out["gs_course_mean"] = course_mean
    out["gs_within"] = gs - course_mean
    return out


def going_stick_icc(df: pd.DataFrame, column: str = "going_stick_raceday") -> float:
    """Share of GoingStick variance that lies *between* courses.

    High values mean the naive pooled lift is largely course identity. The BHA's own
    note that a reading "is specific to an individual racecourse" predicts this.
    """
    sub = df.loc[df[column].notna(), ["course", column]]
    if sub.empty:
        return float("nan")
    grand = sub[column].mean()
    group_mean = sub.groupby("course", observed=True)[column].transform("mean")
    between = float(((group_mean - grand) ** 2).sum())
    total = float(((sub[column] - grand) ** 2).sum())
    return between / total if total > 0 else float("nan")
