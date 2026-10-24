# Pebble public inbox

Production: https://pebble-little-moments.niko370669.chatgpt.site

A mobile-first Cloudflare Worker composer: write, send, and immediately send another message. The live preview shows your draft with the device’s font and two-line layout. After a short typing pause, Jev selects the draft’s expression through `POST /api/preview`; sending preserves that exact expression. There is no cooldown, countdown, or public history. The latest 20 successful sends are saved in this browser’s local storage and shown below the form, with full text, expression, and send time. The list survives reloads, can be cleared locally, and is never read from or uploaded to a shared history endpoint. Other browsers have separate lists; there is no account-based synchronization. Success clears the form and briefly confirms “Sent.” Credentials stay in Worker secrets.

`POST /api/moments` validates a message and optional catalog face and forwards it to `POST /v1/devices/pebble/messages` with the server writer token. A 202 confirms durable queuing. The selected preview face is sent explicitly, so enqueueing does not reclassify it. Clients that omit a face receive the same classification step before enqueueing. Preview requests never enqueue messages or read the device display. The API’s device Durable Object owns FIFO delivery, acknowledgement, and a bounded delivered archive. Messages wait while the device is offline or browsing older messages; a completed render must be acknowledged before the next item advances. Up to 256 pending messages are accepted; capacity errors retain the visitor’s draft.

The CoreInk wheel browses its latest 64 messages stored offline. Up is older, down is newer, and center resumes incoming messages. The public page does not reveal these messages.

`npm test` covers concurrent immediate sends, validation, privacy, upstream failures, workerd execution, message-based previews, race handling, per-browser history isolation and persistence, and native rendering parity for the bitmap renderer. `npm run dev` serves localhost:8807 using the existing ignored root secrets file. The old D1 cooldown migration remains as deployment history; the composer no longer reads or writes it.

Source is mirrored in `web/pebble`. Do not copy credentials or runtime data into source.
