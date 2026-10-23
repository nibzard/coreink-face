/** Distributed with the library and served by the Worker without authentication. */
export const agentGuide = `# CoreInk Face

A JavaScript/TypeScript library and HTTP API for face + message display content.
Source: https://github.com/nibzard/coreink-face
Contract: /openapi.json (OpenAPI 3.1)

## Local use
import { createFace } from 'coreink-face';
const renderer = createFace();
const frame = await renderer.render({ face: 'hearts', message: 'Hello!' });
Explicit face selection makes no network call. Without a chooser, state-only
or message-only input selects the neutral face. To infer expression, pass
chooser: createJevChooser({ apiKey }) imported from 'coreink-face/jev'.

## HTTP client
import { createClient } from 'coreink-face/client';
const api = createClient({ baseUrl, token });
await api.device('pebble').update({ face: 'hearts', message: 'Hello!' });
const result = await api.device('pebble').read();
if (result.status === 'modified') render(result.display.face, result.display.message);
Store result.etag and pass read({ etag }) for conditional polling.

## HTTP operations
GET /v1/faces: discover IDs and descriptions (reader or writer token).
POST /v1/render: stateless frame (writer token).
PUT /v1/devices/{id}/display: choose and store a frame (writer token).
GET /v1/devices/{id}/display: read without inference (reader or writer token).
Authenticate with Authorization: Bearer <token>. Never expose writer/provider keys in a public browser.

## Input
An object with any of: face, message, state. At least one is required.
face: exact catalog ID; bypasses classification and still respects hold timing.
message: exact plain text, max 120 Unicode code points; newline allowed.
Omit message to preserve it on device updates; empty string clears it.
state: arbitrary JSON object. No cycles, nonfinite numbers, or depth >32.
Total encoded input <=16384 bytes. Device IDs: [a-zA-Z0-9_-]{1,64}.
Unknown fields are errors. Never put a display message only inside state.

## Output and policy
Render frame.face and frame.message. selection.candidate is diagnostic, not the face to render.
selection.reason explains selected, unchanged, minimum-hold, low-confidence, or provider-unavailable.
changedAt tracks FACE changes, not message changes. Message updates also advance device revision.
A 15s minimum face hold prevents flickering. Device alarms apply the latest pending candidate.
Local library callers own timers and persistence. Retain the returned frame as previous and re-render after the hold.
Default provider errors return the prior face (or neutral); failureMode: 'throw' opts into exceptions locally.
Cancellation always rejects. The HTTP client does not automatically retry writes.

## Recovery
400 invalid_input / unknown_face: correct error.issues or fetch the catalog; do not retry unchanged.
401 unauthorized: use the correct token; reader tokens cannot write.
404 device_not_initialized: perform an initial PUT.
405 method_not_allowed: use the method in the Allow header.
409 superseded: a newer update won; read current state rather than replaying stale input.
413 input_too_large / body_too_large: reduce input.
415 expected_application_json: set Content-Type: application/json.
503 provider_not_configured: configure TypeSafe or send an explicit face.
After timeout/network failure, read the device first: a write may already have completed.

## Compatibility
Legacy /v1/decide, /v1/devices/{id}/state and /face remain supported.
Their response shapes differ; use the canonical endpoints above for new clients.
No arbitrary work is executed. No firmware is flashed. The device must render the returned content.
`;
