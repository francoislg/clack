## Context

Response delivery is split across 4 call sites, each with its own Claude invocation → Slack posting pipeline. `processMessage` (core.ts) has streaming via `SlackStreamer`; button handlers (`followup`, `choice`, `retry`) use non-streaming `postSuccessResponseWithRetry` + `postErrorResponse`. The `submit_response` MCP tool captures the payload in a `ResponseCapture` closure, but delivery happens after Claude exits — so Slack-side errors can't be corrected by Claude. Trigger-specific concerns (DM fallbacks, `isDm` checks) leak into the delivery path.

## Goals / Non-Goals

**Goals:**
- Clean separation between trigger context preparation and delivery
- Single `executeAndDeliver` function with no trigger-specific branching
- `submit_response` performs actual Slack delivery, giving Claude a native feedback loop for block errors
- All interaction paths get streaming task cards
- Remove dead/duplicate code

**Non-Goals:**
- Changing the `submit_response` schema (sections, actions) — only the delivery mechanism changes
- Modifying worker-mode tools (`report_status`, `git_push`, etc.)
- Renaming `submit_response` — keeping the existing name to avoid instruction churn
- Adding debouncing to the streamer (already deferred)

## Decisions

### 1. Two layers: trigger context vs. delivery

**Decision:** Enforce a clean boundary between trigger-specific setup and generic delivery.

**Trigger layer** (each caller owns its own setup):
- `processMessage`: session creation, DM channel opening, permalink fetching, parent message posting, assistant context, in-flight request registration/deregistration, `workMode` resolution
- `followup`/`choice`: decode action value, restore session, add refinement
- `retry`: restore session, re-fetch thread context
- `choice` additionally: compute `workMode` from action value

All triggers store normalized coordinates in `sessionInfo` (`channelId`, `threadTs`, and optionally `dmChannel`/`dmThreadTs`). Then they call `executeAndDeliver`.

**Delivery layer** (`executeAndDeliver`):
- Reads `sessionInfo` to determine target: `sessionInfo.dmChannel ?? sessionInfo.channelId`, `sessionInfo.dmThreadTs ?? sessionInfo.threadTs`
- Creates streamer, constructs deliver callback, calls `askClaude`, handles result
- Zero trigger-specific branching. No `isDm` checks. No `triggerType` inspection.

### 2. Deliver callback injected into the tool

**Decision:** Pass a `DeliverFn` callback into `createSubmitResponseTool`. The tool calls it after local validation succeeds. The callback abstracts over streaming (`streamer.stop()`) vs. one-shot (`chat.postMessage`) fallback.

**Why not pass the streamer directly?** The tool shouldn't know about `SlackStreamer`. A callback decouples the tool layer from the Slack streaming API. The caller constructs the callback, closing over the streamer, client, channel, and thread — the tool just calls `deliver(opts)` and checks the result.

**Type:**
```ts
type DeliverFn = (opts: {
  markdownText: string;
  blocks?: (KnownBlock | Block)[];
}) => Promise<{ ok: true } | { ok: false; error: string }>;
```

**Callback chain:** `deliver` flows through `AskClaudeOptions` → `BuildQueryContextParams` → `QueryToolContext` → `createSubmitResponseTool`.

**Alternatives considered:**
- Pass streamer directly → couples tool layer to Slack streaming internals
- Size estimation only (no real delivery) → doesn't catch unknown Slack errors
- Keep capture-only, retry externally → current approach, loses Claude feedback loop

### 3. Streamer retry on failed stop

**Decision:** Modify `SlackStreamer.stop()` to NOT set `this.stopped = true` when the API call fails. This allows a second `stop()` call with corrected content. Track whether the "thinking complete" task was already appended to avoid duplicate appends on retry.

**Why:** If Slack rejects the stop payload (msg_too_long, invalid_blocks), the stream should still be alive — the finalization failed, not the stream. Retrying with shorter/fixed content should work.

**Risk:** Slack's `chat.stopStream` API behavior on rejection is not fully documented. If the stream dies on any stop attempt, retry won't work. Mitigation: the deliver callback falls back to `chat.postMessage` if `hasFailed` is true after retry.

