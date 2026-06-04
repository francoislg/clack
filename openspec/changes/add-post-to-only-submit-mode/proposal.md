## Why

Channelless cron runs are force-mapped to `submitResponseMode: "skipped"`, whose schema accepts only `{ skip_response: true }` and strips the entire `actions[]` field. But `post_to` — the only way a channelless run can deliver a message to a runtime-chosen channel — is an `actions[]` entry on `submit_response`, with no standalone tool. The result: a channelless run that relies on `post_to` (the casual-talk plugin) can **never** deliver. It rolls a hit, reads the channel, finds no reachable `post_to`, and skips every time. The casual-talk spec is internally contradictory today: it mandates both `submitResponseMode: "skipped"` and `post_to` delivery, which cannot coexist.

## What Changes

- Add a new `submitResponseMode` value, **`"optional-post-to"`** — the middleground between `"optional"` (full schema, may skip) and `"skipped"` (terminator only). The `optional-` prefix mirrors `"optional"` to signal skip is still allowed. Its schema exposes `skip_response` + `actions` (so `post_to` works) but omits all primary top-level delivery fields (`blocks`, `message`, `table`, `reactions`, `post_top_level`, `attention_level`). A run delivers by emitting a `post_to` action (which carries its own explicit channel) or terminates with `skip_response: true`.
- Channelless runs map to `"optional-post-to"` instead of `"skipped"`, so any channelless plugin can deliver via `post_to`. Plugins that deliver through their own tools (e.g. trivia) are unaffected — they simply ignore the now-available `actions` and still skip.
- The `submit_response` handler accepts "actions present, no primary, no skip" as a valid delivery (today it requires `blocks` unless skipping).
- casual-talk's cron spec sets `submitResponseMode: "optional-post-to"`, resolving its spec contradiction.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `submit-response-mode`: add the `"optional-post-to"` mode value and its schema variant; redefine the channelless mapping to use it instead of `"skipped"`.
- `casual-talk-plugin`: the cron spec declares `submitResponseMode: "optional-post-to"` (was `"skipped"`), removing the contradiction between the declared mode and the mandated `post_to` delivery.

## Impact

- **Code**: `src/tools/presentation/submitResponse.ts` (new schema variant + handler delivery path), `src/tools/server.ts` (channelless → `"optional-post-to"`), `src/config.ts` / cron-job validation (accept the new enum value), `src/plugins/casual-talk/index.ts` (spec sets the new mode).
- **Contract**: changes the documented channelless behavior in `submit-response-mode` — channelless `submit_response` now exposes `actions`/`post_to` rather than being terminator-only.
- **No breaking change** for existing channelless consumers (trivia): strictly more permissive — the actions field becomes available but is optional.
- **Tests**: `submitResponse.ts` schema/handler tests, `server.ts` channelless mapping test, casual-talk plugin spec test asserting the new mode.
