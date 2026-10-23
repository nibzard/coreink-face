# Contributing

Use Node.js 24 (`nvm use`) and install the locked dependencies with `npm ci`.
For local API development, copy `.dev.vars.example` to `.dev.vars` and replace
the placeholder tokens. Never commit credentials or local runtime storage.

Before opening a pull request, run:

```sh
npm run check
npm run build
npm test
npm run test:runtime
npm run deploy:check
```

These checks run locally and do not deploy or require a TypeSafe key. The live
smoke script is separate: it updates a remote demo device and may call Jev.

Keep domain types and display policy independent of Cloudflare and model
providers. Add integrations through the `FaceChooser` port. Put use-case rules
in examples or the application composition root. Include a regression test
when changing classification, authentication, persistence, or display timing.

Describe the behavior change and relevant validation in the pull request.
Do not include API keys, tokens, private state, or credential files in examples,
issues, test fixtures, or logs.
