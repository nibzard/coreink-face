# CoreInk Faces firmware

An ESP-IDF client for the M5Stack CoreInk (K048): ESP32-PICO-D4, 4 MB flash,
200 × 200 monochrome e-paper, and the built-in battery. It reads the current
display from this repository's API and stores all artwork locally.

The firmware is implemented and builds with ESP-IDF **v5.3.4**, M5Unified
**0.2.27**, and M5GFX **0.2.34**. The component manifest and dependency lock
pin those versions. No PSRAM is required. The factory application partition
has no OTA slots; updates use USB.

## Build and flash

Install [ESP-IDF v5.3.4](https://docs.espressif.com/projects/esp-idf/en/v5.3.4/esp32/get-started/index.html)
and its ESP32 tools, then build from this directory:

```sh
. /path/to/esp-idf/export.sh
cd firmware
idf.py build
idf.py -p /dev/cu.usbserial-XXXX flash
```

Alternatively, install a toolchain local to this repository (all downloads are
ignored by Git). Run from the repository root:

```sh
mkdir -p firmware/.tools
git clone --depth 1 --branch v5.3.4 --recursive --shallow-submodules \
  https://github.com/espressif/esp-idf.git firmware/.tools/esp-idf
IDF_TOOLS_PATH="$PWD/firmware/.tools/idf-tools" firmware/.tools/esp-idf/install.sh esp32
bash firmware/tools/idf.sh build
bash firmware/tools/idf.sh -p /dev/cu.usbserial-XXXX flash
```

`tools/idf.sh` uses the local installation when `IDF_PATH` is unset or points
to a missing installation; otherwise it uses your existing ESP-IDF environment. Generated assets are checked in,
so a normal firmware build needs no SVG rasterizer or Python imaging library.

To create a single flash image containing the bootloader, partition table,
and application, run `bash firmware/tools/idf.sh merge-bin -o coreink-faces-flash.bin`
from the repository root. The resulting `firmware/build/coreink-faces-flash.bin`
is a merged image for flash offset **0x0**. The separate `coreink_faces.bin`
is the application only and belongs at **0x10000**; `idf.py flash` handles
these offsets automatically.

## USB setup

Install the host tools in a virtual environment, from the repository root:

```sh
python3 -m venv firmware/.venv
firmware/.venv/bin/pip install -r firmware/tools/requirements.txt
firmware/.venv/bin/python firmware/tools/provision.py --port /dev/cu.usbserial-XXXX provision
```

The utility prompts for Wi-Fi, the HTTPS API origin, device ID, and
**DEVICE_TOKEN**. Passwords and tokens use hidden prompts. The firmware's raw
serial protocol does not echo commands or expose secrets in status output.
Only use the reader token on the device. The API's reader token currently
grants read access to every device in that deployment.

Use an origin such as `https://your-worker.workers.dev`, without a trailing
slash or path. HTTP and self-signed certificates are not supported. The device
synchronizes its clock with `pool.ntp.org` after a cold boot and verifies the
server against ESP-IDF's CA bundle. Internet DNS, NTP, and HTTPS must be reachable.
Redirects are disabled to prevent credentials being forwarded elsewhere.

Provisioning resets the device into its eight-second USB setup window. Close
`idf.py monitor` before running the utility. `--no-reset` is available for a
device that is already awake. If the USB bridge cannot reset the board,
press reset immediately before running with `--no-reset`.

```sh
# Additional options follow the provision command.
firmware/.venv/bin/python firmware/tools/provision.py --port PORT provision \
  --base-url https://your-worker.workers.dev --device-id pebble \
  --poll-seconds 60 --stay-awake

firmware/.venv/bin/python firmware/tools/provision.py --port PORT status
firmware/.venv/bin/python firmware/tools/provision.py --port PORT poll
firmware/.venv/bin/python firmware/tools/provision.py --port PORT redraw
firmware/.venv/bin/python firmware/tools/provision.py --port PORT awake on
firmware/.venv/bin/python firmware/tools/provision.py --port PORT awake off
firmware/.venv/bin/python firmware/tools/provision.py --port PORT erase
```

`--stay-awake` keeps the CPU awake for USB diagnostics; Wi-Fi still turns off
between polls. Omit it for battery operation. A polling override of `0`
(the default) follows the server's hint. `erase` asks you to type `ERASE` and
clears this firmware's NVS namespace and display cache.
The `awake on/off` commands change sleep mode without re-entering credentials.

Wheel up/down browses the last **64 rendered messages**, cached in a separate
128 KB NVS history partition. Center click from history resumes the incoming queue.
Click again on the current message to read its full text without the character;
another click restores the normal face view. Browsing
pauses incoming delivery until the center button resumes it. Wheel controls
wake the device from light sleep. Rapid navigation coalesces with a 120 ms debounce and uses the panel’s fast
waveform with the vendor’s differential transition tables, preserving the
controller’s old-image bank across consecutive partial updates. The red LED
pulses briefly on wheel input. After 15 seconds of inactivity,
a quality refresh cleans up ghosting. Automatic updates retain the conservative
refresh guard; faster refreshes are limited to direct user interaction. The
manufacturer recommends avoiding sustained high-frequency refreshing. History and the selected item survive
reset and work offline.

The device acknowledges a queued revision only after its content has been
painted (or found pixel-identical). Acknowledgement is sent on the next network
cycle before fetching the next message. Pending messages remain in the API
while offline. The reader token is allowed to acknowledge but cannot enqueue.

Light sleep supports all three active-low wheel contacts without a custom ULP
program. It consumes more idle power than the earlier deep-sleep benchmark;
that benchmark is historical and does not establish this version’s battery life.
The application partition is now 0x3d0000 bytes; credentials remain at their
original NVS address. Flash the partition table with the application.

Configuration uses atomic, versioned NVS blobs. **The default development build
does not encrypt flash or NVS.** Credentials are protected from accidental
logging, but someone with physical flash access can recover them. Enabling
ESP-IDF flash/NVS encryption requires a separate production partition and key
policy; no build or provisioning command here burns security eFuses.

## Publish a display

An upstream application creates the first display using the writer token:

```http
PUT /v1/devices/pebble/display
Authorization: Bearer <API_TOKEN>
Content-Type: application/json

{"face":"stars","message":"Pronašao sam blago!"}
```

The firmware only calls:

```http
GET /v1/devices/pebble/display
Authorization: Bearer <DEVICE_TOKEN>
If-None-Match: "<previous-etag>"
```

It renders top-level `face` and `message`. Selection metadata is ignored.
A `304` keeps the cached content and previous polling hint. A new revision
without changed pixels does not refresh the screen. No inference runs on
the device or on a read request.

The parser bounds bodies to 8 KB, JSON depth to 16, face IDs to 64 bytes,
and decoded messages to 120 Unicode code points / 480 UTF-8 bytes. Invalid
responses preserve the last valid display and validator. Additional JSON fields
are ignored. Duplicate top-level keys and embedded NULs are rejected.

## Display, buttons, and battery

The upper 136 × 136 area holds the face; text starts at y=144. The text area
uses native **Terminus Bold 10 × 20** bitmap glyphs, copied directly from the
font's pixel grid without outline rasterization or resizing. Vertical stems in
H and lowercase l are both two pixels wide. A 10-pixel advance fits 18 characters
within the 184-pixel text area, so the greeting fits on one line. It measures glyph widths within 184 pixels,
keeps short messages such as “Hello, Nikola!” on one line, and wraps longer
messages at word boundaries onto at most **two lines**. Explicit newlines are
respected. Each line is independently centered horizontally on the screen.
Text beyond the two-line limit ends in `…`; long unbroken words are
split only when they cannot fit a whole line. The full message remains in the API.
Clicking the current message opens a text-only reading view using the same font
across up to nine lines. All 120 supported message code points fit. If word wrapping
or explicit line breaks would overflow, this view wraps by character and treats
line breaks as spaces. Incoming delivery pauses while reading; clicking again or
turning the wheel leaves the reading view. Reset restores the normal face view.
ASCII and Latin U+00A0–U+017F,
including Čć, Žž, Šš, and Đđ, are embedded. Unsupported characters render as
`?`. Unknown face IDs use `small-dots`, retaining the message.

Automatic updates, status screens, and error screens use a 15-second minimum
refresh interval. The interval starts when the previous refresh completes.
Every restart starts a fresh guard. Direct interaction uses a fast partial
refresh after a 120 ms debounce. A quality refresh cleans the panel after
15 seconds without another update.

The initialization adapter disables automatic refresh before the panel starts.
It then gives the initialized driver to M5Unified. Setting
`clear_display=false` alone does not prevent the M09 driver from refreshing
uninitialized memory. `redraw` requests recovery while preserving credentials
and API content. The panel uses a white background with black artwork and text.
The active-low GPIO10 indicator pulses on wheel input and stays off during sleep.

- Tap the **middle dial button** from history/status to return to the current message.
- Tap on the current message to toggle the full-screen text view.
- Hold it for at least one second, then release, to show status.
- Hold the button through wake, then release it, to request status.
- USB status commands give diagnostics without redrawing the display.

Normal operation connects, polls, refreshes only when needed, disconnects
Wi-Fi, and enters ESP32 light sleep. The default API hint is 60 seconds; hints
are clamped to 15–3600 seconds. Battery readings at or below 15% raise the
interval to at least 900 seconds. Unknown battery readings do not trigger that
policy. Failures add exponential backoff with jitter; authentication failures
retry no more frequently than every 15 minutes. Numeric `Retry-After` values
are honored up to one hour. HTTP-date `Retry-After` values are ignored.

The timer or any wheel contact can wake the device. GPIO37 and GPIO39 detect
wheel movement; GPIO38 detects the center button. GPIO12 keeps board power on.
Light sleep preserves memory and the monotonic clock. Battery life and sleep
current still require hardware measurement.

## Recovery

The latest server content and validator are separate from the last painted content.
Nonvolatile storage (NVS) checkpoints changed content and completed delivery revisions.
Identical messages with different revisions each enter history without a panel refresh.
Routine unchanged polls do not write flash. Normal memory preserves validators,
retry counts, and display state across light sleep. The persistent cache has a
schema version, a cyclic redundancy check (CRC), and a SHA-256 scope tied to
the API origin, device ID, and token. Changing that identity invalidates old content.

Before a physical refresh, NVS records that the screen's contents are uncertain.
A failed checkpoint prevents painting. A failed paint remains pending and retries
after 15 seconds. Only successful completion marks the frame as painted. If power fails midway,
the next boot redraws the staged frame even when its fetch returns `304`.
An error or status screen records its actual content so it can be restored to
the server display on the next poll. Identical repeated error screens do not
cause additional refreshes.

| Failure | Behavior |
| --- | --- |
| Device has not received its first publish (`404`) | Show a waiting screen and retry |
| Reader token rejected (`401`/`403`) | Keep cached display; show setup error if no cached display exists; retry slowly |
| Wi-Fi, DNS, clock sync, TLS, HTTP, or response validation fails | Keep cached display and back off |
| Unknown face ID | Neutral artwork, original message, serial warning |
| Corrupt/old/wrong-scope cache | Discard cache and perform an unconditional fetch |
| Interrupted display refresh | Redraw pending content after the refresh guard |
| NVS initialization fails | Report the ESP-IDF error; credentials are never automatically erased |

## Test and preview

From the repository root:

```sh
cmake -S firmware/test -B firmware/build-host -DCMAKE_BUILD_TYPE=Debug
cmake --build firmware/build-host
ctest --test-dir firmware/build-host --output-on-failure
python3 -m unittest discover -s firmware/test -p 'test_*.py'
python3 firmware/tools/generate_assets.py --check-sources

# Requires npm ci; starts an isolated local Worker with temporary data and test tokens.
python3 firmware/test/api_integration.py

# Uses the identical parser and pixel renderer used by the device.
firmware/build-host/ink-preview firmware/test/snapshot.json firmware/build-host/preview.pbm
# Preview the full-screen reading view without a device.
firmware/build-host/ink-preview firmware/test/snapshot.json firmware/build-host/full-message.pbm --full-message
```

Host tests enable AddressSanitizer and UndefinedBehaviorSanitizer by default.
They cover buffered/chunked bodies, body limits and stream deadlines,
response validation and malformed input, UTF-8 boundaries, staged
updates, revision-only changes, cache corruption/scope/restart recovery,
refresh timing, backoff, text layout, and fallback rendering, plus 10,000
deterministic parser fuzz inputs. Python tests cover provisioning validation
and suppression of echoed secrets. The integration test checks authentication,
first publish, real API response decoding, ETag/304, Unicode rendering, and
message clearing through the native firmware renderer.

To regenerate artwork after editing SVGs, install `rsvg-convert` (Homebrew
`librsvg`, or Debian/Ubuntu `librsvg2-bin`) and the Python requirements, then:

```sh
firmware/.venv/bin/python firmware/tools/generate_assets.py
firmware/.venv/bin/python firmware/tools/generate_assets.py --check
```

The source SVGs and manifest remain authoritative. `generated/sources.json`
records source, font, and output SHA-256 hashes. Raster regeneration was verified
with librsvg 2.62.3 and Pillow 11.3.0; different rasterizer versions can change
thresholded edge pixels. Normal builds and CI use the checked-in bitmaps and
verify their provenance without rerasterizing.

## Hardware acceptance

On 2026-10-23, the connected USB-powered CoreInk was flashed and provisioned,
fetched its live API display with HTTP 200, retained configuration through reset,
and resumed conditional polling with HTTP 304 after an ESP32 timer wake
(`DEEPSLEEP_RESET`). Updated typography builds also reconnected using
the saved Wi-Fi settings. Free heap after polling was approximately 199 KB.
Battery-only behavior, sleep current, extended stability, and panel ghosting
still require measurement.

The canonical `/v1/devices/pebble/display` contract was checked against the live
OpenAPI document. The explicit `{"face":"hearts","message":"Hello, Pebble!"}`
payload was published to the live service and fetched by the connected device.
The user confirmed consistent H/l stroke weight and centered text with the
native bitmap font on the physical screen.
Physical acceptance completed on 2026-10-23: the user confirmed the explicit
hearts greeting, repeated centered word-wrapped updates, message clearing, and
Jev’s sleepy expression/message with a white background. The observed minimum
refresh gap was 15.056 seconds. USB-controlled Wi-Fi disable and real TCP
refusal each exercised three failures, retry backoff, retained content and
304 recovery without redraw. Restart also retained the display and resumed 304.
These controlled faults did not shut down the public API or the router.

The public message composer is deployed at
https://pebble-little-moments.niko370669.chatgpt.site (source: `web/pebble`).

The native build and host/integration tests can run without a device. Before
treating a hardware release as verified, check these on an actual CoreInk:

1. Flash, provision over USB, and verify configuration survives a reset.
2. Publish a face, then a message-only change, then an empty message. Check all
   35 faces, Croatian text, explicit newlines, long text, and unsupported glyphs.
3. Poll repeatedly with `304` responses; confirm no visible refresh. Rapidly
   publish changes without button input; confirm refreshes remain at least 15s apart.
   Check fast wheel navigation separately, followed by the quality cleanup refresh.
4. Disconnect Wi-Fi, restore it, and try a wrong reader token. The last valid
   display must survive and recover without USB intervention.
5. Reset during the refresh guard and cut power during a refresh. Check that
   pending content is recovered rather than suppressed by an ETag.
6. Repeat timer/button wake cycles on battery and USB, check for immediate wake
   loops, and compare free heap over an extended run.
7. Measure sleep current, Wi-Fi/TLS energy, battery readings, and panel ghosting.

Light sleep retains the monotonic clock, so elapsed sleep satisfies the local
15-second refresh guard. Cold resets keep the conservative guard.
The post-poll USB/button service window is 250 ms; reset retains an eight-second
provisioning window. Neither change alters the API polling interval.

## Delivery benchmark

[Measured results and limits](benchmarks/README.md): three live submissions per
version, 75.8 → 71.1 s median delivery and 17.5 → 11.0 s awake time.

Run the same benchmark before and after a firmware change with normal sleep
and timer polling enabled (close any other serial monitor):

```sh
firmware/.venv/bin/python firmware/tools/benchmark.py \
  --port /dev/cu.usbserial-XXXX --samples 3 --label baseline \
  --report firmware/build-host/benchmark-baseline.json
```

It submits through the public page’s endpoint without a face, correlates the
queued message with its display revision and serial polling/render events, and records request latency,
end-to-end refresh completion, Wi-Fi/TLS poll duration, panel render duration,
awake duration and battery voltage. It does not force USB polls. This changes the device’s displayed message.

Submissions occur just after sleep starts, deliberately testing delivery near
the slow end of the polling cycle. Three samples are a small diagnostic run,
not a latency percentile or a battery endurance test. Panel completion comes
from its busy signal; the benchmark does not photograph the screen.

USB powers and charges this board. The battery ADC is not a current sensor;
voltage changes cannot establish joules consumed or battery life. For those,
use a current logger on the battery supply, integrate voltage × current over
complete unchanged and changed-display cycles, and measure light sleep too.

## Source layout and references

```text
components/coreink_core/  Host-tested protocol, cache, layout, and pixel renderer
main/                    CoreInk display/buttons, raw serial, NVS, Wi-Fi/TLS, sleep
tools/                   USB provisioning, asset generator, ESP-IDF wrapper
test/                    Native tests, API integration, framebuffer preview tool
```

Tamagotchip's `main/config.c`, `main/hal.h`, `main/main.c`, and `tools/tg.py`
informed the module boundaries, bounded configuration, and provisioning flow.
The LCD driver and agent runtime are not dependencies.

- [CoreInk hardware and 15-second refresh guidance](https://docs.m5stack.com/en/core/CoreInk)
- [M5Unified](https://github.com/m5stack/M5Unified) and [M5GFX](https://github.com/m5stack/M5GFX)
- The bundled Terminus Font 4.49.1 bitmap glyphs use the [SIL Open Font License](tools/FONT-LICENSE).
- The native test copy of cJSON 1.7.18 matches ESP-IDF v5.3.4 and uses its [MIT license](test/vendor/LICENSE).
