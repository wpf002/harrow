# Harrow hardware — bill of materials and operating instructions

Covers Phase 3 (prototype) and Phase 4 (calibration). Dev-board and bench-rig only. No
mechanical design, no enclosure, no handheld form factor — those come after the physics
is proven, not before.

> **Gate check before spending anything.** §8 blocks Phases 3–5 until
> [positioning.md](positioning.md) is signed and dated, and §7's kill criterion is that
> if the GoingStick adds no stable within-course lift over the official label, _a better
> hand instrument is not the product_. Both gates are currently open. Everything below
> assumes they close in favour of building. See
> [phase-1-findings.md](phase-1-findings.md).

Prices are indicative order-of-magnitude figures for planning only. Verify before
ordering.

---

## 1. What the instrument has to do

Produce a **force-versus-depth curve** that is comparable between two readings taken by
different people on different days. Everything on the list serves one of those two
clauses:

| Clause                 | Parts                                                                  |
| ---------------------- | ---------------------------------------------------------------------- |
| Produce the curve      | Load cell, high-rate ADC, linear encoder, drive mechanism, probe tip   |
| Make curves comparable | Constant-rate drive, VWC, EC, temperature, GPS, calibration references |

A scalar penetrometer needs roughly a third of this list. The extra two thirds is what
separates cushion depth from base hardness, and what stops the number drifting with the
operator, the weather and the wax.

---

## 2. Two corrections to the roadmap spec

Both were found while building the software that will consume this data. Read them
before ordering.

### 2.1 The HX711 is too slow for a curve

§9 names the HX711. It samples at **10 or 80 SPS**. A 200 mm traverse at the standard
cone-penetrometer rate of 20 mm/s takes 10 seconds, so 80 SPS yields ~800 samples — which
sounds adequate until the drive rate is raised, and it leaves no headroom at all for a
faster traverse. At a 2-second traverse it yields 160 samples across 200 mm: 1.25 mm of
depth resolution, against a cushion/base transition that needs to be located to
single millimetres.

**Use a 24-bit delta-sigma ADC with a real data rate instead:**

| Part        | Rate         | Use                                                                           |
| ----------- | ------------ | ----------------------------------------------------------------------------- |
| **ADS1220** | up to 2 kSPS | Recommended. Cheap, I²C/SPI, integrated PGA and excitation                    |
| ADS1256     | 30 kSPS      | Overkill for this, useful if you later want impact events                     |
| HX711       | 80 SPS       | Keep one — it is perfectly good for the **static** calibration rig in Phase 4 |

Target ≥500 SPS logged. At 20 mm/s that is 0.04 mm per sample.

### 2.2 A drop mass and a force-depth curve are incompatible

§9 offers (a) controlled energy via drop mass or motorised actuator, or (b) capture the
rate and normalise. RSTL's IRST uses a drop mass, and it is a genuinely good answer to
operator variance.

It is the wrong answer _for Harrow_, because a dropped mass is a decelerating projectile.
The force it records is dominated by its own momentum, the sample is a single impact
event, and the depth axis is whatever the mass happened to reach. That produces a
penetration-depth scalar — which is exactly what the IRST already sells, and exactly what
Harrow claims not to be.

**Decision: motorised actuator at constant rate.** It is the only option that removes the
operator _and_ yields a controlled traverse from which cushion, base and transition can
be resolved separately.

- Rate: **20 mm/s constant**, matching cone penetrometer practice (ASTM D3441)
- Depth: 0–200 mm
- Consequence: the Phase 3 rig is **cart- or frame-mounted, not handheld**. Accept this.
  A handheld constant-rate device is a mechanical engineering project, and it is not
  worth starting before the curve is proven to carry information the scalar does not.
- The drive-rate profile is still logged on every reading (§2.7). Controlled rate means
  the telemetry should be boring; boring telemetry is how you know the control works.

---

## 3. Phase 3 — prototype bill of materials

### 3.1 Compute and logging

| #   | Item                    | Spec                                 | Qty | Why                                                                            | ~Cost  |
| --- | ----------------------- | ------------------------------------ | --- | ------------------------------------------------------------------------------ | ------ |
| 1   | ESP32-S3 devkit         | S3-DevKitC-1, 8 MB PSRAM, WiFi + BLE | 2   | One to build on, one because you will destroy one                              | £15 ea |
| 2   | microSD breakout + card | SPI, 32 GB industrial-grade          | 2   | Sessions happen where connectivity does not; raw is permanent (§2.1)           | £20    |
| 3   | RTC module              | DS3231                               | 1   | Curve timestamps must survive a power cycle; GPS gives time but not before fix | £6     |

