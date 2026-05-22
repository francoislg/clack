## Context

Clack sends Slack messages from many call sites. `postStructuredMessage` (`src/slack/messagePoster.ts`) is a partial front door for structured (block-bearing) messages routed from `submit_response` and plugin `post_to` actions, but a number of paths still call `client.chat.postMessage(...)` directly: streaming fallback, DM helpers (`sendDirectMessage`, `sendErrorReport`), worker `reportStatus`, scheduler DMs, quarantine notifier, plugin SDK's exposed `postMessage`, trivia `postQuestions`, migration admin DM.

Slack's `chat.postMessage` exposes `unfurl_links` (text URLs) and `unfurl_media` (image/video URLs). Both default to `true`. There is no current way to disable them from anywhere in Clack — callers inherit Slack defaults.

Stakeholders: Claude (decides per-response when its content shouldn't trigger previews), plugin authors (e.g., trivia poster including research URLs), Clack maintainers (consistent send semantics across paths).

## Goals / Non-Goals

**Goals:**
- A single boolean opt-in (`suppressUnfurls`) understood by every Clack outgoing-message path.
- When set, both `unfurl_links: false` and `unfurl_media: false` are forwarded to `chat.postMessage`. When absent / false, the payload is sent unchanged (Slack default preserved).
- Exposure to Claude on `submit_response` and `post_to` action schemas as `suppress_unfurls?: boolean`.
- Exposure to plugin authors via the plugin SDK posting helper.
- No regression in current behavior for any call site that doesn't opt in.

**Non-Goals:**
- Independent control of `unfurl_links` vs `unfurl_media`. A single combined knob covers the realistic use cases; if a future need splits them, it can be additive.
- Per-block or per-URL unfurl control. Slack's API is message-level.
- A global default-off mode. Default-on matches Slack's default and avoids broad regressions (e.g., useful PR-link previews in worker `reportStatus`).
- Migrating the streamer's intermediate `chat.update` calls. Unfurl semantics on updates are sticky to the initial post — only the final/fallback `chat.postMessage` needs the knob.

## Decisions

### One combined knob, not two separate ones
Slack splits `unfurl_links` and `unfurl_media`, but Clack's realistic opt-out cases want both off together (cancel the preview entirely). A single `suppressUnfurls: boolean` is simpler to expose to Claude and to plugin authors. Internally it translates to setting both Slack params to `false`.

Alternative considered: expose both flags. Rejected because (a) no current caller wants asymmetric behavior, (b) adding two boolean fields to `submit_response` doubles the schema noise for the same outcome. Additive split remains possible later if a real case appears.

### Opt-in suppression, not opt-out unfurling
Default behavior remains "Slack unfurls." Callers must explicitly request suppression. Rejected alternative (default-off): too disruptive — some Clack messages (worker status pings linking to PRs, scheduler messages linking to dashboards) actively benefit from previews. Defaulting off would silently degrade those messages.

### Single shared option-shaping helper, not a wrapper class
Introduce a small pure helper, e.g. `applyUnfurlOptions(args, suppressUnfurls)` that returns `args` with the two Slack fields spread in when suppression is requested. Every call site spreads the helper's output into its `chat.postMessage` call. This keeps call sites readable, avoids forcing every caller through a thick `postMessage` wrapper, and lets the existing `postStructuredMessage` keep its richer contract (returns `ts` + permalink).

Alternative considered: one true `clackPostMessage(client, opts)` wrapper that all paths must use. Rejected for now — too many call sites with too-divergent shapes (some need ts, some need permalink, some need scheduledMessage handling). The helper pattern lets each path keep its own primitive but share the unfurl logic.

### Where the flag is captured for `submit_response`
The flag travels from the schema (`suppress_unfurls`) into the existing `deliver` callback that the submit_response tool calls. `deliver` already accepts a structured payload (`blocks`, optional `reactions`, optional `postTopLevel`); we add an optional `suppressUnfurls` to that shape and forward it into `postStructuredMessage`. The delivery context implementations (DM-first, in-thread, top-level) all funnel through `postStructuredMessage` so a single plumbing change covers them.

### Where the flag is captured for `post_to`
Each `post_to` action gets its own `suppress_unfurls?: boolean`. The cross-post handler (when `auto: true`) and the deferred handler (button-click path that replays a persisted `ResponseSnapshot`) both read the action's flag and forward it. The snapshot type gains `suppressUnfurls?: boolean` so deferred replays preserve the original intent.

### Naming
- **Schema fields exposed to Claude**: snake_case `suppress_unfurls` (matches existing convention — `skip_response`, `post_top_level`).
- **TypeScript option / SDK option**: camelCase `suppressUnfurls`.

### Testing approach
Each helper and migrated call site gets a test that verifies:
1. Absence → no `unfurl_*` field in the postMessage args.
2. `suppressUnfurls: true` → both `unfurl_links: false` and `unfurl_media: false` present in the postMessage args.

`submit_response` and `post_to` get integration tests confirming the schema field flows through the deliver callback to `postStructuredMessage`.

## Risks / Trade-offs

- **[Drift risk]** New send paths added later may forget to thread the option through → mitigation: doc the helper in `src/slack/messagePoster.ts` and reference it from a top-level comment in `src/slack/messagesApi.ts`. Optional: a code-review checklist item.
- **[Schema bloat]** Adding `suppress_unfurls` to `submit_response` increases the model-facing schema surface. Mitigation: keep the description short and only mention it where relevant. The field is optional and most calls will omit it.
- **[Plugin SDK breakage]** Adding a new option to the plugin posting helper is non-breaking (optional), but plugins authored against an older shape need no changes.
- **[Inconsistent defaults across paths]** The proposal keeps default = Slack default everywhere. Some teams may later want a specific call site (e.g., trivia question post) to default to suppressed. That's a future per-site decision and can be set at the call site without touching the helper.

## Migration Plan

1. Land the shared helper and primitive change in `postStructuredMessage`.
2. Migrate all direct `chat.postMessage` call sites to use the helper (no behavior change since default is off).
3. Add the `suppress_unfurls` schema field to `submit_response` and `post_to`. Wire it through the delivery callback.
4. Add the option to the plugin SDK helper.
5. Document in `submit_response`'s tool description and the plugin SDK reference.

No data migration. No rollback needed beyond a code revert — the change is purely additive.

## Open Questions

- Should the field eventually accept the two-flag shape (`{ links?: boolean; media?: boolean }`) for forward-compat? Decision deferred until a real asymmetric case appears.
- Should specific tools (e.g., trivia `postQuestions`) default to `suppressUnfurls: true`? Left as a follow-up call per-site after the plumbing lands.
