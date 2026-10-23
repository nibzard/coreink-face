# Pebble public inbox

Production: https://pebble-little-moments.niko370669.chatgpt.site

A mobile-first Cloudflare Worker composer. Anyone can send a message to Nikola’s CoreInk. Jev selects the expression. The preview shares the firmware bitmap font, wrapping, centering and face assets and shows only the visitor’s draft/submission. API acceptance is distinct from physical delivery; the device polls about once per minute and keeps its last screen offline.

A single atomic D1 row enforces one send per minute globally, including failed upstream attempts. No messages or IP addresses are stored in this database. There is no public history or clearing endpoint. API credentials stay in Worker secrets. Messages replace the current display; this is intentionally not a queue or private messaging service.

`npm test` checks validation, privacy, concurrent admission, errors and exact preview pixel parity with the native renderer when built. `npm run dev` serves localhost:8807 using the existing ignored root secret file. Node SQLite is a local test adapter; production uses D1. Generate schema migrations with `npm run db:generate`; deployment includes `drizzle/`.

Source is also preserved in `web/pebble` in the main repository. Never copy Git metadata, runtime data, secrets or Site identity between projects.