### 4. ResponseCapture still used alongside delivery

**Decision:** Keep `ResponseCapture` to store the delivered payload. The caller needs it for session persistence (`persistResponseState`) and auto-execute resolution. Delivery happens in the tool; capture is a side effect of successful delivery.

**Why not remove it?** The response payload (sections, actions, staged intents) must be persisted to the session for button handlers to restore context later. The tool captures the payload AND delivers it.

### 5. `executeAndDeliver` signature and internals

**Decision:** `executeAndDeliver` in `handlerResponse.ts`:

```ts
export async function executeAndDeliver(params: {
  client: App["client"];
  session: SessionContext;
  sessionInfo: SessionInfo;
  claudeOptions: AskClaudeOptions;  // callers merge workMode into this
  abortController?: AbortController;
}): Promise<ClaudeResponse>
```

Internally:
1. Derive target channel/thread from `sessionInfo` (prefer `dmChannel`/`dmThreadTs`)
2. Create `SlackStreamer` targeting that channel/thread (`teamId` omitted — streamer's `start()` falls back to `client.auth.test()` internally)
3. Start stream
4. Construct `DeliverFn` closing over streamer + `chat.postMessage` fallback + "already delivered" guard
5. Call `askClaude(session, { ...claudeOptions, slackClient: client, deliver, onEvent: streamer.handleEvent, abortController })`
6. Handle result (see paths below)
7. Ensure stream stopped in `finally` (idempotent no-op if already stopped by deliver callback)

**Note:** `executeAndDeliver` always passes `slackClient: client` to `askClaude`. This fixes a gap where button handlers previously didn't provide `slackClient`, leaving Slack-dependent tools (find_user, fetch_slack_message, fetch_channel_messages) unavailable during button-triggered re-invocations.

**Result paths:**
- **Cancelled:** `streamer.stop({ markdownText: "_Request cancelled._" })` → return
- **Success with delivery (submit_response called):** `persistResponseState()` → `handleAutoExecuteActions()` → return (delivery already done)
- **Success without delivery (submit_response not called):** `streamer.stop({ markdownText: answer })` or `chat.postMessage` fallback → return
- **Error:** `addError()` → post error blocks via `chat.postMessage` (stream may already be stopped if submit_response delivered before the SDK errored) → optional DM error report → return

### 6. Deliver callback construction

**Decision:** The `DeliverFn` callback:
1. Check "already delivered" flag → if true, return `{ ok: false, error: "Response already delivered" }`
2. Try `streamer.stop({ markdownText, blocks })` if streamer hasn't failed
3. If streamer failed → fall back to `client.chat.postMessage`
4. On success → set "already delivered" flag, return `{ ok: true }`
5. On failure → return `{ ok: false, error }` so Claude can retry with simpler content

The "already delivered" state lives on the closure, not on `ResponseCapture`.

### 7. Remove `postSuccessResponseWithRetry` re-invoke pattern

**Decision:** Delete the pattern where block errors trigger a full `askClaude` re-invoke with a refinement. The tool's native error return replaces this entirely.

### 8. Delete dead DM refinement code

**Decision:** `processDmRefinement` in `dmActions.ts` is dead code — its only caller (`threadReply.ts`) was deleted in the slack-assistant change. Delete it along with `postDmThreadReply` (only caller) and the local `autoSendToThread` (only caller).

### 9. Delete `stopStreamWithResponse`

**Decision:** `stopStreamWithResponse` in `core.ts` is superseded by the deliver callback. Delete it.

## Risks / Trade-offs

- **[Stream retry reliability]** → If Slack kills the stream on any failed stop, the retry path breaks. Mitigation: deliver callback falls back to `chat.postMessage`.
- **[Double delivery]** → If `submit_response` is called twice and both succeed, two messages appear. Mitigation: "already delivered" guard in the callback.
- **[Longer Claude turns]** → Claude retrying `submit_response` within the same turn uses more tokens. Mitigation: only happens on validation failures, which are rare.
- **[submit_response called before stream starts]** → Unlikely (Claude needs to process tools first), but the deliver callback handles this via `chat.postMessage` fallback.
