# Phase 1 — findings

Status: **gate OPEN — not cleared, not failed.** Dated 2026-08-26.

The harness is built and validated. The data is identified but not licensed. The claim
under test has not been tested.

---

## 1. What the public record already tells us

The BHA publishes mean GoingStick readings against the Clerk's official going
description, 2008–2013, **19,621 logged reports**.

| Official description | Flat: reports | Flat: mean GS | Jump: reports | Jump: mean GS |
| -------------------- | ------------- | ------------- | ------------- | ------------- |
| HEAVY                | 231           | 5.7           | 666           | 5.2           |
| SOFT                 | 975           | 6.4           | 1,594         | 6.0           |
| GOOD TO SOFT         | 1,479         | 7.1           | 1,998         | 6.8           |
| GOOD                 | 3,384         | 7.9           | 3,277         | 7.7           |
| GOOD TO FIRM         | 4,297         | 8.6           | 1,370         | 8.7           |
| FIRM                 | 310           | 9.9           | 40            | 10.0          |
| HARD                 | 0             | n/a           | 0             | n/a           |

Three things follow, and all three shape the gate.

**The mapping is monotonic.** Softer descriptions get lower readings, without exception,
in both codes. The instrument and the label agree on direction. That is the least
surprising possible result and it is not the claim.

**The steps are small.** Adjacent descriptions are separated by **0.7–0.8 GoingStick
units** across the middle of the range where almost all racing happens. Only the jump to
FIRM is larger (1.3), on 310 and 40 reports respectively. If within-label reading spread
is of comparable size — and the GoingStick's documented operator dependence suggests it
is — then adjacent categories overlap heavily, and the marginal information in the number
over the label is small. `label_discrimination()` in the harness measures exactly this
and needs real data to run.

**The same label means different things in different codes.** HEAVY is 5.7 on the flat and
5.2 over jumps — a 0.5 gap, most of one category step. Pooling flat and jump is a
specification error, and the harness stratifies accordingly.

The BHA states the constraint itself, on the same page:

> a reading "is specific to an individual racecourse and most valuable when considered in
> the context of historical readings at that course"

and warns that its own cross-course table "should not be used to give a specific
indication of the Going at any individual course". That is the regulator saying the
cross-course comparison is invalid — which is §7 step 5's within-course requirement,
already conceded by the body that mandates the instrument.

## 2. The data exists; it is not available

The complete per-fixture record — 60 UK courses, 2007 onward, per path segment, with
report timestamps and the official label alongside — is served publicly by TurfTrax at
`maps.turftrax.co.uk`, and is `Disallow: /` in robots.txt. Readable by a person, off
limits to automation.

Acquisition is a licence conversation, not an engineering problem. Full register, costs
and fallbacks: [phase-1-data-acquisition.md](phase-1-data-acquisition.md).

## 3. The harness

`analysis/`, reproducible from one command:

```bash
cd analysis && uv sync && uv run harrow-phase1 --power-sweep
```

Writes `out/phase1_findings.md`, `out/phase1_summary.json`, `out/phase1_power.csv`.
Point it at a real acquisition with `--data path.parquet` and nothing else changes.

It implements §7 steps 2–6:

| §7 step                | Implementation                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| 2 — baseline           | `M0`: log time ~ log distance + class + field quality + weight + field size + course FE                      |
| 3 — add the label      | `M1`, plus `label_discrimination()` for within-course label spread                                           |
| 4 — add the GoingStick | `M2`, reported as lift **over** `M1`                                                                         |
| 5 — decompose          | `decompose()`: variance ICC, plus pooled vs within-course lift and the share attributable to course identity |
| 6 — stability          | `expanding_window_by_year()` and `holdout_racedays()`, plus `per_course_lift()`                              |

Three design decisions worth stating.

**Course fixed effects are in every model from `M0`.** The GoingStick term is therefore
identified only from within-course, across-day variation. The cross-course comparison the
BHA warns against cannot leak in through the back door.

**Whole racedays are held out, never individual races.** Every race on a card shares one
surface reading. A race-level split puts the test answer in the training set and inflates
the lift.

**The headline statistic is partial R², not ΔR².** Distance alone explains ~99.9% of the
variance in a finishing time, so every raw ΔR² is a number with four leading zeros.
Partial R² — the share of _remaining_ residual variance the added term explains — is the
quantity the gate should be stated in.

## 4. Harness validation

Two properties must hold before a result on real data means anything. Both are asserted
in the test suite (25 tests).

| Synthetic world                  | Within-course partial R² | Out-of-sample Δ (by year) |
| -------------------------------- | ------------------------ | ------------------------- |
| Effect present (`gamma = 0.010`) | **+0.116** (p ≈ 1e-251)  | **+0.133**                |
| No effect (`gamma = 0`)          | +0.0004 (p = 0.06)       | −0.001                    |

The harness recovers a real effect and does not invent an absent one.

Note the null world's decomposition: what little pooled lift appears there is **86% course
identity**. Without course fixed effects, a harness would report a lift in a world where
none exists. This is the failure mode the decomposition is there to catch.

## 5. What the gate can resolve

Recovered within-course lift against true effect size, at two sample sizes.

| True `gamma` | 4 seasons (~4,650 races)     | 16 seasons (~18,600 races) |
| ------------ | ---------------------------- | -------------------------- |
| 0.000        | 0.0025 (noise floor)         | 0.0002 (noise floor)       |
| 0.002        | 0.0007 — **below the floor** | 0.0042 — detectable        |
| 0.005        | 0.020                        | 0.032                      |
| 0.010        | 0.097                        | 0.120                      |
| 0.020        | 0.305                        | 0.334                      |

**Implication for acquisition:** four seasons cannot resolve a 0.2%-of-finishing-time
effect; sixteen can. Since the GoingStick record runs to nineteen years, buy the history,
not a recent slice. A short pilot that returns "no lift" would be uninformative, and
mistaking that for a failed gate would kill the project on a sample-size artefact.

## 6. Gate status

§7's exit condition: the GoingStick adds meaningful, stable, within-course explanatory
power over the label, out of sample. The kill criterion is that it does not.

**Neither has fired.** No real data has been analysed. The two open items:

1. Licence the TurfTrax historical archive, or confirm a results provider already carries
   the reading.
2. Acquire results with finishing times over the same seasons, and run the harness.

Until then §2.8 applies: nothing ships past an unresolved gate, and the answer to whether
a better hand instrument is the product remains unknown.

Everything in §1 is a reason to expect the answer to be **small but real**, and to expect
the argument to turn on whether "small" is enough — which is why §5's sample-size table
matters more than it looks.