### 3.2 The force axis

| #   | Item                  | Spec                                                   | Qty | Why                                                                                           | ~Cost  |
| --- | --------------------- | ------------------------------------------------------ | --- | --------------------------------------------------------------------------------------------- | ------ |
| 4   | Compression load cell | 2 kN, ≤0.05 % FS nonlinearity, temperature-compensated | 1   | Force. 2 kN covers a hard base with headroom before saturation                                | £120   |
| 5   | **ADS1220 breakout**  | 24-bit, 2 kSPS, PGA                                    | 2   | See §2.1. The HX711 cannot sample a curve                                                     | £15 ea |
| 6   | HX711 breakout        | 80 SPS                                                 | 1   | Static calibration rig only                                                                   | £3     |
| 7   | Cone tip              | 60°, 12.83 mm dia (1.29 cm²), hardened steel           | 3   | Standard CPT geometry so readings are comparable to published work. Spares because tips blunt | £40 ea |
| 8   | Push rod              | 12 mm stainless, 300 mm                                | 2   | —                                                                                             | £15    |

### 3.3 The depth axis

| #   | Item              | Spec                                      | Qty | Why                                                                            | ~Cost |
| --- | ----------------- | ----------------------------------------- | --- | ------------------------------------------------------------------------------ | ----- |
| 9   | Draw-wire encoder | 0–300 mm, quadrature, ≤0.05 mm resolution | 1   | Depth. **Paired with force this is the curve** — force alone is another scalar | £180  |
| 10  | Limit switches    | Mechanical, NO                            | 2   | Top and bottom of travel. Software limits fail; switches do not                | £4    |

Cheaper alternative: a magnetic linear encoder strip (AS5311 + magnetic tape) at roughly
a third of the price, with more mounting work.

### 3.4 Drive mechanism

| #   | Item            | Spec                                              | Qty | Why                                                                                      | ~Cost |
| --- | --------------- | ------------------------------------------------- | --- | ---------------------------------------------------------------------------------------- | ----- |
| 11  | Linear actuator | 12 V, ≥1.5 kN, 250 mm stroke, closed-loop capable | 1   | Constant-rate traverse — removes the operator (§2.2)                                     | £180  |
| 12  | Motor driver    | H-bridge, ≥15 A continuous, current sense         | 1   | Drive plus a second force estimate from current draw, as a sanity check on the load cell | £25   |
| 13  | Reaction frame  | Steel, ground anchors or ballast                  | 1   | The actuator pushes down; something must push back. Improvised bench clamps will bend    | £150  |

### 3.5 Environment sensors

| #   | Item                 | Spec                           | Qty | Why                                                                                                                          | ~Cost  |
| --- | -------------------- | ------------------------------ | --- | ---------------------------------------------------------------------------------------------------------------------------- | ------ |
| 14  | Capacitive VWC probe | TEROS 10 / analogue capacitive | 2   | Moisture dominates penetration resistance. Without it, "firm because dry" and "firm because compacted" are the same reading  | £70 ea |
| 15  | Soil EC sensor       | Contact conductivity, 0–5 dS/m | 1   | **Not optional.** Capacitive VWC reads badly wrong across salinity ranges; uncorrected moisture produces a wrong index (§10) | £90    |
| 16  | SHT40                | ±0.2 °C, ±1.8 % RH, I²C        | 2   | Ambient temperature and humidity                                                                                             | £8 ea  |
| 17  | Probe thermistor     | NTC 10 k, 1 %, potted          | 3   | Surface temperature. Synthetic wax softens as it warms — same track, different stiffness                                     | £3 ea  |

### 3.6 Position

| #   | Item               | Spec                      | Qty   | Why                                                                                                                                    | ~Cost |
| --- | ------------------ | ------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 18  | u-blox NEO-M9N     | Multi-band GNSS + antenna | 1     | Rail, mid and outside are materially different surfaces, and within-course comparison across days requires returning to the same place | £70   |
| 19  | Survey pins + tape | 20 pins, 30 m tape        | 1 set | GNSS alone will not reproduce a 0.5 m grid. Physical marks will                                                                        | £30   |

Sub-metre is enough for path segment. If you later want to resolve _within_ a segment,
that needs RTK (base station plus corrections), which is a Phase 5+ question.

