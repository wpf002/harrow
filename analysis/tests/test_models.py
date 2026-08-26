"""The harness must find a real effect and must not invent one.

These two properties are what make the Phase 1 gate meaningful. Without them a
positive result on real data would be uninterpretable.
"""

from __future__ import annotations

from dataclasses import replace

import pytest

from harrow_analysis import models, schema, synthetic, validation

CONFIG = synthetic.SyntheticConfig(
    courses=synthetic.DEFAULT_COURSES[:8],
    year_start=2009,
    year_end=2014,
    racedays_per_course_year=8,
)


@pytest.fixture(scope="module")
def signal():
    return schema.prepare(synthetic.generate(CONFIG))


@pytest.fixture(scope="module")
def null():
    return schema.prepare(synthetic.generate(replace(CONFIG, gamma=0.0)))


def test_ladder_runs_every_rung_on_one_sample(signal) -> None:
    res = models.run_ladder(signal)
    assert [f.name for f in res.fits] == list(models.FORMULAS)
    assert len({f.n for f in res.fits}) == 1, "rungs must share an identical sample"


def test_label_adds_over_baseline(signal) -> None:
    res = models.run_ladder(signal)
    label_rung = res.increments[0]
    assert label_rung.added == "M1_label"
    assert label_rung.partial_r2 > 0.01


def test_going_stick_adds_over_the_label_when_the_effect_is_real(signal) -> None:
    res = models.run_ladder(signal)
    gs = res.increments[-1]
    assert gs.added == "M2_going_stick"
    assert gs.partial_r2 > 0.02
    assert gs.p_value < 1e-6
    assert res.going_stick_coef is not None
    lo, hi = res.going_stick_coef.ci_low, res.going_stick_coef.ci_high
    assert lo < 0 < hi is False or (lo * hi) > 0, "confidence interval must exclude zero"


def test_going_stick_adds_nothing_when_the_effect_is_absent(null) -> None:
    res = models.run_ladder(null)
    gs = res.increments[-1]
    assert gs.partial_r2 < 0.01, "harness invented a lift that is not there"


def test_out_of_sample_agrees_with_in_sample(signal, null) -> None:
    sig = validation.holdout_racedays(signal, n_folds=3)
    nul = validation.holdout_racedays(null, n_folds=3)
    assert sig["delta_partial"].mean() > 0.02
    assert abs(nul["delta_partial"].mean()) < 0.01


def test_decomposition_separates_course_identity(signal) -> None:
    d = validation.decompose(signal)
    assert 0.0 <= d.icc_between_course <= 1.0
    assert d.sd_within_course < d.sd_total
    assert d.within_partial_r2 > 0.02


def test_per_course_lift_is_broadly_positive(signal) -> None:
    per = validation.per_course_lift(signal, min_races=100)
    assert len(per) >= 6
    assert (per["partial_r2"] > 0).mean() > 0.8


def test_label_discrimination_is_bounded(signal) -> None:
    disc = models.label_discrimination(signal)
    assert not disc.empty
    assert disc["r2_label_explains_gs"].between(0, 1).all()
    assert (disc["gs_sd_within_label"] < disc["gs_sd"]).all()


def test_expanding_window_produces_one_row_per_test_year(signal) -> None:
    by_year = validation.expanding_window_by_year(signal, min_train_years=2)
    assert len(by_year) == 4
    assert by_year["delta_partial"].mean() > 0.0
