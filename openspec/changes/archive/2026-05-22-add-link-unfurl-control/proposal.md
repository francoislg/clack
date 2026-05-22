## Why

Clack messages often contain URLs (PR links, JIRA tickets, source URLs for topical trivia questions, links the user shared) where Slack's default link/media unfurling produces noisy previews the message author didn't want. Slack supports `unfurl_links: false` and `unfurl_media: false` on `chat.postMessage`, but Clack currently has no way to opt-in to that suppression: every send path calls `chat.postMessage` directly and inherits Slack's default unfurling.

## What Changes

- Introduce a single Clack-side opt-in to suppress link/media unfurling on outgoing Slack messages. Default behavior is unchanged — Slack continues to unfurl as usual unless the caller explicitly requests suppression.
- Add a shared boolean option (`suppressUnfurls`) on Clack's message-posting helpers that, when `true`, sets both `unfurl_links: false` and `unfurl_media: false` on the underlying `chat.postMessage` call.
- Plumb the option through every Clack code path that posts a Slack message, including (non-exhaustive): `postStructuredMessage` (the structured-message front door), DM helpers (`sendDirectMessage`, `sendErrorReport`), worker `reportStatus`, scheduler DMs, quarantine notifier, the plugin SDK's exposed `postMessage`, the streamer's final-post fallback, and migration admin DMs.
- Expose the opt-in to Claude on the `submit_response` tool as a `suppress_unfurls` boolean. Same field added to each `post_to` action so cross-posted messages can independently opt in.
- Expose the opt-in to plugin authors via the plugin SDK's posting helper.

## Capabilities

### New Capabilities
- `link-unfurl-control`: Cross-cutting contract that Clack's outgoing-message paths accept an opt-in suppress-unfurls flag and forward it to Slack's `unfurl_links` / `unfurl_media` parameters; defines the surface tools and helpers that expose the opt-in to callers and to Claude.

### Modified Capabilities
- `clack-tool-response`: `submit_response` and the `post_to` action gain an optional `suppress_unfurls: boolean` field (default `false` / absent → Slack default unfurling).
- `clack-plugins`: The plugin SDK's outgoing-message helper gains an optional `suppressUnfurls` option.

## Impact

- **Code**: `src/slack/messagePoster.ts` (front door), `src/slack/messagesApi.ts` (DM helpers), `src/streaming/slackStreamer.ts` (fallback post), `src/cronScheduler.ts`, `src/workers/quarantineNotifier.ts`, `src/tools/worker/reportStatus.ts`, `src/plugins/sdk.ts`, `src/plugins/trivia/tools/questions/postQuestions.ts`, `src/migrations/admin.ts`, `src/tools/presentation/submitResponse.ts` (schema), `src/slack/blocks.ts` and delivery wiring (carries the flag from `submit_response` to delivery).
- **APIs**: One new optional field on `submit_response` and on `post_to` action schemas. One new optional option on the plugin SDK posting helper. No breaking changes — every new parameter is optional and absent → current behavior.
- **Tests**: Each migrated call site needs coverage that confirms the flag flows through to `chat.postMessage`.
- **Docs**: Brief note in the `submit_response` tool description and plugin SDK reference; no user-facing config changes.