### 3.7 Power and bench

| #   | Item                                                | Spec                        | Qty  | ~Cost |
| --- | --------------------------------------------------- | --------------------------- | ---- | ----- |
| 20  | LiFePO4 pack                                        | 12.8 V, 20 Ah, with BMS     | 1    | £120  |
| 21  | Buck converter                                      | 12 V → 5 V, 3 A             | 2    | £10   |
| 22  | Bench PSU                                           | 0–30 V, 0–5 A               | 1    | £80   |
| 23  | Multimeter, oscilloscope                            | 4½ digit; 2-channel 100 MHz | 1 ea | £250  |
| 24  | Soldering, hookup wire, connectors, IP-rated glands | —                           | —    | £150  |

**Indicative Phase 3 total: £2,000–2,500.**

---

## 4. Phase 4 — calibration bill of materials

A number is only a measurement if it is traceable to a reference. Everything here exists
to make that sentence true.

| #   | Item                            | Spec                               | Qty       | Why                                                                                                         | ~Cost  |
| --- | ------------------------------- | ---------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------- | ------ |
| 25  | **METER TEROS 12** + ZSC reader | VWC ±0.03 m³/m³, EC, temperature   | 1         | The VWC reference §10 names. Everything moisture-related is calibrated against this                         | £350   |
| 26  | Calibration masses              | OIML M1, 1–20 kg set, certificated | 1 set     | Force reference. Uncertificated masses give you precision without accuracy                                  | £400   |
| 27  | Thermal chamber                 | −10 to +60 °C, ±0.5 °C             | 1         | Load-cell drift with temperature. A fridge and an oven will do at a pinch and you must say so in the record | £600   |
| 28  | Soil compositions               | ≥3: sand-dominant, loam, clay-loam | ~50 kg ea | §10 requires calibration across at least three compositions                                                 | £100   |
| 29  | KCl conductivity standards      | 0.01 M, 0.1 M, 1.0 M               | 1 set     | Salinity correction curve for the VWC probe                                                                 | £60    |
| 30  | Benchtop EC/pH meter            | Lab grade, calibrated              | 1         | Independent check on the field EC sensor                                                                    | £200   |
| 31  | Drying oven + balance           | 105 °C; 0.01 g                     | 1 ea      | Gravimetric VWC — the ground truth the TEROS is itself checked against                                      | £500   |
| 32  | Homogeneous lab substrate       | Compacted uniform sand bed, sealed | 1         | Isolates **instrument** repeatability from spatial variance (§9)                                            | £80    |
| 33  | **Second complete instrument**  | Full build of §3                   | 1         | §10 requires cross-instrument comparison. One unit cannot be compared to anything                           | £1,200 |

**Indicative Phase 4 total: £3,500–4,000**, of which the second instrument is a third.

---

## 5. Wiring

ESP32-S3 pin map. Avoids strapping pins (0, 3, 45, 46), USB (19, 20) and flash/PSRAM
(26–32). Verify against your specific devkit's silkscreen before soldering.

| Function                  | Pin                   | Notes                                              |
| ------------------------- | --------------------- | -------------------------------------------------- |
| Battery sense             | GPIO1                 | ADC1, through a 1:4 divider                        |
| Trigger button            | GPIO2                 | Input, pull-up                                     |
| ADS1220 DRDY              | GPIO4                 | Interrupt on data-ready — do not poll              |
| ADS1220 CS                | GPIO5                 | Shares the SPI bus with SD                         |
| Encoder A / B             | GPIO6 / GPIO7         | Hardware PCNT unit, not interrupts                 |
| I²C SDA / SCL             | GPIO8 / GPIO9         | SHT40, EC sensor, RTC. 4.7 kΩ pull-ups             |
| SD CS / MOSI / CLK / MISO | GPIO10 / 11 / 12 / 13 | SPI2                                               |
| Actuator PWM / DIR        | GPIO14 / GPIO15       | LEDC peripheral, 20 kHz                            |
| Limit top / bottom        | GPIO16 / GPIO17       | Hardware-interrupt, also wired to cut motor enable |
| GPS RX / TX               | GPIO18 / GPIO21       | UART1, 38400 baud                                  |
| GPS PPS                   | GPIO33                | Sub-microsecond time alignment for the curve       |
| Status LED                | GPIO38                | Board-dependent                                    |

**Analogue rules that will otherwise cost you a week:**

