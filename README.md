# CoreInk Face

Turn application state into a face and a short message. Use it locally as a TypeScript library, or publish displays through the Cloudflare API.

[![CI](https://github.com/nibzard/coreink-face/actions/workflows/ci.yml/badge.svg)](https://github.com/nibzard/coreink-face/actions/workflows/ci.yml)

- **Works without AI:** choose a face explicitly or supply your own rules.
- **Optional inference:** plug in Jev or any implementation of `FaceChooser`.
- **One display format:** local rendering and the HTTP client return `face`, `message`, and selection metadata.
- **Portable:** zero runtime dependencies, ESM, TypeScript declarations, Web API-based transports.
- **35 included faces:** [view the atlas](assets/faces/face-map.svg), or supply your own catalog.

## Install

The package is not yet published on npm. Install from GitHub (Git and Node.js 22.12+ are required for its build; Node.js 24 is recommended):

```sh
npm install github:nibzard/coreink-face
```

For reproducible installs, append `#<commit-sha>` to that URL. Git installs build the package via `prepare`. Alternatively, run `npm ci && npm pack` in a clone and install the resulting `.tgz` in your project. Installing the tarball needs no build step or Cloudflare credentials.

## Render a face

```ts
import { createFace } from 'coreink-face';

const companion = createFace();
const frame = await companion.render({
  face: 'hearts',
  message: 'Have a lovely day!',
});

// Draw frame.face, then frame.message below it.
```

`render` produces display **data**; it does not draw pixels or flash firmware. An explicit `face` skips classification. With no chooser configured, state-only or message-only input uses the neutral `small-dots` face. The library never discovers API keys or selects a paid service implicitly.

## Choose from state

```ts
import { createFace, createRuleChooser } from 'coreink-face';

const companion = createFace({
  chooser: createRuleChooser([
    { when: state => state.event === 'found-treasure', face: 'stars' },
    { when: state => state.quietHours === true, face: 'sleepy' },
  ], 'small-dots'),
});

const frame = await companion.render({
  state: { event: 'found-treasure' },
  message: 'Look what I found.',
});
```

For Jev, replace the chooser:

```ts
import { createFace } from 'coreink-face';
import { createJevChooser } from 'coreink-face/jev';

const companion = createFace({
  chooser: createJevChooser({ apiKey: process.env.TYPESAFE_API_KEY! }),
});
const frame = await companion.render({ message: 'A rainy evening, a good book, and nowhere to be.' });
```

Keep provider keys on your server. Text is displayed exactly as submitted; the classifier chooses an expression and does not rewrite it. A room companion, fictional pet, and coding agent all use the same state contract. Work execution belongs to the application supplying that state.

## Use the hosted API

```ts
import { createClient } from 'coreink-face/client';

const api = createClient({
  baseUrl: 'https://your-worker.workers.dev',
  token: process.env.FACE_API_TOKEN!,
});

const pebble = api.device('pebble');
await pebble.update({ face: 'hearts', message: 'Hello from the cloud!' });

const result = await pebble.read();
if (result.status === 'modified') {
  console.log(result.display.face, result.display.message);
  // Save result.etag and pass read({ etag }) on the next poll.
}
```

`api.render(input)` classifies without saving a device. `api.faces()` discovers the catalog. Writers publish state; devices use a read-only token to poll without making inference calls. The client does not automatically retry writes: after a timeout, read first, because the update may have completed.

For HTTP-only integrations and agents, start with **[`/openapi.json`](https://coreink-face-api.nikola-balic.workers.dev/openapi.json)** and **[`/llms.txt`](https://coreink-face-api.nikola-balic.workers.dev/llms.txt)**. The same files are exported by the package as `coreink-face/openapi.json` and `coreink-face/llms.txt`. The linked installation requires its owner's credentials for data endpoints; deploy your own using the instructions below.

## The contract

```ts
{ face?: string, message?: string, state?: Record<string, Json> }
```

Provide at least one field. `face` is an exact catalog ID. `message` is up to 120 Unicode code points, with newlines allowed. Omit a message to preserve previous text; send `""` to clear it. The library preserves text when you pass `previous`; the device API stores it. State is a JSON object, limited to 32 nesting levels. The complete input is limited to 16 KB of UTF-8 JSON.

The result contains:

```json
{
  "face": "hearts",
  "message": "Hello!",
  "changedAt": "2026-10-23T12:00:00.000Z",
  "decidedAt": "2026-10-23T12:00:00.000Z",
  "selection": {
    "candidate": "hearts",
    "source": "explicit",
    "reason": "selected"
  }
}
```

Render `face`, not `selection.candidate`. Device displays add `revision` and `nextPollSeconds`. Confidence is optional. Selection metadata explains whether a face was held or a fallback was used.

## Run your own API

```sh
git clone https://github.com/nibzard/coreink-face.git
cd coreink-face
nvm use
npm ci
cp .dev.vars.example .dev.vars
# Replace the two placeholder tokens with independent random values.
npm run dev
```

Try `node --env-file=.dev.vars examples/publish.mjs examples/message.json pebble` in another terminal.

To deploy, choose a unique Worker name in `wrangler.jsonc`, run `npx wrangler login`, then:

```sh
npm run check
npm test
npm run test:runtime
npm run deploy:check
npm run deploy
npx wrangler secret put API_TOKEN
npx wrangler secret put DEVICE_TOKEN
```

Private endpoints fail closed until tokens exist. Add `TYPESAFE_API_KEY` with `wrangler secret put` to enable Jev in the server's `auto` mode. `rules` mode is keyless; `jev` mode requires a key. Explicit face requests skip Jev in every mode. Only the legacy rules adapter interprets `state.expression`; use top-level `face` in new integrations.

This template uses deployment-wide tokens: a reader can read every device in that deployment. Add per-device credentials, tenant authorization, and workload-appropriate rate limits before operating a multi-user service. Browser CORS is disabled by default. Never embed a writer token in a public browser application.

## Further reading

- [Library reference](docs/library.md): custom catalogs, providers, hold timing, errors, cancellation, assets.
- [HTTP reference](docs/api.md): authentication, endpoints, polling, concurrency, compatibility.
- [Migration from 0.1](docs/migration.md).
- [Contributing and validation](CONTRIBUTING.md), [security reporting](SECURITY.md), [MIT license](LICENSE).
