# Changelog

## 0.2.0

- Add `createFace().render()` with shared face/message input and sensible defaults.
- Explicit face selection bypasses inference; custom catalogs infer their IDs in TypeScript.
- Add typed errors, shared input validation, cancellation, and opt-in strict provider errors.
- Add a Fetch-based HTTP client with conditional polling and no automatic write retries.
- Add canonical `/v1/render` and device `/display` routes; retain legacy response shapes.
- Serve OpenAPI and agent guidance at `/openapi.json` and `/llms.txt`.
- Ship an installable `coreink-face` package with zero runtime dependencies and tested exports.
- Add isolated package-consumer tests and public schema contract checks.

## 0.1.0

- Initial modular face engine, rules and Jev adapters, 35-face catalog, and Cloudflare API.
- Durable device state, delayed face changes, display messages, and ETag polling.
