from __future__ import annotations

import json
from pathlib import Path

from harrow_analysis import cli


def test_end_to_end_writes_report_and_summary(tmp_path: Path) -> None:
    rc = cli.main(["--years", "4", "--out", str(tmp_path), "--quiet"])
    assert rc == 0

    md = (tmp_path / "phase1_findings.md").read_text()
    assert "Phase 1 — validation findings" in md
    assert "This run used synthetic data" in md
    assert "cannot open or close that gate" in md

    summary = json.loads((tmp_path / "phase1_summary.json").read_text())
    assert summary["synthetic"] is True
    assert summary["true_gamma"] == 0.010
    assert summary["increments"][-1]["partial_r2"] > 0.02


def test_null_run_reports_no_lift(tmp_path: Path) -> None:
    assert cli.main(["--years", "4", "--null", "--out", str(tmp_path), "--quiet"]) == 0
    summary = json.loads((tmp_path / "phase1_summary.json").read_text())
    assert summary["true_gamma"] == 0.0
    assert summary["increments"][-1]["partial_r2"] < 0.01


def test_power_sweep_separates_signal_from_the_noise_floor(tmp_path: Path) -> None:
    assert cli.main(["--years", "4", "--power-sweep", "--out", str(tmp_path), "--quiet"]) == 0
    rows = (tmp_path / "phase1_power.csv").read_text().strip().splitlines()
    assert len(rows) == 6
    recovered = {float(r.split(",")[0]): float(r.split(",")[1]) for r in rows[1:]}

    # Below the noise floor the recovered lift is indistinguishable from zero. That is
    # the point of the sweep: it states which effect sizes this design can resolve.
    assert recovered[0.0] < 5e-3
    assert recovered[0.002] < 1e-2

    detectable = [0.005, 0.010, 0.020]
    values = [recovered[g] for g in detectable]
    assert values == sorted(values), "above the floor, larger effects must recover larger lift"
    assert values[0] > 4 * recovered[0.0]
