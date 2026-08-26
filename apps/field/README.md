# apps/field — capture app

Offline-first capture (§13). The network is not there at 07:00 on a racecourse, so the
app is fully usable from session open to session close with the radio off, and syncs when
signal returns.

```bash
pnpm --filter @harrow/field dev     # http://localhost:5173
pnpm --filter @harrow/field test
pnpm --filter @harrow/field build
```

Point it at an API with `VITE_API_BASE` (default `http://localhost:3000`).

## The app is the protocol

The operator does not choose which point to probe — the declared sampling pattern does.
The only decisions on offer are capture, override a gate (which sets a quality flag), or
abandon the point.

| Rule                                                                                    | Where             |
| --------------------------------------------------------------------------------------- | ----------------- |
| Pattern declared **before** capture, unchangeable after                                 | `core/pattern.ts` |
| A probed point is never re-probed; a retake is displaced 0.25 m onto fresh ground, once | `core/pattern.ts` |
| GPS gated before the traverse; override sets `GPS_POOR` + `MANUAL_OVERRIDE`             | `core/gate.ts`    |
| Rate outliers rejected at capture, with the reading still stored (§2.1)                 | `core/capture.ts` |
| Maintenance and weather captured at session level                                       | `App.tsx`         |
| Sync is conflict-free, resumable, integrity-verified                                    | `core/sync.ts`    |

### Why a retake moves

§9's protocol correction: the first reading destroys the point. Re-probing the same hole
returns a soft cushion that is an artefact of the first probe, not a property of the
track. So a retake is a fresh point 0.25 m perpendicular, available once. After that the
point is spent and the operator moves on with the failure recorded.

### Why sync cannot conflict

Readings are immutable and keyed by a hash of their own raw bytes. Two devices cannot
disagree about the value at a key, because the key _is_ the value's fingerprint. There is
no merge strategy here because there is nothing to merge — the hard part of offline sync
is removed by the data model rather than solved by an algorithm.

## Instrument source

`instrument.ts` defines the contract. The real implementation is Web Bluetooth against
Phase 3 firmware, which does not exist — Phase 3 was closed out by the Phase 2
positioning decision. `SimulatedInstrument` exercises the app end to end and is labelled
as simulated in the UI, because a capture app that cannot tell you whether a number came
from a probe or a random number generator is worse than no capture app.

## Status

Built, tested, and **not in use**. Under [docs/positioning.md](../../docs/positioning.md)
Harrow does not operate its own instrument. The live case for this app is the
forward-collection fallback in
[docs/phase-1-data-acquisition.md](../../docs/phase-1-data-acquisition.md): an agreement
with individual racecourses, who own their own readings.
