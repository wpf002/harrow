# Phase 2 — positioning decision

**Status: DECIDED 2026-08-26.** Recorded per §8, which requires this in writing and dated
before Phases 3–5 may start. Revisable — a decision recorded is not a decision frozen —
but until it is revised, this is the one in force.

Evidence base: [competitive-landscape.md](competitive-landscape.md),
[phase-1-data-acquisition.md](phase-1-data-acquisition.md),
[phase-1-findings.md](phase-1-findings.md).

---

## 1. Who is the buyer?

| Buyer                 | Wants                                             | Controls                           | Pays for            |
| --------------------- | ------------------------------------------------- | ---------------------------------- | ------------------- |
| Track superintendent  | Consistency, defensibility, maintenance decisions | **Physical access to the surface** | Operations tooling  |
| Regulator (BHA, HISA) | Compliance evidence, welfare outcomes             | Mandates, and therefore the market | Standards and audit |
| Modeller / bettor     | Edge — a feature nobody else has                  | Nothing physical                   | Intelligence        |

These are three products. The superintendent wants a maintenance instrument, the regulator
wants an audit trail, the modeller wants a signal. Only the first two grant track access,
and only the third pays for divergence from the official view.

**Recommendation: the modeller.** Not because it is the largest market — it is not — but
because it is the only one Harrow can reach without permission, and because GateSmart,
Furlong and TrackSense already exist as consumers. §0 already names the read API as the
asset. That is a modeller product.

**Consequence to accept:** choosing the modeller means no track access, which means no
proprietary readings, which means the data layer is the product and the probe is not.

## 2. Vendor or critic?

You cannot publish "our index says this track is riding two lengths slower than the
official Good to Firm" and also sell to the people whose judgment that contradicts.

The roadmap already answers this: "Writing 'both' is choosing the intelligence product and
losing access."

**Recommendation: critic — an intelligence product.** Follows directly from §1. It should
be chosen deliberately rather than arrived at by accident, because the accidental version
is worse: a vendor pitch that quietly contains a critic's output loses the account and the
access at the same time.

**Practical guard:** rule §2.2's separation is what makes this survivable. `physical_index`
is descriptive and can be shown to anyone without insult. `predictive_feature` is where
divergence lives, and it goes only to GateSmart, Furlong and TrackSense. The design system
already encodes this — no green/red going scales, the official label shown in neutral type
and never scored ([design-system.md](design-system.md)).

## 3. Build or partner?

This is the question the competitive review changed.

**The device lane is occupied.** The Integrated Racetrack Surface Tester, built by Rainier
Sensing with RSTL, already integrates penetration depth, volumetric moisture, salinity,
GPS, surface temperature and dielectric constant, with wireless upload and cloud
processing, field-tested at Santa Anita, Keeneland and Longchamp, and aligned to HISA
daily monitoring. Its 1 kg / 1 m drop mass is a fixed energy input — roadmap §9's preferred
answer to operator variance, already shipped.

**What Harrow would still own:** the force-vs-depth curve. A drop mass integrates cushion
and base into one number by construction; nothing fielded resolves `cushionDepth`,
`baseHardness` and `transitionSharpness` separately. This is real, and it is the whole of
the hardware case.

**The honest arithmetic:** to win on hardware, Harrow must out-engineer RSTL's partner on
their instrument, then win track access from an incumbent with regulatory standing and
established superintendent relationships, starting from zero of both — for one additional
variable, whose predictive value is unmeasured because Phase 1 has not run.

**Recommendation: do not build the instrument now.** Two live options, in order:

- **Partner / license.** Become the analysis and API layer over data that already exists —
  TurfTrax in the UK, RSTL/IRST in the US. Faster to the asset §0 names. The gating fact
  is whether either will license.
- **Revisit hardware only if Phase 1 clears and the curve is specifically implicated** —
  that is, if the analysis shows the residual variance sits where a scalar penetrometer
  cannot see. That is a much stronger case for a probe than "ours is better".

## 4. If no track access — is there a product in published data alone?

Yes, and it is the recommended one. It is also the honest reading of what nobody else is
doing.

