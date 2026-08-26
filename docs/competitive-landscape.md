# Competitive landscape

Reviewed 2026-08-26. Sources are the five sites below plus the BHA GoingStick summary PDF.
Everything here is from public pages; nothing was crawled.

| Party                                                                                                                 | What they are                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [TurfTrax](https://www.turftrax.com)                                                                                  | Builder and owner of the GoingStick. UK incumbent.                             |
| [Rainier Sensing — IRST](https://www.rainiersensing.com/products-project-gallery/integrated-racetrack-surface-tester) | Integrated Racetrack Surface Tester, built with RSTL. US incumbent instrument. |
| [Safety Runs First — Ecosystem of Care](https://www.safetyrunsfirst.com/ecosystem-of-care)                            | HISA-aligned industry safety programme and data infrastructure.                |
| [BHA](https://www.britishhorseracing.com)                                                                             | UK regulator; publishes going, results, ratings, stewards reports.             |
| [UK Ag Equine Programs](https://equine.mgcafe.uky.edu)                                                                | University of Kentucky; surface testing as an extension service.               |

---

## What they do that we do not

### 1. TurfTrax owns a 19-year per-raceday archive, and it is public to read

`maps.turftrax.co.uk` serves a per-course GoingStick archive covering **60 UK courses**,
year-selectable, with rows returning data as far back as **2007**. Each row carries:

- meeting date
- report date **and time** (multiple reports per raceday — declaration, morning, updates)
- the Clerk's official going description, including "in places" qualifiers
- a free-text GoingStick field, typically **per path segment**

Verbatim examples from the Ascot archive:

> `Good to Firm` · `GoingStick: Stands side: 9.0, Centre: 8.9, Farside: 8.9. Round: 7.7.`
>
> `Good to Firm` · `Straight Course: 8.0. Round Course: 6.3. Readings taken at 7.30am on Friday`
>
> `Heavy` · `C:5.9, H:5.9` (chase / hurdle)

This is `pathSegment`, `takenAt`, `officialGoingLabel` and a going index — the core of the
Harrow record — already collected, already published, for two decades. TurfTrax states
**2.5 million readings worldwide over the last decade, 670,000 in 2024**.

**It is not licensed for collection.** `https://maps.turftrax.co.uk/robots.txt` is:

```
User-agent: *
Disallow: /
```

Readable by a person, disallowed to a crawler. Acquisition means a licence conversation,
not a scraper. See [phase-1-data-acquisition.md](phase-1-data-acquisition.md).

### 2. TurfTrax has a product suite, not an instrument

GoingStick, GoingMaps (spatial going mapping), WeatherTrax, Mezurit, EquiTrax, plus
cloud-based real-time and historic data feeds and global media-rights distribution across
horseracing, greyhound racing and association football. Harrow has one probe.

### 3. The IRST is already most of Harrow's hardware roadmap

Built by Rainier Sensing with RSTL and Alexanders Mechanical Solutions; prototypes
field-tested at Santa Anita, Keeneland and Longchamp; supports HISA daily surface
monitoring. In one integrated unit it measures:

| IRST                                                                                      | Harrow §5 field                    |
| ----------------------------------------------------------------------------------------- | ---------------------------------- |
| Total surface penetration depth (1 kg mass, 1 m drop, 1 cm² rod — Longchamp design)       | `forceDepthCurve` (scalar only)    |
| Volumetric moisture content                                                               | `vwc`                              |
| GPS coordinates                                                                           | `lat`, `lon`                       |
| Surface salinity                                                                          | (Harrow's VWC salinity correction) |
| Surface temperature                                                                       | `surfaceTempC`                     |
| Dielectric constant                                                                       | —                                  |
| Wireless upload, cloud processing, generated report with track location and pole position | Phases 5, 7, 8                     |

**The drop mass is the point.** A 1 kg mass from 1 m is a fixed energy input. That is
roadmap §9 option (a) — the preferred answer to the operator-variance problem — already
shipped. Phase 3 cannot claim controlled energy as a differentiator.

### 4. HISA has the regulatory data pipeline and named platform partners

Uniform reporting that captures wearable sensor data, training performance, **surface
conditions**, weather and veterinary records into a centralised database, with **AWS and
Palantir** doing AI-driven risk analysis. GPS-equipped graders for consistent resurfacing.
An All-Weather Surfaces Committee. Harrow would be one feed into a pipeline that already
has an analytics vendor.

### 5. Institutional credibility channels

BHA publishes the going and the results and writes the Rules. UK Ag Equine runs surface
testing as a university extension service with a horse-and-rider safety knowledge centre.
Both are trusted publication routes Harrow does not have.

---

## What they do not do that we can

### 1. Nobody produces a force-vs-depth curve

Every incumbent instrument returns scalars. The GoingStick returns an index. The IRST
returns _total penetration depth_ from a drop mass. Neither can separate:

- `cushionDepth`
- `baseHardness`
- `transitionSharpness` — where cushion becomes base

A drop-mass penetrometer integrates the whole profile into one number by construction.
**This is Harrow's only genuine physical novelty, and it is a real one** — the cushion/base
boundary is the mechanically interesting part of a racing surface and no fielded instrument
resolves it.

### 2. Nobody publishes a reproducible number

No incumbent exposes raw, a calibration reference, an algorithm version, or an inputs
hash. You cannot reproduce a GoingStick index from anything published. Rules §2.1 and
§2.4 — permanent raw, immutable versions, recomputable derived — are unclaimed ground.

### 3. The public history is unstructured and unqueryable

The TurfTrax archive is HTML tables of prose. `Stands side: 8.5, Centre: 8.3, Farside: 8.2.
Round: 6.6.` is not a dataset. There is no API, no CSV, no schema, no per-segment
normalisation, and no join to results. Turning 19 years of free text into a typed,
segment-resolved, timestamped table is real, defensible work that nobody has published.

### 4. Nobody normalises across jurisdictions

UK GoingStick, US OBST/IRST, French Longchamp penetrometer, and the coming Lexington
Penetrometer are four scales with no mapping between them. Rule §2.3 — three scales, one
framework — is exactly the missing layer, and it is more valuable than a fifth scale.

### 5. Nobody models latency or path

Everyone measures at 07:30 and reports it as the day's condition. Between that reading and
the last race the track is harrowed, watered, rained on, and cut up by the fields ahead.
No published product models time-since-measurement decay, maintenance events between
races, or the fact that a stands-side reading does not describe the path a field took.
Roadmap §12's latency-and-path model has no competitor.

### 6. Nobody has published outcome validation

RSTL and HISA justify surface measurement on **safety**. TurfTrax justifies it on
**regulation**. Neither publishes evidence that the number explains race outcomes better
than the subjective label. An out-of-sample R² table with confidence intervals is a
differentiated asset regardless of whether Harrow ever builds a probe — and per §7 it is
also the thing that decides whether the probe should exist.

### 7. There is no read API for quantitative consumers

TurfTrax feeds go to racecourses and media. HISA's surface data goes to Palantir. Neither
sells a versioned, point-in-time surface API to modellers. Roadmap §14's "what did we know
at time T" query does not exist anywhere in this market.

### 8. Operator variance is a known weakness nobody quantifies

It is acknowledged in the literature and in press coverage of the GoingStick, and it is
never reported as a number. Rule §2.7 makes it a first-class published quantity.

---

## Strategic read

The device lane is crowded and the data lane is empty.

The IRST already integrates penetration, moisture, salinity, temperature, GPS and cloud
upload, with controlled energy input, endorsed by the US testing laboratory and aligned to
the regulator. Fielding a rival instrument means out-competing that on hardware while
starting with zero track access and zero regulatory standing.

Meanwhile: two decades of UK readings sit in HTML tables with no schema; four measurement
systems have no common scale; nobody models the gap between measurement time and post
time; and nobody has published whether any of it predicts anything.

Items 1 (the curve) and 3–7 (the data layer) are separable. Item 1 needs hardware, track
access and a fight. Items 3–7 need a licence conversation and a laptop.

This is direct input to [positioning.md](positioning.md) — specifically §8 items 3
(build or partner) and 4 (data layer only). It is not the decision.
