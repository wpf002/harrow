"""Synthetic race data with a known ground truth.

This exists so the harness can be tested before any real data is acquired, and so the
Phase 1 gate can be given a power analysis: at a stated true effect size and a stated
number of racedays, what lift would we actually be able to detect?

It is not evidence about racing. Every report generated from it says so.

Generative structure, chosen to mirror the documented properties of the real system:

    s          latent surface state for a (course, raceday)
    gs         = course offset + b*s + operator noise        (objective, noisy, biased
                 by course - the BHA states a reading is course-specific)
    label      = discretised s + label noise, with course-specific thresholds
                 (the documented weakness: the same number maps to different
                 descriptions at different courses)
    log_time   = controls + gamma*s + race noise

With gamma > 0 the GoingStick must add explanatory power over the label, because it
is a finer-grained view of the same s. With gamma = 0 it must not. Both cases are
asserted in the test suite.
"""

from __future__ import annotations

from dataclasses import dataclass, replace

import numpy as np
import pandas as pd

from .schema import GOING_LABELS

# Courses are named, not numbered, so that report output is readable. These are
# placeholders for the harness, not claims about any real racecourse.
DEFAULT_COURSES: tuple[str, ...] = tuple(f"COURSE_{i:02d}" for i in range(1, 21))

_LABELS_FIRM_TO_SOFT: tuple[str, ...] = tuple(x for x in GOING_LABELS if x != "HARD")


@dataclass(frozen=True)
class SyntheticConfig:
    """Knobs for the generator. Defaults produce ~19k races over 16 seasons."""

    courses: tuple[str, ...] = DEFAULT_COURSES
    year_start: int = 2009
    year_end: int = 2024
    racedays_per_course_year: int = 10
    races_per_raceday: int = 6

    # gamma: log-time per unit of latent surface state. This is the effect the Phase 1
    # gate is trying to detect.
    gamma: float = 0.010
    # How sharply the GoingStick tracks s, and how noisy a single reading is.
    gs_slope: float = 1.6
    gs_operator_sd: float = 0.45
    gs_course_offset_sd: float = 0.80
    # How noisy the subjective label is, and how much course-to-course threshold drift
    # it carries.
    label_noise_sd: float = 0.55
    label_threshold_sd: float = 0.35
    # Residual race-level noise in log-time.
    race_noise_sd: float = 0.012
    seed: int = 20090101
    missing_gs_rate: float = 0.04
    aw_share: float = 0.0


def generate(config: SyntheticConfig | None = None) -> pd.DataFrame:
    """Generate a canonical-schema frame with a known gamma."""
    cfg = config or SyntheticConfig()
    rng = np.random.default_rng(cfg.seed)

    n_courses = len(cfg.courses)
    course_speed = rng.normal(0.0, 0.020, n_courses)
    course_gs_offset = rng.normal(0.0, cfg.gs_course_offset_sd, n_courses)
    course_thresh_shift = rng.normal(0.0, cfg.label_threshold_sd, n_courses)

    # Thresholds on s that separate adjacent going descriptions, firm -> soft.
    base_thresholds = np.array([-1.25, -0.55, 0.05, 0.65, 1.30])

    rows: list[dict[str, object]] = []

    for ci, course in enumerate(cfg.courses):
        for year in range(cfg.year_start, cfg.year_end + 1):
            # Racedays spread across the turf season, March-November.
            days = rng.choice(np.arange(60, 320), size=cfg.racedays_per_course_year,
                              replace=False)
            for doy in np.sort(days):
                date = pd.Timestamp(year=year, month=1, day=1) + pd.Timedelta(days=int(doy) - 1)

                # Latent surface state: seasonal drying plus weather noise.
                seasonal = -0.9 * np.sin(np.pi * (float(doy) - 60.0) / 260.0)
                s = float(seasonal + rng.normal(0.0, 0.85))

                gs_raw = 7.8 + course_gs_offset[ci] - cfg.gs_slope * s
                gs = float(gs_raw + rng.normal(0.0, cfg.gs_operator_sd))
                gs_decl = float(gs_raw + rng.normal(0.0, cfg.gs_operator_sd * 1.3) + 0.15)

                s_perceived = s + rng.normal(0.0, cfg.label_noise_sd)
                thresholds = base_thresholds + course_thresh_shift[ci]
                label = _LABELS_FIRM_TO_SOFT[int(np.searchsorted(thresholds, s_perceived))]

                surface = "AW" if rng.random() < cfg.aw_share else "TURF"
                code = "FLAT" if rng.random() < 0.6 else "JUMP"
                has_gs = surface == "TURF" and rng.random() >= cfg.missing_gs_rate

                for ri in range(cfg.races_per_raceday):
                    distance_m = float(
                        rng.choice([1000, 1200, 1400, 1600, 2000, 2400, 3200, 4000, 4800])
                    )
                    race_class = float(rng.integers(1, 8))
                    field_size = float(rng.integers(5, 19))
                    field_quality = float(np.clip(rng.normal(95 - 6 * race_class, 8), 20, 130))
                    mean_weight_kg = float(np.clip(rng.normal(58 - 0.4 * race_class, 2.0), 50, 70))

                    log_time = (
                        1.055 * np.log(distance_m)
                        - 1.03
                        + course_speed[ci]
                        + cfg.gamma * s
                        + 0.0016 * race_class
                        - 0.00028 * field_quality
                        + 0.00045 * mean_weight_kg
                        - 0.00035 * field_size
                        + rng.normal(0.0, cfg.race_noise_sd)
                    )

                    rows.append(
                        {
                            "race_id": f"{course}-{date:%Y%m%d}-{ri}",
                            "date": date,
                            "course": course,
                            "code": code,
                            "surface": surface,
                            "distance_m": distance_m,
                            "winning_time_s": float(np.exp(log_time)),
                            "going_label": label,
                            "going_stick_raceday": gs if has_gs else np.nan,
                            "going_stick_declaration": gs_decl if has_gs else np.nan,
                            "race_class": race_class,
                            "field_size": field_size,
                            "field_quality": field_quality,
                            "mean_weight_kg": mean_weight_kg,
                            "latent_surface_state": s,
                        }
                    )

    df = pd.DataFrame(rows)
    for col in ("race_id", "course", "code", "surface", "going_label"):
        df[col] = df[col].astype("string")
    return df


def generate_null(config: SyntheticConfig | None = None) -> pd.DataFrame:
    """The same world with gamma = 0: surface state does not affect finishing time.

    Used to check the harness's false-positive rate. A harness that reports lift here
    would report lift on real data too, and the gate would be meaningless.
    """
    return generate(replace(config or SyntheticConfig(), gamma=0.0))