| Component                                                                    | Source                 | Exists today?                                                |
| ---------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------ |
| UK GoingStick history, per raceday, per path segment, 2007→                  | TurfTrax archive       | Published as free text, `Disallow: /`. **Licence required.** |
| Official going labels, results, ratings                                      | BHA, commercial feeds  | Available                                                    |
| US surface disclosures                                                       | HISA / RSTL            | Available, less structured                                   |
| Weather and rainfall                                                         | Open-Meteo, Met Office | Free                                                         |
| Structured, segment-resolved, queryable version of the above                 | —                      | **Does not exist anywhere**                                  |
| Cross-jurisdiction normalisation (GoingStick / OBST / Longchamp / Lexington) | —                      | **Does not exist anywhere**                                  |
| Latency and path model — decay from measurement to post time                 | —                      | **Does not exist anywhere**                                  |
| Point-in-time read API, "what did we know at time T"                         | —                      | **Does not exist anywhere**                                  |
| Published out-of-sample validation against race outcomes                     | —                      | **Does not exist anywhere**                                  |

Five of nine rows are empty for the entire market. None of the five needs a probe, a
racecourse, or a regulator.

### Costing it

| Line                                                       | Estimate                                       |
| ---------------------------------------------------------- | ---------------------------------------------- |
| TurfTrax historical licence                                | Unknown. **The blocking commercial question.** |
| Results feed with finishing times, one year                | Low hundreds to low thousands GBP              |
| Weather                                                    | £0                                             |
| Free-text reading parser, twenty years of clerk formatting | 1–2 weeks                                      |
| Backend, ingest, index, read API (Phases 5, 6a, 8)         | Software only; no capital                      |
| Hardware, calibration, field app (Phases 3, 4, 7)          | **£0 under this path**                         |

Against the device path — which needs sensors, mechanical design, a calibration rig, a
reference moisture probe, an operator study, and track access — this is close to free.

### The risk in it

The whole path routes through one licence. If TurfTrax refuses, the fallbacks in
[phase-1-data-acquisition.md](phase-1-data-acquisition.md) are materially weaker, and the
refusal is itself the answer: the data layer is the incumbent's asset, not an available
one.

**Therefore: write to TurfTrax before committing to anything here.** It is a cheap
question with a decisive answer, and every branch below depends on it.

---

## Recommendation, in one line

Be the **intelligence and data layer** — modeller as buyer, critic not vendor, license
rather than build — and treat the probe as a Phase-1-contingent option rather than the
plan. Send the TurfTrax licence enquiry this week; it gates everything.

Under §8's own rule, that answer means **jump to Phase 6 and skip Phases 3–5**. Phase 5
(backend, schema, ingest) is still required, because the data layer needs somewhere to
live — but as ingest for licensed third-party readings, not for readings from an
instrument Harrow builds.

## Decision

Recorded 2026-08-26 by Will Foti.

| Question                   | Decision                                                                                                                                                 |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Buyer**                  | **Modeller.** Not the largest market, but the only one reachable without permission, and GateSmart, Furlong and TrackSense already exist as consumers.   |
| **Vendor or critic**       | **Critic — an intelligence product.** Chosen deliberately rather than arrived at by accident.                                                            |
| **Build or partner**       | **Partner / licence. Do not build the instrument now.** Revisit only if Phase 1 clears _and_ the analysis implicates the force-depth curve specifically. |
| **Data-layer-only viable** | **Yes.** Five of nine capability rows in §4's table are empty for the entire market, and none of the five needs a probe, a racecourse or a regulator.    |

### What this decision commits to

- Phases 3, 4 and 7 are **not started**. No hardware is purchased.
  [hardware.md](hardware.md) is a specification held in reserve, not a plan.
- Phase 5 proceeds as ingest for **licensed third-party readings**, not for readings from
  an instrument Harrow builds. Already delivered on that basis.
- The next action is the TurfTrax licence enquiry. Every branch below it depends on the
  answer, and it costs nothing to ask.

### What would reverse it

Any one of these, in writing, reopens the question:

1. Phase 1 clears **and** the residual variance sits where a scalar penetrometer cannot
   see it — meaning the curve, not the reading, is carrying the signal.
2. TurfTrax refuses to license, no other jurisdiction opens, and forward collection
   becomes the only route to any data at all.
3. A racecourse or regulator offers track access on terms that do not compromise the
   critic position.

### Standing risk

The whole path routes through one licence. If TurfTrax refuses, the fallbacks in
[phase-1-data-acquisition.md](phase-1-data-acquisition.md) are materially weaker — and
the refusal is itself informative: it would mean the data layer is the incumbent's asset
rather than an available one.
