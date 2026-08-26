# Phase 1 — data acquisition

Reviewed 2026-08-26. §7 step 1: "Document every source and its licensing before
ingesting. Assume acquisition is the hard part."

Nothing has been ingested. Nothing has been crawled. This document exists so that the
licensing position is settled before a single row is collected.

## What Phase 1 needs

| Field                                       | Needed for                         | Status                              |
| ------------------------------------------- | ---------------------------------- | ----------------------------------- |
| Finishing time, distance, course, date      | response + primary control         | commercial feeds available          |
| Class, field size, field quality, weight    | controls                           | same feeds                          |
| Official going description                  | the thing the GoingStick must beat | published, free to read             |
| GoingStick reading, declaration and raceday | the claim under test               | **licence required**                |
| Path segment of the reading                 | §7 step 5, §12 path model          | present in the source, as free text |
| Rainfall / weather                          | secondary control                  | open licence available              |

The join key is `(course, date)`. Both halves must cover the same seasons or the sample
collapses to the intersection.

## Source register

### 1. TurfTrax GoingStick archive — the only complete source, not open

`https://maps.turftrax.co.uk/iframe/api_goingstickarchive.asp?courseid={id}&year={yyyy}`

Indexed from the public TurfTrax course-services site. **60 UK courses**, year-selectable,
returning rows from **2007** onward. Each row carries meeting date, report date and time,
the Clerk's official going description, and a free-text GoingStick field that is usually
segmented:

```
Good to Firm   GoingStick: Stands side: 9.0, Centre: 8.9, Farside: 8.9. Round: 7.7.
Good to Firm   Straight Course: 8.0. Round Course: 6.3. Readings taken at 7.30am on Friday
Heavy          C:5.9, H:5.9
```

That is the raceday reading, the declaration reading, the path segment, the measurement
time, and the official label — the entire left-hand side of Phase 1 — for two decades.

**It is not collectible.** `https://maps.turftrax.co.uk/robots.txt`:

```
User-agent: *
Disallow: /
```

A blanket crawl disallow. Readable by a person, off-limits to automation. The route is a
licence from TurfTrax (`turftrax@turftrax.co.uk`, St Neots, Cambridgeshire), not a
scraper. TurfTrax already sells "real time and historic data feeds", so a commercial
answer exists; the question is price and terms.

**Ask for:** per-fixture readings 2007→present, all courses, all segments, both
declaration and raceday, with measurement timestamps, in a structured format. Request
redistribution terms explicitly — a licence that forbids derived publication would rule
out Phase 8.

### 2. BHA — official going and results, free to read

