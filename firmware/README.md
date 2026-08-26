# firmware — ESP-IDF

Deferred to **Phase 3**, and only if Phases 1 and 2 both clear. No code here before then.

Target hardware (dev-board only at Phase 3): ESP32-S3, load cell + HX711 paired with a
linear position sensor, capacitive VWC with salinity correction, SHT40 + probe thermistor,
u-blox NEO-M9N. Raw logged at full rate to SD in a versioned binary format with a
documented decoder.

The open design decision is drive-rate control — controlled energy input versus full
drive-rate capture with normalisation and outlier rejection. It is documented before it
is built.
