# HTTP API

Canonical routes return the same `FaceFrame` used by the local library. The API uses one Durable Object per device to coordinate state; model calls happen on writes, never reads. No tool execution is performed.

## Discovery

`GET /` lists routes and links to `GET /openapi.json` and `GET /llms.txt`. These and `GET /health` are public. The contract is generated from `src/openapi.ts` and included in the package; the Worker serves that same object.

| Method | Path | Token | Result |
| --- | --- | --- | --- |
| GET | `/v1/faces` | Reader or writer | `{faces: Face[]}` |
| POST | `/v1/render` | Writer | `FaceFrame`, not persisted |
| PUT | `/v1/devices/:id/display` | Writer | `DeviceDisplay`, persisted |
| GET | `/v1/devices/:id/display` | Reader or writer | `DeviceDisplay`, or 304 |
| POST | `/v1/devices/:id/messages` | Writer | Queue receipt, 202 |
| POST | `/v1/devices/:id/display/ack` | Reader or writer | Acknowledged, 204 |

Authenticate with `Authorization: Bearer <token>`. `API_TOKEN` is the writer; `DEVICE_TOKEN` is a deployment-wide reader. Device IDs contain 1–64 letters, digits, underscores, or hyphens. These tokens do not provide tenant isolation. CORS is disabled by default.

## Publish

```http
PUT /v1/devices/pebble/display
Authorization: Bearer <writer-token>
Content-Type: application/json

{"face":"hearts","message":"Have a lovely day!"}
```

Or send `{ "state": { "weather": "rainy" }, "message": "A quiet afternoon." }` for classification. The server's configured provider handles it. In `auto` mode a TypeSafe key enables Jev; without a key the rules adapter uses `state.expression` or neutral. Explicit `face` skips inference. `jev` mode without a key returns 503 for inferred inputs.

At least one input field is required. Unknown fields are rejected. Message length is at most 120 Unicode code points. Unpaired surrogates are rejected. Newline is allowed; other ASCII control characters are not. State is JSON with max depth 32. Request bodies are capped at 16 KB while streaming, including chunked requests. Omitted message preserves saved text; `""` clears it. Message-only updates can also infer a new face.

Direct writes return `409 queue_not_empty` while queued messages await acknowledgement.
This applies to both `/display` and the legacy `/state` route.

## Queued delivery

Submit a render input to `POST /v1/devices/:id/messages` to queue it.
A `202` response contains `{queued: true, id}`. At most 256 messages can wait.
Device-token polls promote messages in acceptance order. Writer-token reads inspect the display without advancing the queue.
After rendering a display with `requiresAck: true`, send `{revision}` to `/display/ack`.
A matching acknowledgement returns `204`; repeating it is safe until the revision changes.
A stale revision returns `409`. Poll again before acknowledging another revision.

## Poll

The display result adds `revision`, `nextPollSeconds`, and `requiresAck` to the frame. Render `face` and `message`; selection metadata is diagnostic. Skip a redraw only when both visible values are unchanged.

Save the response ETag and send it as `If-None-Match` on the next GET. A 304 has no body. Weak ETags and comma-separated validators are supported. A message-only update changes the revision. Acknowledgement changes the ETag without changing the revision. Do not parse ETags or infer revision values from them.

## Timing, persistence and retries

Face changes have a 15-second hold. The latest pending candidate is applied by a Durable Object alarm once the hold expires, without another model call. Messages update immediately and survive face alarms. Input state is not persisted; messages, decisions, pending faces, revisions and sequence numbers are. Application logs omit state and credentials. TypeSafe's data handling applies to state sent to Jev.

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
| 409 | Read after `superseded` or `stale_revision`. For `queue_not_empty`, wait for queued messages to be acknowledged. |
| 413 | Reduce input size. |
| 415 | Send `Content-Type: application/json`. |
| 500 | Record requestId; read the device before retrying a write. |
| 503 | Fix server provider configuration, or submit an explicit face. |

`retryable` is a diagnostic hint, never permission to blindly replay side effects.

## Existing integrations

`POST /v1/decide`, `PUT /v1/devices/:id/state`, and `GET /v1/devices/:id/face` remain available with their 0.1 shapes. Legacy reads return `{revision, decision, message, nextPollSeconds}`; legacy stateless decisions return decision fields plus message. These routes share the same stored device with canonical `/display`. New integrations should use canonical routes or the typed client.
