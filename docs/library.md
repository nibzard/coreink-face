# Library reference

## Entry points

| Import | Exports |
| --- | --- |
| `coreink-face` | `createFace`, `createRuleChooser`, `faces`, `FaceError`, `parseInput`, limits, domain types; lower-level engine helpers |
| `coreink-face/jev` | `createJevChooser`, `JevOptions` |
| `coreink-face/client` | `createClient`, `FaceApiError`, client and polling types |
| `coreink-face/catalog` | Included `faces` and `FaceId` union |
| `coreink-face/assets/<id>.svg` | SVG artwork for bundlers or file consumers |
| `coreink-face/openapi.json` | OpenAPI contract |
| `coreink-face/llms.txt` | Agent-oriented quick reference and recovery guidance |

ESM only. Local core operations need standard JavaScript and TextEncoder. Network adapters use fetch, AbortController, and AbortSignal.any/timeout; use a current browser, Node.js 22.12+, or Cloudflare Workers. Development and Git installation use Node.js 24 in CI. No Cloudflare imports or runtime dependencies are part of the library.

## createFace(options?)

| Option | Default | Meaning |
| --- | --- | --- |
| `faces` | Included 35-face catalog | Readonly `{id, name, description}` array |
| `fallbackFace` | `small-dots`, or first custom face | Neutral face when no previous face is available |
| `chooser` | Neutral chooser | Implements `FaceChooser` |
| `minimumHoldMs` | `15000` | Minimum interval between face changes |
| `minimumConfidence` | `0.4` | Below this, retain previous face or fallback |
| `failureMode` | `fallback` | Use `throw` to propagate provider errors |
| `now` | Current time | Injectable clock for deterministic behavior |

No hidden state, timers, environment lookup, storage, or network calls are created by the factory. All state is explicit. Catalog entries are copied and frozen. IDs are 1–64 letters, numbers, underscores, or hyphens. Duplicate IDs and a missing fallback are configuration errors.

```ts
const face = createFace({
  faces: [
    { id: 'wave', name: 'Wave', description: 'A friendly greeting' },
    { id: 'rest', name: 'Rest', description: 'Quiet presence' },
  ],
  fallbackFace: 'rest',
});
await face.render({ face: 'wave' });
// TypeScript rejects face.render({ face: 'hearts' }) for this catalog.
```

## render(input, options?)

The input is the shared `{face?, message?, state?}` contract. Explicit `face` always skips classification, even when a chooser is configured. It still respects hold timing. A message is never inferred from `state`; provide top-level `message` for visible text. Explicit message is also passed to the chooser as `state.message`, replacing that key in the supplied state for that call.

```ts
const previous = await face.render({ face: 'wave', message: 'Hello!' });
const next = await face.render({ face: 'rest' }, { previous });
```

Omitted text is preserved from `previous`. With no previous frame it becomes `""`. `changedAt` records the last FACE change; `decidedAt` records classification completion. A message can change while the face is held.

The library does not schedule a pending change. On `minimum-hold`, wait until `Date.parse(frame.changedAt) + minimumHoldMs`, then render again using the prior frame. The Cloudflare API handles this scheduling with alarms.

## Classification and errors

Implement a chooser without extending a base class:

```ts
const chooser = {
  name: 'my-provider',
  async choose(state, catalog, { signal } = {}) {
    // Return one of catalog's IDs; propagate signal to any network operation.
    return { face: 'curious', confidence: 0.9 };
  },
};
```

The engine validates the selected ID and confidence. A provider failure, invalid output, or timeout defaults to `selection.reason: "provider-unavailable"`, keeping the prior valid face. Low confidence returns `low-confidence`. Deterministic rules omit confidence. A confidence threshold is application policy, not a correctness guarantee.

For strict callers, set `failureMode: 'throw'`. `FaceError` carries `code`, `message`, `issues`, and `retryable`. Input/configuration mistakes always throw. Cancellation always rejects, including when fallback mode is enabled:

```ts
const controller = new AbortController();
await face.render({ state: {} }, { signal: controller.signal });
```

Important codes: `invalid_input`, `input_too_large`, `unknown_face`, `invalid_configuration`, `invalid_selection`, `provider_unavailable`, `provider_http_error`, `invalid_provider_response`. `issues` contains JSON-pointer paths and correction messages. Do not log provider causes indiscriminately: an arbitrary custom provider may include private data in its error.

## Jev

`createJevChooser({ apiKey, model?, instructions?, timeoutMs?, fetch? })` uses TypeSafe's typed Choice endpoint. Defaults: `jev-latest`, 5000 ms timeout. Responses are bounded to 64 KB. Up to 255 catalog entries are supported. Provide a custom `fetch` for tests or instrumentation. Keys are explicit; this adapter never reads environment variables. Request cancellation propagates to fetch. No automatic retries.

## HTTP client

`createClient({baseUrl, token, timeoutMs?, fetch?})` defaults to a 10-second timeout. No credentials are discovered automatically. It validates request and response shapes and rejects credential-bearing URLs and redirects. Every method accepts an optional `signal`.

- `api.faces()` → catalog.
- `api.render(input)` → `FaceFrame`.
- `api.device(id).update(input)` → `DeviceDisplay`.
- `api.device(id).read({etag?, signal?})` → a discriminated `modified` / `not-modified` result.

Keep ETags opaque, including `W/` prefixes. A `modified` result has `display` and `etag`; `not-modified` has only `etag`. Use `nextPollSeconds` as a hint and apply your own battery budget.

`FaceApiError` adds `status` and `requestId` to `FaceError`. Transport errors use `network_error` or `timeout`; malformed success responses use `invalid_response`. The client never automatically retries writes. A timed-out write can still complete on the server; read before deciding whether to submit again.

## Artwork and physical displays

SVGs use a 200 × 200 viewBox with transparent backgrounds. A full 1-bit 200 × 200 bitmap takes 5000 bytes. Keep artwork on the device and send only IDs over the network. You can use these IDs with completely different artwork.

The API and library return content, not a layout. For CoreInk, start with a 140 × 140 face region and a message region underneath. Wrap by pixel width, use a supported font, and ellipsize overflow. Unicode validation does not imply hardware font support. Render text as plain text (`textContent` in a browser), never HTML. Firmware should enforce refresh timing for the entire screen, including message-only changes.
