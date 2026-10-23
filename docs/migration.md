# From 0.1 to 0.2

The repository and package are now both named **coreink-face**. No npm registry release has been published. Git installs and packed tarballs use that import name.

The low-level `createFaceEngine`, `createRuleChooser`, `createJevChooser`, and `faces` exports remain available. For new work, use `createFace()` and its `render` method. It handles messages, explicit faces, defaults, validation, cancellation, and custom catalog ID inference.

```ts
// Before
const engine = createFaceEngine({ faces, chooser, fallbackFace: 'small-dots' });
const decision = await engine.decide(state);

// After
const companion = createFace({ chooser });
const frame = await companion.render({ state, message: 'Hello!' });
```

`frame.face` is the visible expression. Candidate, source, reason and confidence
are grouped under `frame.selection`. The message is always a string. Pass the
previous frame in `{previous}` to preserve text and apply hold timing locally.

The new HTTP endpoints `/v1/render` and `/v1/devices/:id/display` use this frame
shape. Existing `/decide`, `/state`, and `/face` routes preserve their response
shapes and share the same device storage. No data migration or credential
rotation is required.

Explicit face selection is now top-level `{face: 'hearts'}` and skips inference.
`state.expression` remains supported by the server's legacy rules chooser but
does not bypass Jev. Update examples to use `face` when a specific expression is
required.

HTTP errors retain their string `error` code and add request IDs, retry hints,
and field-level issues. Invalid input now uses `invalid_input` rather than
`invalid_state`. Canonical clients should recover using these codes, not error
message text. Provider failures still return an explained fallback unless a
local caller opts into `failureMode: 'throw'`.