- Load cell excitation and the ADS1220 get their own linear regulator, not the buck rail.
  Switching noise on the bridge shows up as force noise you will mistake for surface texture.
- Star ground. One point. The motor driver's ground return is the loudest thing in the box.
- Shielded, twisted load-cell cable, shield grounded **at the ADC end only**.
- Keep the load-cell cable away from the actuator cable. If they must cross, cross at 90°.
- Thermistors get a 0.1 µF to ground at the ADC pin.

---

## 6. Bring-up order

Never integrate two untested subsystems. Each step below must produce a number you
believe before the next one starts.

1. **Blink.** Devkit alive, toolchain flashes, serial console readable.
2. **SD card.** Write 10 MB, power-cycle, read it back, compare hashes. Do this before
   anything generates data worth losing.
3. **RTC.** Set, power-cycle, confirm drift under 2 s/day.
4. **ADS1220 alone.** Short the inputs. You should see noise around zero, not a rail. Log
   1,000 samples and check the standard deviation is within the datasheet's noise table.
5. **Load cell on the bench.** Hang known masses (item 26). Record the raw counts for each.
   You now have a two-point calibration — write it down, it becomes `Calibration.forceCoefficients`.
6. **Encoder alone.** Move the carriage a measured 100 mm with calipers. Counts per mm
   must be stable to 0.1 % over ten repeats.
7. **Actuator, unloaded, no probe.** Confirm 20 mm/s ±2 % across the full stroke. Confirm
   both limit switches cut the motor **in hardware**, with the MCU held in reset.
8. **First curve, into a bucket of sand.** Force and depth on one time base. It should look
   like a curve: shallow rise, knee, steep rise. If it does not, stop and fix it — every
   later step assumes this shape.
9. **GPS.** Cold fix outdoors, confirm reported accuracy <1 m, confirm PPS is toggling.
10. **VWC + EC + temperature.** Dry sand, saturated sand, and a KCl standard. Numbers must
    move in the right direction before they are believed.
11. **Full integration.** All sensors logging to SD during a traverse, at rate, with no
    dropped samples. Check the sample count against elapsed time.

---

## 7. Field session procedure

The protocol is the measurement. A session captured outside it is not a session (§2.6).

### Before leaving

- [ ] Confirm a calibration is in force for today's date. An expired one produces
      `CALIBRATION_EXPIRED` and the readings will be excluded from the index (§2.5).
- [ ] Charge pack, format a fresh SD card, confirm free space
- [ ] Confirm RTC within 2 s of true time
- [ ] Record instrument serial and operator ID — both go on every reading (§2.7)

### On site

1. **Declare the sampling pattern before capturing anything.** Written down first. A
   pattern recorded afterwards is a description of what happened, not a rule.
   Default: `grid_20pt_3segment_v1`.
2. **Never take two readings at the same point.** The first destroys it. Use a
   **0.5 m adjacent-point grid**: 20 points, marked with survey pins.
3. Cover **all three path segments** — rail, mid, outside. A stands-side reading does not
   describe the track a field runs on. The session validator rejects a session covering
   fewer than two.
4. At each point: seat the frame, zero the encoder, confirm GPS accuracy <1 m, trigger.
   One traverse, 0→200 mm at 20 mm/s. Do not lean on the frame.
5. Take VWC and EC within 200 mm of each penetration, at the same time.
6. Record the maintenance log — harrowed at, watered how much, rain overnight — at the
   session level. Without it, Phase 6's latency model has nothing to work with.
7. Record the official going label as published. For comparison, never for scoring.

### Repeatability testing (§9 exit)

You cannot take 20 readings at one spot. What you report is therefore **combined spatial

- instrument variance**, and it is reported as that, not as instrument variance.

* **Field:** 20 points on the 0.5 m grid → combined variance. Characterise it; do not try
  to minimise it. Spatial variance is a real property of the track.
* **Lab:** the homogeneous substrate (item 32) → instrument variance alone.
  **Target: <5 % coefficient of variation.**

### After

```bash
pnpm --filter @harrow/api dev
# then POST the session and the SD import to /v1/ingest
```

Ingest is idempotent on a hash of the raw bytes, so re-importing the same card is safe
and reports duplicates rather than writing twice.

---

## 8. Calibration procedures (Phase 4)

Each produces a versioned `Calibration` record. An uncalibrated reading is stored and
flagged, never silently included (§2.5).

### 8.1 Force

