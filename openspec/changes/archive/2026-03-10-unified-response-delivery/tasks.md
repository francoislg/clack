## 1. Streamer Retry Support

- [x] 1.1 Modify `SlackStreamer.stop()` to NOT set `this.stopped = true` when the API call fails — only set it on success, so a second `stop()` call with corrected content can retry
- [x] 1.2 Track whether the "thinking complete" task was already appended so it doesn't duplicate on retry — use a separate `thinkingCompleted` flag, skip the append if already sent

## 2. DeliverFn Type and Tool Wiring

- [x] 2.1 Add `DeliverFn` type to `src/tools/types.ts`: `(opts: { markdownText: string; blocks?: Block[] }) => Promise<{ ok: true } | { ok: false; error: string }>`
- [x] 2.2 Add optional `deliver` field to `QueryToolContext` in `src/tools/types.ts`
- [x] 2.3 Add optional `deliver` field to `BuildQueryContextParams` in `src/tools/context.ts` and forward it into the returned `QueryToolContext`
- [x] 2.4 Add optional `deliver` field to `AskClaudeOptions` in `src/claude.ts` and pass it through to `buildQueryContext`
- [x] 2.5 Add optional `deliver` parameter to `createSubmitResponseTool` factory in `src/tools/presentation/submitResponse.ts`
- [x] 2.6 Update `submit_response` tool handler: after local validation succeeds, call `deliver()`. On success → capture payload in `ResponseCapture` + return `{ success: true, delivered: true }`. On failure → return error to Claude (don't capture). Track "already delivered" state on the deliver callback closure (not on `ResponseCapture`) to prevent double-posting.
- [x] 2.7 When no `deliver` callback is provided, fall back to capture-only behavior (preserve backward compat for tests/dry runs)
- [x] 2.8 Forward `deliver` from `QueryToolContext` to `createSubmitResponseTool` in `buildQueryTools` in `src/tools/server.ts`

## 3. executeAndDeliver

- [x] 3.1 Create `executeAndDeliver` in `handlerResponse.ts`. Signature: `(params: { client, session, sessionInfo, claudeOptions, abortController? }) => Promise<ClaudeResponse>`. It is trigger-agnostic — no `isDm` checks, no `triggerType` branching. It reads `sessionInfo` to derive the target channel/thread and handles the full delivery lifecycle.
- [x] 3.2 Streamer creation: derive target from `sessionInfo` — use `dmChannel`/`dmThreadTs` when present, otherwise `channelId`/`threadTs`. Omit `teamId` — `SlackStreamer.start()` falls back to `client.auth.test()` internally.
- [x] 3.3 `DeliverFn` callback construction: close over streamer + client + target channel/thread. Try `streamer.stop()` first; if streamer has failed, fall back to `client.chat.postMessage` with same channel/thread. Track "already delivered" boolean in the closure. Return `{ ok: false, error: "Response already delivered" }` on second invocation.
- [x] 3.4 Call `askClaude(session, { ...claudeOptions, slackClient: client, deliver, onEvent: streamer.handleEvent, abortController })`. Always pass `slackClient: client` — this fixes button handlers which previously didn't provide it, making Slack-dependent tools (find_user, fetch_slack_message) available during all re-invocations.
- [x] 3.5 Cancellation path: if `response.cancelled`, stop stream with "_Request cancelled._" text. If streamer has failed, fall back to `chat.postMessage`.
- [x] 3.6 Success path (submit_response called): `persistResponseState()` then `handleAutoExecuteActions()`. Delivery already happened inside the tool.
- [x] 3.7 Success path (submit_response NOT called): deliver callback was never invoked, stream is still running. Stop stream with raw text via `streamer.stop({ markdownText })` or `chat.postMessage` fallback.
- [x] 3.8 Error path: `addError()` → post error blocks + retry button via `chat.postMessage` (not the streamer — stream may already be stopped if submit_response delivered before the SDK errored) → optional DM error report.
- [x] 3.9 `finally` block: `streamer.stop()` — idempotent no-op if already stopped by deliver callback or earlier path.
- [x] 3.10 Add `persistResponseState` to `handlerResponse.ts` (move from core.ts or rewrite — it's small). Delete `stopStreamWithResponse` from core.ts — superseded by the deliver callback.

## 4. Migrate processMessage

- [x] 4.1 Refactor `processMessage` to be a trigger-context wrapper only. It handles: session setup, DM channel opening + parent message posting (reaction DM-first only), permalink fetching, storing DM coords in sessionInfo, assistant channel context, in-flight request registration. Then it calls `executeAndDeliver()`. In-flight deregistration happens in `finally` — `executeAndDeliver` is unaware of cancellation registration.
- [x] 4.2 Remove all inlined Claude invocation, response handling, error handling, streamer creation, and auto-execute from `processMessage` — these are now inside `executeAndDeliver`.
- [x] 4.3 Delete from core.ts: `stopStreamWithResponse`, `handleErrorResponse`, `sendErrorDM`, `createStreamer`. Keep `setupSession` and `openDmChannel` in core.ts — they are processMessage-specific context setup, not shared delivery logic.

## 5. Migrate Button Handlers

- [x] 5.1 Refactor `followup.ts`: decode value → restore session info → get session → add refinement → `executeAndDeliver()`. Remove `respond` from destructured params (no longer needed without `dismissOriginal`).
- [x] 5.2 Refactor `choice.ts`: decode value → restore session info → get session → add refinement → merge `workMode` into `claudeOptions` before calling `executeAndDeliver()`. Remove manual `handleAutoExecuteActions` call. Remove `respond` from destructured params.
- [x] 5.3 Refactor `retry.ts`: restore session info → get session → re-fetch thread context → `executeAndDeliver()`. Remove "Retrying..." text post. Remove `respond` from destructured params.

## 6. Dead Code Removal

- [x] 6.1 Delete `dismissOriginal` and its `RespondFn` type from `handlerResponse.ts`. Remove all imports and calls from followup.ts, choice.ts, retry.ts.
- [x] 6.2 Delete `postSuccessResponse`, `postSuccessResponseWithRetry`, `postErrorResponse` from `handlerResponse.ts`
- [x] 6.3 Delete `isSlackBlockError` helper from `handlerResponse.ts`
- [x] 6.4 Delete `processDmRefinement` from `dmActions.ts` — dead code (only caller `threadReply.ts` was deleted in the slack-assistant change). Also delete `postDmThreadReply` from `dmResponse.ts` (only used by `processDmRefinement`) and the local `autoSendToThread` function in `dmActions.ts` (only called from `processDmRefinement`).
- [x] 6.5 Verify `postResponse` is still used by `resend.ts` — keep it. Verify `getHandlerClaudeOptions` is still used by callers — keep if so. Clean up any other now-unused imports across modified files.

## 7. Verification

- [x] 7.1 `npx tsc --noEmit` — clean compilation
- [ ] 7.2 Test all triggers (mention, DM, reaction) — streaming task cards work as before
- [ ] 7.3 Test all buttons (followup, choice, retry) — now show streaming task cards
- [ ] 7.4 Test DM-first buttons — streaming goes to DM thread
- [ ] 7.5 Test error path — error blocks still appear with retry button
- [ ] 7.6 Test submit_response block validation error — Claude sees error and retries within same turn
