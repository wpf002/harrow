"""Markdown rendering of a Phase 1 run.

Every report states its provenance in the first paragraph. A run on synthetic data
must never be mistakable for evidence about racing.
"""

from __future__ import annotations

import pandas as pd

from .models import LadderResult
from .schema import SchemaReport
from .validation import Decomposition

SYNTHETIC_WARNING = (
    "> **This run used synthetic data.** It measures the harness, not the sport. "
    "No number below is evidence about racing surfaces, and none of it clears the "
    "Phase 1 gate. Its purpose is to show that the harness recovers a known effect "
    "when one exists, reports none when it does not, and to state how large a real "
    "effect would have to be for this design to detect it."
)


def _table(df: pd.DataFrame, floatfmt: str = "{:.5f}") -> str:
    if df.empty:
        return "_no rows_\n"
    header = "| " + " | ".join(str(c) for c in df.columns) + " |"
    rule = "|" + "|".join("---" for _ in df.columns) + "|"
    lines = [header, rule]
    for _, row in df.iterrows():
        cells = []
        for v in row:
            if isinstance(v, float):
                cells.append("n/a" if pd.isna(v) else floatfmt.format(v))
            else:
                cells.append(str(v))
        lines.append("| " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


def render(
    *,
    source: str,
    synthetic: bool,
    schema: SchemaReport,
    ladder: LadderResult,
    decomposition: Decomposition,
    by_year: pd.DataFrame,
    by_fold: pd.DataFrame,
    by_course: pd.DataFrame,
    discrimination: pd.DataFrame,
    power: pd.DataFrame | None,
    true_gamma: float | None,
) -> str:
    parts: list[str] = ["# Phase 1 — validation findings\n"]
    parts.append(f"Source: `{source}`\n")
    if synthetic:
        parts.append(SYNTHETIC_WARNING + "\n")

    parts.append("## Sample\n")
    parts.append(
        _table(
            pd.DataFrame(
                [
                    {
                        "races": schema.n_rows,
                        "courses": schema.n_courses,
                        "racedays": schema.n_racedays,
                        "from": schema.date_min.date(),
                        "to": schema.date_max.date(),
                        "with_going_stick": schema.n_with_going_stick,
                        "gs_coverage": round(schema.coverage_going_stick, 3),
                    }
                ]
            )
        )
    )

    parts.append("\n## The ladder\n")
    parts.append(
        "Course fixed effects are present from `M0`, so the GoingStick term is identified\n"
        "from within-course, across-day variation only.\n"
    )
    parts.append(
        _table(
            pd.DataFrame(
                [
                    {"model": f.name, "n": f.n, "k": f.k, "r2": f.r2, "r2_adj": f.r2_adj}
                    for f in ladder.fits
                ]
            )
        )
    )

    parts.append("\n### Incremental value of each rung\n")
    parts.append(
        "`delta_r2` is the raw gain and is always tiny here: distance alone explains "
        "~99.9%\nof the variance in a finishing time. **`partial_r2` is the number to "
        "read** - the share\nof the remaining residual variance that the added term "
        "explains.\n\n"
    )
    parts.append(
        _table(
            pd.DataFrame(
                [
                    {
                        "added": inc.added,
                        "over": inc.base,
                        "delta_r2": inc.delta_r2,
                        "partial_r2": inc.partial_r2,
                        "F": inc.f_stat,
                        "p": inc.p_value,
                    }
                    for inc in ladder.increments
                ]
            )
        )
    )

    if ladder.going_stick_coef is not None:
        c = ladder.going_stick_coef
        parts.append(
            f"\nGoingStick coefficient on log finishing time: "
            f"**{c.estimate:+.6f}** (SE {c.std_err:.6f}, "
            f"95% CI [{c.ci_low:+.6f}, {c.ci_high:+.6f}], p = {c.p_value:.3g}).\n"
            f"One GoingStick unit therefore moves finishing time by about "
            f"**{c.estimate * 100:+.3f}%**.\n"
        )
    if true_gamma is not None:
        parts.append(f"\nTrue generating effect in this synthetic world: `gamma = {true_gamma}`.\n")

    d = decomposition
    parts.append("\n## Decomposition — is the signal course identity?\n")
    parts.append(
        _table(
            pd.DataFrame(
                [
                    {
                        "icc_between_course": d.icc_between_course,
                        "sd_total": d.sd_total,
                        "sd_within_course": d.sd_within_course,
                        "pooled_partial_r2": d.pooled_partial_r2,
                        "within_partial_r2": d.within_partial_r2,
                        "share_from_course_identity": d.share_of_lift_that_is_course_identity,
                    }
                ]
            )
        )
    )
    parts.append(
        "\n`within_partial_r2` is the only figure the gate may use. `pooled_partial_r2` is what\n"
        "a naive analysis without course fixed effects would report.\n"
    )

    parts.append("\n## Out of sample — expanding window by year\n")
    parts.append(_table(by_year))
    if not by_year.empty and by_year["delta"].notna().any():
        dm = by_year["delta"].mean()
        parts.append(
            f"\nMean out-of-sample delta across {int(by_year['delta'].notna().sum())} "
            f"test years: **{dm:+.5f}**; "
            f"positive in {int((by_year['delta'] > 0).sum())} of "
            f"{int(by_year['delta'].notna().sum())}.\n"
        )

    parts.append("\n## Out of sample — held-out racedays\n")
    parts.append(
        "Whole racedays are held out, never individual races: every race on a card shares\n"
        "one surface reading, so a race-level split leaks the answer into training.\n\n"
    )
    parts.append(_table(by_fold))

    parts.append("\n## Stability by course\n")
    parts.append(_table(by_course.head(40)))

    parts.append("\n## Within-course discrimination of the official label\n")
    parts.append(
        "How much of the GoingStick's within-course variance the label already accounts for.\n"
        "A high `r2_label_explains_gs` leaves the instrument little room to add anything.\n\n"
    )
    parts.append(_table(discrimination.head(40)))

    if power is not None and not power.empty:
        parts.append("\n## Detectability\n")
        parts.append(
            "Recovered within-course lift at a range of true effect sizes, holding the\n"
            "sample design fixed. This states what the gate can actually resolve.\n\n"
        )
        parts.append(_table(power))

    parts.append("\n## Gate\n")
    parts.append(
        "Per §7 the gate is: the GoingStick adds meaningful, stable, **within-course**\n"
        "explanatory power over the label, out of sample. The kill criterion is that it\n"
        "does not — in which case a better hand instrument is not the product.\n"
    )
    if synthetic:
        parts.append(
            "\n**This run cannot open or close that gate.** It was computed on generated data.\n"
        )
    return "\n".join(parts)
