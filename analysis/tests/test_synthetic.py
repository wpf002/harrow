from __future__ import annotations

from dataclasses import replace

import pandas as pd

from harrow_analysis import synthetic

SMALL = synthetic.SyntheticConfig(
    courses=synthetic.DEFAULT_COURSES[:3],
    year_start=2009,
    year_end=2010,
    racedays_per_course_year=5,
)


def test_generation_is_deterministic() -> None:
    a = synthetic.generate(SMALL)
    b = synthetic.generate(SMALL)
    pd.testing.assert_frame_equal(a, b)


def test_row_count_matches_design() -> None:
    df = synthetic.generate(SMALL)
    assert len(df) == 3 * 2 * 5 * SMALL.races_per_raceday


def test_going_stick_falls_as_ground_softens() -> None:
    df = synthetic.generate(SMALL)
    corr = df["going_stick_raceday"].corr(df["latent_surface_state"])
    assert corr < -0.7


def test_label_thresholds_drift_between_courses() -> None:
    """The documented weakness: the same reading maps to different descriptions."""
    df = synthetic.generate(replace(SMALL, courses=synthetic.DEFAULT_COURSES[:8]))
    good = df[df["going_label"] == "GOOD"]
    by_course = good.groupby("course", observed=True)["going_stick_raceday"].mean()
    assert by_course.max() - by_course.min() > 0.3


def test_null_world_has_zero_effect() -> None:
    df = synthetic.generate_null(SMALL)
    assert "latent_surface_state" in df.columns
    # log-time must be uncorrelated with the surface state once distance is removed.
    resid = df["winning_time_s"] / df["distance_m"]
    assert abs(resid.corr(df["latent_surface_state"])) < 0.05