[britishhorseracing.com](https://www.britishhorseracing.com) publishes fixtures, results,
stewards reports, official ratings and the Rules. No public API and no bulk export were
found. Useful as the authoritative cross-check on going labels and results, not as a bulk
source. Check the site terms before any automated access.

### 3. BHA GoingStick average readings — public, aggregate, already extracted

[Going-Stick-Average-Readings-1.pdf](https://www.britishhorseracing.com/wp-content/uploads/2014/03/Going-Stick-Average-Readings-1.pdf).
Mean GoingStick reading per official going description, split flat and jump, 2008–2013.
Aggregate only — no per-fixture rows — but it is free, official, and it already constrains
the answer. Extracted in [phase-1-findings.md](phase-1-findings.md).

### 4. Commercial results feeds

| Provider                                                                           | Covers                                                      | Notes                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| [The Racing API](https://www.theracingapi.com/)                                    | UK, IRE, HK — racecards, results, ratings, form             | Rate limited 5 req/s. Explicitly prohibits use by betting operators and sportsbooks. GoingStick coverage unconfirmed — ask before subscribing. |
| [Total Performance Data](https://www.totalperformancedata.com/live-pr-api/)        | Live, post-race and historical; sectional and tracking data | Aimed at quantitative users. Sectionals would strengthen the model beyond winning time.                                                        |
| [Goalserve](https://www.goalserve.com/en/sport-data-feeds/horse-racing-api/prices) | UK, US, FR, ZA, SE — entries, results, form, odds           | Broad but shallow; verify finishing times are present.                                                                                         |
| HorseRaceDatabase / RacingFormBook                                                 | UK from 2011 / UK+IRE from 2016                             | Prebuilt relational databases. Shorter history than the GoingStick archive, which caps the sample.                                             |

**None was confirmed to carry the GoingStick reading.** Assume the two halves must be
bought separately and joined.

### 5. Racing Post — do not scrape

Publishes GoingStick readings on cards and results, and is the most convenient
human-readable source. Its terms prohibit automated collection. Excluded.

### 6. Weather — open

Open-Meteo historical reanalysis and Met Office open data provide daily rainfall and
temperature by coordinate under permissive terms. Sufficient for the rainfall control and
for sanity-checking that a reading moved in the direction the weather implies.

### 7. Replication set (§7 step 7)

France Galop and the Longchamp penetrometer, and Horse Racing Ireland's going reports, are
the replication candidates. Both need the same licensing pass. Deferred until the UK
result exists — a replication of nothing is nothing.

## Volume and cost

From the BHA PDF: **19,621 logged reports across 2008–2013**, about 3,270 a year.
Extrapolated over 2007–2026 that is roughly **60,000 reports**, each typically carrying
two to four segment values. Against ~1,100 turf meetings a year, the archive is close to
complete.

| Line                                           | Estimate                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| TurfTrax historical licence                    | unknown — the blocking commercial question                       |
| Results feed, one year                         | low hundreds to low thousands GBP, by provider and history depth |
| Weather                                        | £0                                                               |
| Parsing and normalising the free-text readings | 1–2 weeks, and the interesting part                              |

The free-text field is the real engineering. `Stands side: 8.5, Centre: 8.3, Farside: 8.2.
Round: 6.6.` has to become four typed, segment-tagged rows, across twenty years of
inconsistent clerk formatting, with abbreviations (`C:` chase, `H:` hurdle) that vary by
course. This is also why nobody has a structured version of this dataset — see
[competitive-landscape.md](competitive-landscape.md).

## What was checked for a way around the licence

Searched 2026-08-26, before recommending anyone pay for anything.

| Route                    | Result                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Internet Archive**     | Dead end, confirmed. The wrapper page `turftrax.co.uk/going_stick_archive.html` is archived from 2009 onward, but the readings live in an iframe at `maps.turftrax.co.uk/iframe/*.asp`, and a CDX query for that prefix returns **zero snapshots**. The Archive honoured the `Disallow: /`. There is no historical copy to fall back on.                 |
| **Public datasets**      | Nothing. No GoingStick dataset on GitHub or Kaggle, under that name or an obvious variant. The free-text format is almost certainly why.                                                                                                                                                                                                                 |
| **The Racing API**       | Its OpenAPI spec exposes `going`, `going_detailed`, `winning_time`, `winning_time_hundredths` — and **no going-stick field of any kind**. It solves the results half cleanly and does not touch the instrument half.                                                                                                                                     |
| **France Galop**         | The penetrometer is the reference at all French tracks; the GoingStick was added in August 2021 for ~68 top Flat meetings. France Galop states that the resulting data "is assembled on the TurfTrax website, accessible free of charge" — the same host, the same terms. Its own site robots-disallows individual race pages. Not an independent route. |
| **Horse Racing Ireland** | GoingStick adoption was still under discussion with a single racecourse as of 2017. No long published archive.                                                                                                                                                                                                                                           |

Conclusion: the licence is not an obstacle to route around. It is the route.

### One useful thing this turned up

The Racing API covers **2017 onward, 356,954 results**. Nine seasons, not nineteen. Run
through the power sweep at that sample size:

| True effect     | Recovered within-course partial R² | p     |
| --------------- | ---------------------------------- | ----- |
| 0 (noise floor) | 0.00038                            | 0.05  |
| 0.002           | 0.0032                             | 7e-9  |
| 0.005           | 0.028                              | 1e-66 |
| 0.010           | 0.111                              | ~0    |

At nine seasons a 0.2 %-of-finishing-time effect sits **8.5x above the noise floor and is
comfortably significant**. So a results feed that only reaches 2017 is not a blocker — it
is enough to run the gate. Buying more history strengthens the result; it is not required
to get one.

## Recommended sequence

1. Write to TurfTrax. Ask for historical GoingStick data and its redistribution terms.
   Everything else is downstream of the answer.
2. In parallel, confirm with one results provider whether their feed already carries the
   GoingStick reading. If one does, the join disappears and the licence question may too.
3. Pilot on three courses across the full history before buying breadth. The harness runs
   on any subset; the parser is what needs the variety.
4. Only then acquire at scale.

## If the licence is refused

In order of preference:

1. **The aggregate PDF plus a results feed.** Weak — course-level means cannot test a
   within-course claim, which is the only claim that matters.
2. **A forward-collecting agreement with individual racecourses**, who own their own
   readings. Slow, but it also builds the track relationships Phase 2 asks about.
3. **Replicate in another jurisdiction** where the penetrometer record is open.
4. **Accept that Phase 1 cannot be run**, and treat that as information about Phase 2: if
   the incumbent will not license twenty years of readings, the data layer is their asset,
   not an available one.
