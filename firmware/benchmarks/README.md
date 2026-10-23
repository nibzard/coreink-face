# CoreInk end-to-end benchmark — 2026-10-23

Public page: https://pebble-little-moments.niko370669.chatgpt.site

Six live submissions passed through the public Worker, its D1 cooldown, the
canonical display API, Jev, and the connected CoreInk. No explicit face or
forced USB poll was used. Each returned revision was matched to the device’s
poll and completed physical panel refresh. Three samples per firmware version:

| Measurement | Before median (range) | After median (range) |
| --- | --- | --- |
| Submission → API acceptance | 0.51 s (0.46–0.73) | 0.48 s (0.39–0.60) |
| Submission → completed redraw | 75.83 s (75.22–75.98) | 71.11 s (70.25–71.75) |
| Wi-Fi/clock/HTTPS poll | 8.60 s (5.67–10.14) | 9.14 s (8.10–9.51) |
| Panel rendering | 1.40 s | 1.40 s |
| Device awake per changed-display cycle | 17.53 s (17.53–17.54) | 10.95 s (9.91–11.32) |
| Redraw complete → sleep | 1.08 s | 0.28 s |

These are deliberately slow-phase submissions sent just after sleep begins,
not random arrival percentiles. The remaining delay is predominantly the
60-second sleep plus Wi-Fi/TLS. The API acceptance timing includes both Worker
hops and Jev, not an isolated model call. Jev selected/retained `small-dots` for
these diagnostic messages; the separate visual acceptance run verified its
`sleepy` result on the actual screen. Panel completion uses its busy signal,
not an optical camera measurement. Host serial timing has small transport lag.

## Improvements made

The old firmware started a fresh 15-second refresh guard on every wake. This
ignored the minute already spent asleep and added 4.84–9.30 seconds of awake
waiting in these samples. Firmware now counts a completed timer sleep toward
the guard using one retained integer. Cold reset and early button wakes retain
the conservative guard. Boundary tests cover completed/short sleeps and early
wake; the minimum panel refresh interval stays 15 seconds.

The post-poll service window was reduced from 1000 to 250 ms. The eight-second
reset provisioning window remains. The measured median awake time fell 37.5%.
Networking varied between samples, so this is an observed small-run comparison,
not a battery-life claim. No new protocol, queue, persistent connection or
polling-frequency change was introduced.

Production testing also caught a Node/Workers difference: Workers rejected
`redirect: error` before sending the upstream request. The composer now uses
`manual`, rejects non-success responses, and has a workerd/D1 integration test.
The live public submissions above all succeeded after this correction.

## Battery and energy

**Energy and battery life were not measured.** USB was connected and charging;
the observed battery ADC values were about 4.19–4.21 V during changed-display
cycles. Voltage is not a current measurement and does not reveal charge used.

For scale only, the removed median non-radio wait was about 7.13 seconds per
changed-display cycle, including the shorter service window. At an assumed
3.3 V and the ESP32-PICO datasheet’s 160 MHz CPU-on range of 27–44 mA, that wait
corresponds to roughly **0.18–0.29 mWh of chip-only energy**. This is an
illustrative estimate, not total board energy, a measured saving, or a prediction
of battery endurance. Regulator losses, panel power, radio duty, charger and
board sleep current are excluded. [Espressif datasheet](https://documentation.espressif.com/esp32-pico_series_datasheet_en.pdf).

The next useful power measurement is a battery-supply current log spanning an
unchanged 304 cycle, a changed-display cycle, and deep sleep, integrating V×I.
A USB meter while charging would mix charging energy with device energy.

## Reproduce

Build/flash the firmware, keep normal sleep enabled, close other serial
monitors, then run from the repository root:

```sh
firmware/.venv/bin/python firmware/tools/benchmark.py \
  --port /dev/cu.usbserial-XXXX --samples 3 --label candidate \
  --report firmware/build-host/benchmark-candidate.json
```

The test replaces the displayed message and respects the public cooldown.
Another sender can replace its revision, in which case it times out rather
than reporting a false success. No credentials are needed for the public test.

Raw evidence: [before](2026-10-23-before.json),
[after](2026-10-23-after.json),
[earlier physical acceptance](2026-10-23-acceptance.json).

Final browser check: the public composer accepted “Hello, Nikola!” as revision
22, and the device completed its timer-polled redraw and returned to sleep.
The full composer fit a 375×667 viewport without scrolling or overflow.
[UI verification](2026-10-23-public-ui.json) · [Mobile screenshot](pebble-public-inbox.png).
