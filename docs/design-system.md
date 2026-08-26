# Harrow design system

Direction derived from the five reference sites reviewed 2026-08-26. Palettes and
typefaces below were read from the live pages' computed styles, not guessed.

## What the sector looks like

| Site              | Ground           | Accents                                           | Type              |
| ----------------- | ---------------- | ------------------------------------------------- | ----------------- |
| Safety Runs First | navy `#002139`   | amber `#FF8F00`                                   | Poppins + Aileron |
| TurfTrax          | white / black    | teal `#227189`, orange `#ED7538`                  | Poppins           |
| BHA               | white / black    | blue `#46A0DE`, indigo `#222D71`, green `#02A361` | Roboto            |
| UK Ag Equine      | UK blue          | light blue                                        | system sans       |
| Rainier Sensing   | light industrial | product photography                               | system sans       |

The pattern is uniform: **navy or blue ground, one warm accent, geometric sans, pastoral
horse photography, generous whitespace, reassuring institutional tone.** Every one of them
is a brochure. Not one of them shows a measurement.

## The position

**Field instrument, not brochure.**

Harrow's product is a curve and a database. The visual language should be an instrument
readout — dense, high-contrast, numeric, honest about uncertainty. Being the only thing in
the category that looks like measurement rather than reassurance is the differentiation,
and it is also just accurate.

Concretely, three rules the sector breaks and we keep:

1. **The hero is a force-depth curve, not a horse.** Every competitor leads with pastoral
   photography. We lead with the thing nobody else can produce (see
   [competitive-landscape.md](competitive-landscape.md) item 1).
2. **Numbers are typeset as data.** Tabular monospace numerals, aligned decimals, units
   always present, uncertainty always shown. A reading with no error bar is a claim.
3. **Colour never carries judgment.** No green "good" / red "bad" going scale. §8 of the
   roadmap makes vendor-versus-critic a live decision; a red track on a dashboard makes it
   for you.

## Tokens

Dark-first, because the field app is used outdoors at 07:00 and the analyst view is used
for hours. Both themes ship.

```css
:root {
  /* Ground — slate, not navy. Reads as instrument, not institution. */
  --h-bg: #0e1418;
  --h-surface: #161e24;
  --h-surface-raised: #1e282f;
  --h-line: #2b3841;
  --h-text: #e6edf2;
  --h-text-muted: #8fa3b0;

  /* Surface-type accents. Three scales, three colours (rule §2.3).
     Never blend them; never use one for a generic UI accent. */
  --h-dirt: #c4713a;
  --h-turf: #3e9e6e;
  --h-synthetic: #5b8fd6;

  /* Signal — the instrument colour. Curves, active state, focus. */
  --h-signal: #4dd0c7;

  /* Amber is reserved. Quality flags and uncalibrated readings only.
     If amber appears anywhere decorative, the meaning is gone. */
  --h-flag: #f0a32e;
  --h-flag-severe: #e4572e;
}

:root[data-theme='light'] {
  --h-bg: #f7f9fa;
  --h-surface: #ffffff;
  --h-surface-raised: #eef2f5;
  --h-line: #d5dee4;
  --h-text: #131b20;
  --h-text-muted: #5a6c78;
  --h-signal: #14807a;
}
```

### Type

| Role                       | Face                        | Notes                                                                              |
| -------------------------- | --------------------------- | ---------------------------------------------------------------------------------- |
| UI and prose               | Inter                       | Not Poppins — three of five references use Poppins; it now reads as sector default |
| Numerals, readings, tables | JetBrains Mono              | `font-variant-numeric: tabular-nums` everywhere a value can change                 |
| Display                    | Inter Tight, tight tracking | Sparingly                                                                          |

Every reading is rendered `8.52 GS` / `37.4 % VWC` / `142 mm` — value, space, unit. Never a
bare number.

## Component rules

- **Curve plot is the primary object.** Depth on Y (inverted, mm down), force on X (N).
  Cushion band, base band and the transition marked. Raw points always visible under any
  fitted line — rule §2.1 rendered as a UI rule.
- **Every value carries its provenance.** Index version, derivation version, calibration
  ref and quality flags travel with the number and are one hover away. A number the viewer
  cannot trace is not shipped.
- **Physical and predictive never share a surface.** `physical_index` and
  `predictive_feature` get different components, different typography, and a visible label
  saying which is which. Rule §2.2 is enforced in the schema, the API and the pixels.
- **Uncalibrated is loud.** Amber border, flag chip, and excluded from any aggregate on
  screen with the exclusion stated, not hidden.
- **Official going label is shown, never scored.** Displayed alongside our value in neutral
  type. No arrows, no deltas coloured by direction, no "we disagree" affordance.
- **Path segment is always visible.** Rail / mid / outside is a first-class dimension in
  every view, because a stands-side reading is not the track.

## Not doing

- Horse photography as decoration.
- A single 1–15 style composite across surface types.
- Green/red condition dashboards.
- Any illustration of a horse in distress.
