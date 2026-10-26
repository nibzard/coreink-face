# HTTP API

Canonical routes return the same `FaceFrame` used by the local library. The API uses one Durable Object per device to coordinate state; model calls happen on writes, never reads. No tool execution is performed.

## Discovery

`GET /` lists routes and links to `GET /openapi.json` and `GET /llms.txt`. These and `GET /health` are public. The contract is generated from `src/openapi.ts` and included in the package; the Worker serves that same object.

| Method | Path | Token | Result |
| --- | --- | --- | --- |
| GET | `/v1/faces` | Reader or writer | `{faces: Face[]}` |
| POST | `/v1/render` | Writer | `FaceFrame`, not persisted |
| POST | `/v1/devices/:id/messages` | Writer | `{queued: true, id}`, 202 after durable enqueue |
| POST | `/v1/devices/:id/display/ack` | Reader or writer | 204 for a matching revision; 409 if stale |
| PUT | `/v1/devices/:id/display` | Writer | `DeviceDisplay`, persisted |
| GET | `/v1/devices/:id/display` | Reader or writer | `DeviceDisplay`, or 304 |

Authenticate with `Authorization: Bearer <token>`. `API_TOKEN` is the writer; `DEVICE_TOKEN` is a deployment-wide device reader that can also acknowledge rendered messages. Device IDs contain 1–64 letters, digits, underscores, or hyphens. These tokens do not provide tenant isolation. CORS is disabled by default.

## Queue messages

`POST /v1/devices/:id/messages` accepts the same input as rendering, classifies once, and saves a FIFO item. A 202 response confirms durable queuing, not display delivery. FIFO order is successful insertion order, which can differ from request arrival order while classification is in flight. Omitted message becomes empty text for a new queue item. At most 256 unacknowledged messages may wait; a full inbox returns 503 `inbox_full`. Requests are not deduplicated, so do not blindly retry after a timeout.

The public inbox has no shared cooldown. Device-token display polls promote the next queued item once the previous item is acknowledged. After rendering (or verifying identical pixels), send `{"revision":123}` to `POST /v1/devices/:id/display/ack` when `requiresAck` is true. The current matching acknowledgement is idempotent; a stale revision returns 409. Writer-token display reads inspect the current frame without advancing the queue. Legacy `/face` reads also do not advance it.

Queued rows store receipt time, acknowledgement time, and optional bounded sender metadata. Existing rows retain null values for previously unrecorded information. `X-Pebble-Sender` is an optional JSON header supplied by authenticated writers; malformed metadata returns 400 `invalid_sender`. It contains only the fields described in the [inspection guide](message-inspection.md#sender-metadata), never arbitrary request headers. These details are excluded from classifier input and public/device responses. Sender claims are informational, not authenticated user identities.

The server retains the latest 64 acknowledged messages plus pending items. There is no application history endpoint; use the [read-only database inspection helper](message-inspection.md). Direct PUT updates below do not create archive entries.

## Publish

```http
PUT /v1/devices/pebble/display
Authorization: Bearer <writer-token>
Content-Type: application/json

{"face":"hearts","message":"Have a lovely day!"}
```

Or send `{ "state": { "weather": "rainy" }, "message": "A quiet afternoon." }` for classification. The server's configured provider handles it. In `auto` mode a TypeSafe key enables Jev; without a key the rules adapter uses `state.expression` or neutral. Explicit `face` skips inference. `jev` mode without a key returns 503 for inferred inputs.

At least one input field is required. Unknown fields are rejected. Message length is at most 120 Unicode code points. Newline is allowed; other ASCII control characters are not. State is JSON with max depth 32. Request bodies are capped at 16 KB while streaming, including chunked requests. Omitted message preserves saved text; `""` clears it. Message-only updates can also infer a new face.

## Poll

The display result adds `revision`, `nextPollSeconds`, and `requiresAck` to the frame. Render `face` and `message`; selection metadata is diagnostic. Skip a redraw only when both visible values are unchanged, but acknowledge a queued revision after verifying those pixels.

Save the response ETag and send it as `If-None-Match` on the next GET. A 304 has no body. Weak ETags and comma-separated validators are supported. A message-only update changes the revision. Do not parse ETags or infer revision values from them.

## Timing, persistence and retries

Face changes have a 15-second hold. The latest pending candidate is applied by a Durable Object alarm once the hold expires, without another model call. Direct PUT messages update immediately and survive face alarms; queued text waits for promotion. Input state is not persisted; messages, decisions, pending faces, revisions, sequence numbers, and queued-message timestamps/metadata are. Application logs omit state and credentials. TypeSafe's data handling applies to state sent to Jev.

A later-arriving request supersedes an earlier in-flight classification; the older write returns 409 and cannot overwrite the newer result. PUT is a publish operation, not an idempotency promise: replaying it can call the model again and advance the revision. There is no automatic retry/deduplication. A timeout does not imply failure; GET the device before replaying a write.

Provider failures and invalid results default to a valid retained/neutral face with `selection.reason: "provider-unavailable"`. Low confidence retains the previous face with `low-confidence`. Both are successful display responses with explicitly degraded classification. The service does not silently claim the model succeeded.

## Errors

```json
{
  "error": "unknown_face",
  "message": "Choose an ID from GET /v1/faces.",
  "issues": [{"path":"/face","message":"Unknown face ID."}],
  "requestId": "...",
  "retryable": false
}
```

| Status | Recovery |
| --- | --- |
| 400 | Fix invalid fields using `issues`; fetch catalog for `unknown_face`. |
| 401 | Supply the correct token; read-only tokens cannot publish. |
| 404 | Check route/ID; initialize a missing device with PUT. |
| 405 | Use the method in the Allow header. |
| 409 | A newer write won; read the current display. |
| 413 | Reduce input size. |
| 415 | Send `Content-Type: application/json`. |
| 500 | Record requestId; read the device before retrying a write. |
| 503 | Fix server provider configuration, or submit an explicit face. |

`retryable` is a diagnostic hint, never permission to blindly replay side effects.

## Existing integrations

`POST /v1/decide`, `PUT /v1/devices/:id/state`, and `GET /v1/devices/:id/face` remain available with their 0.1 shapes. Legacy reads return `{revision, decision, message, nextPollSeconds}`; legacy stateless decisions return decision fields plus message. These routes share the same stored device with canonical `/display`. New integrations should use canonical routes or the typed client.
