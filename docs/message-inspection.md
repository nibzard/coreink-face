# Inspect received messages

The API has no message-history endpoint. Operators can query its SQLite-backed Durable Objects directly through Cloudflare Data Studio or the read-only helper below. No deployment or new application endpoint is required for inspection.

## Command

Use Python 3.11+ and an existing Cloudflare credential with access to the Worker. The helper prefers `CLOUDFLARE_API_TOKEN`; otherwise it reads Wrangler's default OAuth configuration on macOS or Linux. `WRANGLER_CONFIG_PATH` can point to an alternate TOML credentials file. Credentials are never accepted as command-line arguments or printed. If OAuth expires, use `npx wrangler login`.

```sh
# Account IDs are shown by npx wrangler whoami.
export CLOUDFLARE_ACCOUNT_ID=your_account_id
npm run messages:list -- --list-objects
npm run messages:list -- --object your_64_character_object_id
npm run messages:list -- --object your_64_character_object_id --limit 20
```

The default Worker is `coreink-face-api`, class `Device`. Use `--worker` or `--namespace` for another deployment. Namespace discovery handles pages; object listing returns Cloudflare's pagination metadata, and `--cursor` requests the next object page. Listing objects only retrieves identifiers and storage presence, not their messages. Object names are not returned by Cloudflare's list endpoint: select the intended object ID using Data Studio's device-name lookup, or inspect known IDs. Do not assume the first object is `pebble`.

The helper outputs full JSON with exact message text, newest queue ID first, and up to 320 rows (256 pending plus 64 delivered). JSON escapes embedded newlines; it does not truncate messages. An ellipsis inside a message is stored text. The display's two-line truncation is separate from message storage. Output includes private message and sender data; keep exports out of source control and public logs.

## Working direct-query protocol

The verified endpoint is `POST /accounts/{account}/workers/durable_objects/namespaces/{namespace}/query` on `https://api.cloudflare.com/client/v4`, using Cloudflare bearer authentication. Its body contains `durable_object_id` and `queries: [{ sql, params: [] }]`. The `durable_object_name` variant returned HTTP 400 in this installation. Do not replace `durable_objects` with a hyphenated path. This Data Studio endpoint is not a stable public application contract; the helper fails explicitly if Cloudflare changes it.

The helper only issues namespace/object GETs, `PRAGMA table_info(messages)`, and a fixed `SELECT`. It cannot enqueue, acknowledge, delete, or run user-provided SQL. It supports both the old and new schemas, emitting null for missing timestamp/metadata columns. Data Studio is the fallback: choose the namespace, enter the device name or object ID, and run:

```sql
SELECT id, message, delivered, received_at, delivered_at, sender, decision
FROM messages ORDER BY id DESC LIMIT 320;
```

For an older database without the new columns, select only `id, message, delivered, decision`.

## Timestamp and status semantics

- `received_at`: UTC time the authenticated enqueue request entered the device API handler, before validation/classification. It is stored only when enqueue succeeds. This is not the browser send time or queue acceptance order.
- `delivered_at`: UTC time the API accepted the matching device render acknowledgement. Repeated acknowledgements preserve it. It does not prove a human read the display.
- `delivered`: the existing acknowledgement flag. Old delivered rows may have a null `delivered_at`.
- `decision.decidedAt`: classification time, not receipt or delivery time. Never substitute it for missing timestamps.
- Queue IDs reflect insertion/acceptance order; concurrent classification can finish in a different order from receipt.

Existing rows keep null timestamps and sender metadata after migration. This information cannot be reconstructed retrospectively. Direct `PUT /display` updates are not inserted into the queue archive.

## Sender metadata

The public inbox computes metadata on the server for sends, then forwards an `X-Pebble-Sender` JSON header using its writer credential. Browser-supplied copies of this header are ignored and overwritten. The device API accepts this header only on authenticated enqueue requests, validates its bounded schema, and stores it separately from model input and display data. Other writer integrations may omit it. Any authorized writer can supply metadata, so it is informational, not independently verified identity.

Fields: `source` (`pebble-inbox`), `fingerprint` (64 lowercase hex characters or null), `fingerprintDay` (UTC date or null), `country` (two-letter country or null), `asn` (network number or null), `browser` (Chrome/Firefox/Safari/Edge/Other), and `device` (mobile/tablet/desktop/unknown).

The identifier uses HMAC-SHA-256 over a version marker, device ID, UTC day, edge-provided IP address, and the first 512 user-agent characters. Configure a dedicated random `PEBBLE_SENDER_HASH_KEY` secret of at least 32 characters on the **public inbox Worker**, never in browser code or the core API. Without a valid key or edge IP, or when `Sec-GPC: 1` is present, fingerprint fields are null and sends still work. Changing the key changes identifiers. The day in the hash input prevents direct matching across days, but a retained key can recompute candidate hashes; this is pseudonymous data, not anonymization.

Country and ASN come from Cloudflare request metadata. Browser and device categories are coarse guesses from the client-controlled user agent. Shared networks, VPNs, and identical browsers can share an identifier; a sender can change it by changing network/browser. It must not be treated as a person ID or sole basis for blocking. No raw IP, full user agent, referrer URL, precise location, cookies, or active browser fingerprint are stored. Metadata is absent from preview requests to the classifier, all device response shapes, and public send responses.

Messages and their metadata share retention: up to 256 waiting items and the latest 64 acknowledged items. Pending items can remain indefinitely while offline. This is a count-based archive, not a complete or time-based audit log. Pruning deletes each message and its metadata together. Clearing browser history affects only local storage.

## Rollout

Deploy the core API first so it validates and stores the new metadata header. Its constructor adds nullable columns without rewriting old data. Then deploy the public inbox source with the visible privacy notice and `/privacy` page; configure `PEBBLE_SENDER_HASH_KEY` in that site's server secrets to enable daily grouping. Without that secret, coarse metadata is still captured, and grouping stays disabled. The local source change alone does not update the hosted Site.

Verification: `npm run check`, `npm test`, `npm run test:messages`, `npm run test:runtime`, and `npm test --prefix web/pebble`. The storage harness seeds the legacy schema and checks migration, exact message text, authorization, metadata isolation, acknowledgement timestamps, restart persistence, and pruning.

Cloudflare references: [Data Studio](https://developers.cloudflare.com/durable-objects/observability/data-studio/), [request metadata](https://developers.cloudflare.com/workers/runtime-apis/request/), [Web Crypto](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/).