1. Mount the load cell in the calibration rig, vertical, unloaded, at 20 °C.
2. Record zero for 60 s. The mean is the offset.
3. Apply masses in ascending order: 1, 2, 5, 10, 20 kg. 30 s each.
4. Descend through the same points — hysteresis appears here or nowhere.
5. Three full cycles.
6. Fit force vs. counts. **Nonlinearity >0.1 % FS means the cell is damaged or overloaded.**
7. Record gain, offset, residuals, and the mass certificate numbers.

### 8.2 Temperature drift

1. Load cell in the thermal chamber, dead weight applied.
2. Soak 30 min at each of −5, 5, 15, 25, 35, 45 °C.
3. Record indicated force at each. The slope is the compensation coefficient.
4. **If drift exceeds 0.5 % FS across the range, compensate in software and say so in the
   calibration record.** Do not silently absorb it.

### 8.3 VWC, with salinity correction

The step most often skipped, and the one that most often makes moisture data useless.

1. For each of the three soil compositions (item 28):
2. Prepare five moisture levels from air-dry to saturation.
3. At each: read the Harrow probe, read the TEROS 12, take a gravimetric sample.
4. Dry at 105 °C to constant mass. Gravimetric VWC is the ground truth; the TEROS is
   itself being checked here.
5. Repeat the full series at three salinity levels using the KCl standards.
6. Fit VWC as a function of (raw capacitance, EC, temperature).
7. **Exit: within ±0.03 m³/m³ of gravimetric across the full range, at every salinity.**

### 8.4 Cross-instrument

1. Both units, same lab substrate, alternating, 20 readings each.
2. Paired t-test on the derived quantities.
3. **A systematic offset means the calibration procedure — not the instrument — is
   underdetermined.** Fix the procedure.

### 8.5 Operator study — the one that can kill the phase

The GoingStick's documented weakness is that readings vary with the person. Harrow's
answer is the constant-rate actuator. This is where that claim is tested rather than
asserted.

1. **n ≥ 5 operators**, ideally including someone who has never used it.
2. Each takes 10 readings on an adjacent-point grid, on the same substrate, same day.
3. Decompose the variance: between-operator vs. within-operator vs. spatial.
4. Report between-operator variance as a number. Every validation run reports it (§2.7).

**Exit:** operator variance < surface variance.
**Kill:** operator effect dominates and cannot be engineered out at reasonable cost. If a
motorised constant-rate drive still leaves the operator as the largest term, the problem
is seating, alignment or frame stiffness — and if those cannot be fixed cheaply, the
device is not the product. Return to [positioning.md](positioning.md).

---

## 9. Data format

The firmware writes a versioned binary log to SD. The decoder is documented and lives in
the repo, so a card is readable by something other than the firmware that wrote it.

- Curves are stored as **f64 little-endian, interleaved**, exactly as the database stores
  them: `[depth_mm, force_N, ...]`. See
  [curve-storage-benchmark.md](curve-storage-benchmark.md).
- Nothing on the device downsamples, smooths or averages. Full rate to card, always.
- The drive-rate profile is logged as `[t_ms, depth_mm, ...]` on every reading, even
  though the drive is motorised. If the control ever fails, the telemetry is the only
  evidence.

---

## 10. Safety

- **The reaction frame is the hazard.** 1.5 kN through a 1.29 cm² cone is roughly 12 MPa.
  Keep hands clear of the travel path; both limit switches must cut motor power in
  hardware, independently of firmware.
- LiFePO4 packs need a BMS and a fused positive lead. Do not charge unattended.
- The thermal chamber and drying oven run at temperatures that burn.
- KCl standards are low hazard; still, gloves, and do not pour them into a soil sample you
  intend to use again.
- Working trackside means high-vis, a permit, and never being on the surface during
  training hours.

---

## 11. What NOT to buy yet

| Not yet                          | Because                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Enclosure tooling, IP67 housings | §9 is dev-board only. Package it once you know what it is                                                  |
| RTK base station                 | Sub-metre is enough for path segment; within-segment is a later question                                   |
| Anything handheld                | The constant-rate decision makes Phase 3 a frame-mounted rig, deliberately                                 |
| More than two instruments        | Two satisfies cross-instrument comparison. A fleet before Phase 4 clears is a fleet of unvalidated devices |
| Custom PCBs                      | Breakouts until the pin map stops changing                                                                 |
| Ground-penetrating radar         | RSTL's territory, base inspection, a different product                                                     |
