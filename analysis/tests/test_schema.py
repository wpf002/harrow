from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from harrow_analysis import schema, synthetic

SMALL = synthetic.SyntheticConfig(
    courses=synthetic.DEFAULT_COURSES[:4],
    year_start=2009,
    year_end=2011,
    racedays_per_course_year=6,
)


@pytest.fixture(scope="module")
def raw() -> pd.DataFrame:
    return synthetic.generate(SMALL)


def test_validate_accepts_generated_frame(raw: pd.DataFrame) -> None:
    rep = schema.validate(raw)
    assert rep.n_rows == len(raw)
    assert rep.n_courses == 4
    assert rep.n_racedays == 4 * 3 * 6
    assert 0.9 < rep.coverage_going_stick <= 1.0


def test_validate_rejects_missing_column(raw: pd.DataFrame) -> None:
    with pytest.raises(schema.SchemaError, match="missing required columns"):
        schema.validate(raw.drop(columns=["winning_time_s"]))


def test_validate_rejects_unknown_going_label(raw: pd.DataFrame) -> None:
    bad = raw.copy()
    bad.loc[bad.index[0], "going_label"] = "SLIGHTLY DAMP"
    with pytest.raises(schema.SchemaError, match="unknown going_label"):
        schema.validate(bad)


def test_validate_rejects_going_stick_on_non_turf(raw: pd.DataFrame) -> None:
    bad = raw.copy()
    bad.loc[bad.index[0], "surface"] = "AW"
    bad.loc[bad.index[0], "going_stick_raceday"] = 7.5
    with pytest.raises(schema.SchemaError, match="non-turf"):
        schema.validate(bad)


def test_validate_rejects_non_positive_time(raw: pd.DataFrame) -> None:
    bad = raw.copy()
    bad.loc[bad.index[0], "winning_time_s"] = 0.0
    with pytest.raises(schema.SchemaError, match="non-positive"):
        schema.validate(bad)


def test_prepare_adds_derived_columns(raw: pd.DataFrame) -> None:
    df = schema.prepare(raw)
    for col in ("log_time", "log_distance", "raceday", "year", "gs_within", "gs_course_mean"):
        assert col in df.columns
    # raceday is the unit of measurement: one card, one reading.
    per_day = df.groupby("raceday", observed=True)["going_stick_raceday"].nunique(dropna=True)
    assert set(per_day.unique()) <= {0, 1}
    # gs_within is mean-zero by construction within each course.
    assert abs(df.groupby("course", observed=True)["gs_within"].mean().abs().max()) < 1e-9


def test_going_stick_icc_is_a_share(raw: pd.DataFrame) -> None:
    icc = schema.going_stick_icc(raw)
    assert 0.0 <= icc <= 1.0
    assert np.isfinite(icc)
