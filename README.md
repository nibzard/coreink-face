# CoreInk Faces

Give any application state a face. A small TypeScript library and Cloudflare API for e-paper companions, fictional pets, ambient displays, and agent status indicators.

Submit JSON state and an optional message, choose an expression, and let a device fetch the latest face and text. The included catalog has 35 SVG faces. Replace the catalog or chooser without changing the device protocol.

[![CI](https://github.com/nibzard/coreink-face/actions/workflows/ci.yml/badge.svg)](https://github.com/nibzard/coreink-face/actions/workflows/ci.yml)

[Browse the face atlas](assets/faces/face-map.svg) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Quick start

Use Node.js 24 (see `.nvmrc`) and npm.

```sh
npm ci
cp .dev.vars.example .dev.vars
# Replace both placeholder tokens in .dev.vars.
npm run dev
```

In another terminal:

```sh
node --env-file=.dev.vars examples/publish.mjs examples/pet.json pebble
```

The default `auto` mode uses Jev when `TYPESAFE_API_KEY` is configured, otherwise it uses rules. The `rules` provider selects the exact face ID in `state.expression`, falling back to `small-dots`. This is deliberately predictable and requires no model account. It does not infer emotions from arbitrary prose. Enable Jev for semantic selection from your JSON state.

## Use as a library

```sh
npm run build
node examples/library.mjs
```

```ts
import { createFaceEngine, createRuleChooser, faces } from './dist/index.js';

const companion = createFaceEngine({
  faces,
  fallbackFace: 'small-dots',
  chooser: createRuleChooser([
    { when: state => state.event === 'found-treasure', face: 'stars' },
    { when: state => state.quietHours === true, face: 'sleepy' },
  ], 'small-dots'),
});

const result = await companion.decide({ event: 'found-treasure' });
// result.face === 'stars'
```

Pass a previous `{ face, changedAt }` to apply the minimum hold. The library is stateless: the caller owns persistence and timers. The Cloudflare adapter handles both for you. The package exports ESM and TypeScript declarations; it is private by default to prevent accidental npm publication. No Cloudflare types or services are needed by the library.

A custom chooser implements one port:

```ts
const chooser = {
  name: 'my-app',
  async choose(state, catalog) {
    return { face: 'curious' }; // Optional confidence: number from 0 to 1
  },
};
```

A custom catalog is an array of `{ id, name, description }`. All decisions are checked against its IDs. Give expressions distinct descriptions. Configure the deployed catalog and chooser in `src/cloudflare/config.ts`; examples never become core domain rules.

## Jev / TypeSafe

Jev selects one catalog entry using the [typed Choice endpoint](https://docs.typesafe.ai/primitives/choice). Its adapter sends one question and reads `answers.face.choice` and `answers.face.confidence`. It has a five-second timeout and bounds provider responses to 64 KB.

1. Leave `FACE_PROVIDER` as `auto`, or set it to `jev` to require model configuration. Set `rules` to explicitly disable model calls.
2. Add `TYPESAFE_API_KEY` to `.dev.vars` for local development.
3. For deployment, run `npx wrangler secret put TYPESAFE_API_KEY`, then `npm run deploy`.

For the standalone library:

```ts
const chooser = createJevChooser({ apiKey, model: 'jev-latest' });
```

The model is configurable through `JEV_MODEL`. Pin a model available to your account if stable behavior matters. Provider choice is server configuration, not caller input. A missing key returns 503 in Jev mode. Timeouts, invalid responses, and provider failures preserve the last face (or the neutral face for a new device), with `reason: "provider-unavailable"`. Low confidence does the same with `reason: "low-confidence"`. Neither is reported as a successful model selection. The default confidence threshold of 0.4 is a starting policy, not a calibrated guarantee.

In Jev mode you can omit `expression` and submit any meaningful state. The included JSON examples have `expression` so they also work with the no-key rules provider.

## HTTP API

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | Public | Liveness |
| GET | `/v1/faces` | Writer or reader | Catalog with descriptions |
| POST | `/v1/decide` | Writer | Stateless classification |
| PUT | `/v1/devices/:id/state` | Writer | Classify and persist a device's display |
| GET | `/v1/devices/:id/face` | Writer or reader | Read the latest display; no model call |

Use `Authorization: Bearer <API_TOKEN>` for writers and `Bearer <DEVICE_TOKEN>` for devices. Both are deployment-wide tokens: the reader can read all device IDs. This template is for a personal installation or trusted fleet. Add per-device credentials and tenant ownership checks before offering it as a multi-user service. All private routes fail closed when tokens are missing. Requests do not enable browser CORS by default.

Both write endpoints accept only this envelope (maximum 16 KB):

```json
{
  "message": "Found a shiny pebble!",
  "state": {
    "scene": "A tiny stone creature finds a shiny pebble",
    "expression": "stars"
  }
}
```

`state`, when provided, must be a JSON object; fields within it are domain-specific. Provide `state`, `message`, or both. Device IDs contain 1–64 letters, numbers, underscores, or hyphens.

The device response:

```json
{
  "revision": 1,
  "message": "Found a shiny pebble!",
  "decision": {
    "face": "stars",
    "candidate": "stars",
    "source": "rules",
    "reason": "selected",
    "changedAt": "2026-10-23T12:00:00.000Z",
    "decidedAt": "2026-10-23T12:00:00.000Z"
  },
  "nextPollSeconds": 60
}
```

Render `decision.face`, not `candidate`. `candidate` explains what the chooser preferred while a minimum hold or confidence policy kept the existing face. Jev decisions also include `confidence`. Stateless `/v1/decide` returns the decision fields plus `message` (empty when omitted).

GET returns an ETag. Send it as `If-None-Match` to receive 304 when the revision is unchanged. A new decision may increment the revision even if its visible face stays the same; firmware should skip redraws only when both the face ID and message are unchanged.

Errors: 400 invalid JSON/state, 401 missing/wrong token, 404 missing route/device, 409 update superseded by a newer request, 413 oversized input, 415 wrong content type, 503 missing provider configuration. Internal errors return a correlation ID without exposing data.

## Messages below the face

Send a user-authored message through the same authenticated write endpoint:

```http
PUT /v1/devices/pebble/state
Authorization: Bearer <API_TOKEN>
Content-Type: application/json

{"message":"Have a lovely day!"}
```

Or try the included example:

```sh
node --env-file=.dev.vars examples/publish.mjs examples/message.json pebble
```

The `message` field is plain text, with a maximum of 120 Unicode code points.
Newlines are allowed; other ASCII control characters are rejected. Text is
returned exactly as submitted: no model rewriting or HTML interpretation.
Omitting it on a device update preserves the current message; an empty string
clears it. An explicit message is also supplied to the chooser as `state.message`
(overriding that field inside `state`, if present). Jev can infer a face from a
message-only request. The rules provider still needs `state.expression` to pick
anything other than its neutral default.

The polling response contains top-level `message` beside `decision`. Firmware
should draw `decision.face` in the upper portion and wrap `message` underneath.
For a 200 × 200 screen, a starting layout is a 140 × 140 face area and a text
area below it, using the remaining height and margins. Choose a font and wrap
by measured pixel width; truncate excess visible text with an ellipsis. Unicode
acceptance by the API does not guarantee glyph support in the device's font.

A message update increments the revision even if the face stays unchanged. It
is immediately available to polling clients while the face's minimum hold is
active. Firmware still needs to enforce refresh limits for the whole screen.
Face alarms preserve the current message. Existing devices migrate with an
empty message, retaining their face and revision. This repository implements
the API contract; displaying text on physical hardware requires its firmware
to render this field.

## Device behavior and concurrency

Each device has its own SQLite-backed Durable Object. It stores decisions, a pending face, the display message, and sequence numbers; the other input state is passed to the provider but not persisted by this app. Application logs omit state and credentials. TypeSafe's own data handling applies when using Jev.

Updates reserve a sequence before classification. A slower request cannot overwrite one that arrived later; it returns 409 instead. New updates replace any pending face. After a 15-second minimum hold, an alarm applies the latest pending candidate without another model call. A restart retains the displayed and pending faces. Failed/uncertain classification retains the displayed face and clears a pending change.

The service stores the latest outcome, not an event history. PUT retries can incur another model call and revision; no arbitrary work or tool side effect is executed. Submit meaningful state changes, and poll the read endpoint freely without inference costs. For public workloads, add account-appropriate rate limits before distributing writer credentials.

Firmware should store the artwork locally, poll on its own battery-aware schedule, retain its last face offline, and enforce its own display refresh limits. A server hold cannot guarantee physical screen timing across device restarts. This project supplies the API and vector assets, not flashed firmware. SVGs require rasterization for the CoreInk display.

## Plug in your own work

The application that performs the work publishes its state here:

```text
weather / smart home / pet simulation / agent
                   ↓ JSON state
             face-selection engine
                   ↓ face ID
                device
```

A broad starting idea is **Pebble**, a small room companion that reacts to music, changing weather, visitors, and little discoveries. Its state can be as playful as `{"event":"found-treasure"}` or as factual as a home sensor reading. A coding agent uses the same contract with fields such as `status` and `summary`.

Keep task execution and permissions in the upstream application. A face is presentation, never approval to perform an action. This separation lets you add a Workflow, an existing agent, or your own service without changing this library.

## Project layout

```text
src/domain/        Face catalog, state and chooser contracts
src/application/   Selection, confidence and display-hold policy
src/adapters/      Rule and Jev choosers
src/cloudflare/    HTTP API, auth, durable device storage, composition
examples/          Room companion, pet and agent state; runnable clients
assets/faces/      Individual SVGs, sprite, manifest and clickable atlas
```

## Deploy

```sh
npx wrangler login
# Set a unique Worker name in wrangler.jsonc for your installation.
npm run check
npm test
npm run test:runtime
npm run deploy:check
npm run deploy
npx wrangler secret put API_TOKEN
npx wrangler secret put DEVICE_TOKEN
```

Use independent random tokens. Private routes remain inaccessible until secrets exist. Wrangler also supports `deploy --secrets-file <file>` to configure both on the initial deployment; keep that file ignored and permission-restricted. Secret files are never uploaded as static assets. Durable Objects are provisioned by the migration. There are no custom domains, scheduled polls, or work executors to configure.

The Workers runtime test launches local Wrangler with temporary storage and test-only tokens. It checks auth, body limits, response shapes, ETags, device isolation, restart persistence, and delayed expression changes. Unit tests exercise selection policy and the Jev HTTP contract with a mocked provider. Live Jev calls require your key and are not part of the default test suite. `examples/library.mjs` uses Jev when the environment contains `TYPESAFE_API_KEY`, otherwise rules.

## License

[MIT](LICENSE).
