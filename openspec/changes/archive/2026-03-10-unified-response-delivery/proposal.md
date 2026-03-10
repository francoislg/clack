## Why

Response delivery (Claude invocation → Slack posting) is duplicated across 4 call sites (`processMessage`, `followup`, `choice`, `retry`), each with its own error handling and response posting logic. Button handlers lack streaming feedback entirely. The `submit_response` tool captures the payload but doesn't actually deliver it — the caller does, after Claude has already exited, so Slack-side errors (msg_too_long, invalid_blocks) can't be fed back to Claude for self-correction.

## What Changes

- **Clean separation: trigger context vs. delivery**: Each trigger (reaction, mention, DM, button click) prepares a `SessionInfo` with normalized coordinates (channel, thread, DM coords). Once context is set, every path calls the same `executeAndDeliver` — no trigger-specific branching inside the delivery layer.
- **`submit_response` becomes a real delivery tool**: Instead of capturing the payload for the caller to post later, it calls the streamer/Slack API directly. Claude sees success or failure and can retry with adjusted content. A `deliver` callback is injected at tool construction time, abstracting over streaming vs. one-shot posting.
- **One shared `executeAndDeliver` function**: All Claude invocation + response delivery logic consolidates into a single function in `handlerResponse.ts`. It reads `sessionInfo` to determine where to stream/post, creates a streamer, calls `askClaude`, and handles persistence and auto-execute. No `isDm` checks, no trigger-type branching.
- **Button handlers get streaming**: `followup`, `choice`, and `retry` all go through `executeAndDeliver`, which creates a `SlackStreamer` — users see task card progress on button clicks.
- **Remove dead code**: `dismissOriginal` (already a no-op), `postSuccessResponse`, `postSuccessResponseWithRetry`, `postErrorResponse` are absorbed or deleted. The `postSuccessResponseWithRetry` re-invoke-on-block-error pattern is replaced by the tool's native feedback loop. `processDmRefinement`, `postDmThreadReply`, and `autoSendToThread` are deleted — dead code since `threadReply.ts` was removed in the slack-assistant change.
- **Streamer supports retry on failed stop**: `SlackStreamer.stop()` becomes retryable — if the Slack API rejects the finalization, the stream stays open for another attempt.

## Capabilities

### New Capabilities

_None — this is an internal refactoring of existing delivery mechanisms._

### Modified Capabilities

- `clack-tool-response`: `submit_response` now performs actual delivery instead of capture-only. Returns Slack delivery errors to Claude for self-correction.
- `error-reporting`: Block posting retry changes from external re-invoke to in-tool feedback loop. The "retry via refinement" pattern for `invalid_blocks`/`msg_too_long` is replaced by Claude seeing the error directly from `submit_response` and calling it again.

## Impact

- **`src/tools/presentation/submitResponse.ts`** — Receives a `deliver` callback; calls it on validation success instead of just capturing.
- **`src/tools/server.ts`** — Passes deliver callback through to `createSubmitResponseTool`.
- **`src/tools/types.ts`** — Add `DeliverFn` type.
- **`src/tools/context.ts`** — Forward `deliver` through `BuildQueryContextParams`.
- **`src/claude.ts`** — `askClaude` accepts optional `deliver` callback; passes `slackClient` always (fixing a gap where button handlers didn't provide it).
- **`src/slack/handlers/handlerResponse.ts`** — New `executeAndDeliver` function. Dead helpers removed.
- **`src/slack/handlers/core.ts`** — `processMessage` becomes thin: session setup → DM opening → store coords in sessionInfo → in-flight registration → `executeAndDeliver()` → deregistration.
- **`src/slack/handlers/followup.ts`** — Thin wrapper around `executeAndDeliver`.
- **`src/slack/handlers/choice.ts`** — Thin wrapper around `executeAndDeliver`.
- **`src/slack/handlers/retry.ts`** — Thin wrapper around `executeAndDeliver`.
- **`src/slack/handlers/dmActions.ts`** — Delete dead `processDmRefinement` and local `autoSendToThread`.
- **`src/streaming/slackStreamer.ts`** — `stop()` retryable on failure.
