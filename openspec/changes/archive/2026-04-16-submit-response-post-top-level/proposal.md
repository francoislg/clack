## Why

Auto-respond rules today tell Claude "post directly to the channel instead of in a thread" via free-text `extraContext`. Claude is expected to translate that into a `post_to` action with `auto: true`. Two problems:

1. **Duplication risk:** `submit_response` itself always delivers to the thread. If Claude adds a `post_to` alongside, the answer lands twice — once in the thread, once at channel top-level.
2. **LLM interpretation fragility:** natural-language delivery instructions are easy for Claude to miss, as we've already seen with disengage.

The fix is to give Claude a structured flag on `submit_response` that routes the *primary* delivery to the channel top-level. The existing `topLevelDeliveryChannel` duplication guard then activates automatically for the session's channel, making double-posting structurally impossible.

## What Changes

- Add a `post_top_level: boolean` field to the `submit_response` tool schema. When `true`, the tool delivers the response as a top-level channel message (no `thread_ts`) and deletes the in-thread thinking indicator.
- Add `allowPostTopLevel` to `SubmitResponseDeps` so the flag appears in the schema only for trigger types where channel top-level delivery makes sense: `autoRespond`, `threadReply`, `mentions`, `reactions`.
- Add a `sessionChannelId` dep that lets `submit_response` compute an effective top-level delivery channel per-call (combining the pre-existing `topLevelDeliveryChannel` for scheduled with the new per-response flag).
- Extend `DeliverFn` with an optional `postTopLevel` flag and update `buildDeliverFn` in `handlerResponse.ts` to handle it (delete streamer message, post to channel without `thread_ts`).
- After a successful top-level post, create a follow-up session tied to the new thread so replies route to their own conversational context (own disengage state, own pre-analysis, own history) rather than sharing the parent session.
- Update auto-respond prompt guidance: replace "use `post_to` with `auto: true` for top-level posts" with "set `post_top_level: true`", and reserve `post_to` strictly for cross-channel broadcasts.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `clack-tool-response`: `submit_response` gains a `post_top_level` flag and an `allowPostTopLevel` dep. The `topLevelDeliveryChannel` duplication guard is extended to fire dynamically when `post_top_level: true` targets the session's channel.
- `auto-respond`: the admin-facing guidance for "post directly to the channel" becomes "set `post_top_level: true` on your response" instead of "use `post_to` with `auto: true`". The duplication hazard is eliminated at the schema layer.

## Impact

- Code: `src/tools/types.ts` (DeliverFn adds `postTopLevel`), `src/tools/presentation/submitResponse.ts` (new schema field + routing), `src/tools/server.ts` (per-trigger gating + session channel plumbing), `src/slack/handlers/handlerResponse.ts` (deliver fn branches on `postTopLevel`), `src/claude/promptBuilder.ts` (guidance rewrite).
- Tests: `src/tools/presentation/submitResponse.test.ts` (new schema variant + delivery behavior), `src/tools/server.test.ts` (new `shouldAllowPostTopLevel` gating helper).
- No data migration. No external API change. Existing `post_to` cross-channel use cases are unaffected.
