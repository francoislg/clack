## 1. SlackStreamer state extensions

- [x] 1.1 Add private fields `messageTss: string[]` (initialized empty) and `rolloverCount: number` (initialized 0) to `SlackStreamer`.
- [x] 1.2 Add private static `MAX_ROLLOVERS = 2` constant.
- [x] 1.3 Add private static `CONTINUATION_TASK_TITLE = "Continuing previous stream…"` constant.
- [x] 1.4 Extend `streamDiagnostics()` return type to include `rolloverCount: number`; populate from the new field.

## 2. Public API additions

- [x] 2.1 Add `getAllMessageTss(): string[]` method that returns `[...this.messageTss, ...(this.messageTs ? [this.messageTs] : [])]`. Document inline that the order is oldest-first and the current ts (if present) is always last.
- [x] 2.2 Confirm `getMessageTs()` continues to return the latest block's ts unchanged — `this.messageTs` is reset to `undefined` on rollover and re-captured by the first append of the new block.

## 3. Rollover implementation

- [x] 3.1 Add private method `rollover(): Promise<boolean>` that: (a) pushes the current `this.messageTs` to `messageTss` if set; (b) clears `messageTs`, `openGroup`, `taskSlack`, `taskLabels`, `activeTasks`, sets `thinkingFinalized = false`, `failed = false`; (c) increments `rolloverCount`; (d) opens a new `chatStream` with the same `channel`, `thread_ts`, `task_display_mode`, `recipient_team_id`, `recipient_user_id` options as `start()`; (e) appends the continuation thinking task (`CONTINUATION_TASK_TITLE`, `in_progress`); (f) resets `lastEventAt` and `lastKeepaliveTickAt` to `Date.now()`; (g) returns `true` on success, `false` if any step throws.
- [x] 3.2 In `rollover()`, on any caught error: log at `warn` level with `streamDiagnostics()`, return `false` (do not propagate). Caller decides what to do.
- [x] 3.3 Refactor the chat stream construction in `start()` into a private helper `openChatStream(): ChatStreamer` so `start()` and `rollover()` both call it.

## 4. append() catch site rewrite

- [x] 4.1 In `append()`'s catch block, after the `this.stopped` early return, classify the error code first via `getSlackErrorCode(error)`.
- [x] 4.2 Add explicit `stopped_by_user` branch: log `warn` with diagnostics, set `failed = true`, call `stopKeepalive()`, return.
- [x] 4.3 Add recoverable-code branch (`message_not_in_streaming_state` or `message_not_found`): if `rolloverCount < MAX_ROLLOVERS`, call `await this.rollover()`. On success, retry the failing `chat.appendStream({ chunks })` once inside a nested try/catch; if the retry succeeds, return without entering failed state. If the retry throws, fall through to the existing failure-logging branch.
- [x] 4.4 Existing logging + `failed = true` + `stopKeepalive()` branch handles everything else (rollover not attempted, rollover cap exhausted, retry-after-rollover failed, or non-recoverable code). Ensure the warning log includes `rolloverCount` via the updated diagnostics.

## 5. handlerResponse.ts call-site updates

- [x] 5.1 In `postTopLevel` (around line 289-302), replace the single `getMessageTs()` + single `chat.delete` with an iteration over `getAllMessageTss()`. Each individual `chat.delete` failure is logged at `warn` and does not halt iteration.
- [x] 5.2 In `handleCancellation` (around line 489-505), same refactor: iterate `getAllMessageTss()`, delete each, log per-ts failures at `warn`.
- [x] 5.3 In `handleSkip` (around line 511-527), same refactor.
- [x] 5.4 Leave the line 353 happy-path call site unchanged — it still uses `getMessageTs()` for delivery ts (reactions, session bookkeeping land on the latest block, which is correct).

## 6. Tests — SlackStreamer rollover behavior

- [x] 6.1 Add a multi-stream mock helper to `slackStreamer.test.ts` (e.g., `makeMockClientWithStreamers(streamers: MockChatStreamer[])`) that returns successive `chatStream()` calls from the array.
- [x] 6.2 Test: append fails with `message_not_in_streaming_state` on Block 1 → second `chatStream` opened → continuation thinking task appended → failing chunks replayed against Block 2 → `hasFailed` is false → `getAllMessageTss()` returns 2 tss → `getMessageTs()` returns the latest.
- [x] 6.3 Test: same as 6.2 but with `message_not_found`.
- [x] 6.4 Test: two consecutive recoverable failures → 3 blocks → third failure exhausts cap → `hasFailed` is true → `getAllMessageTss()` returns 3 tss → warning log includes `rolloverCount: 2`.
- [x] 6.5 Test: `stopped_by_user` → no rollover attempted (mock `chatStream` called exactly once) → `hasFailed` is true → log is `warn` not `error` → `getAllMessageTss()` returns 1 ts.
- [x] 6.6 Test: `tool_end` for a Block-1 taskId arriving after rollover is a no-op (Block 2's `append` is not called for that taskId).
- [x] 6.7 Test: `tool_start` for a new taskId after rollover creates a fresh task card on Block 2 (Block 2's `append` is called with a new `task_update` chunk).
- [x] 6.8 Test: rollover open itself throws → `rollover()` returns false → streamer enters failed state, no infinite recursion.
- [x] 6.9 Test: `getAllMessageTss()` with zero rollovers returns single-element array equal to `[getMessageTs()!]`.
- [x] 6.10 Test: keepalive after rollover targets Block 2's stream (existing keepalive scenarios continue to work — verify no leak of Block-1 `activeTasks`).

## 7. Tests — handlerResponse.ts iteration

- [x] 7.1 In `handlerResponse.test.ts`, add a test for `handleSkip` that constructs a streamer mock returning `getAllMessageTss()` with 3 tss; assert `chat.delete` is called 3 times, once per ts.
- [x] 7.2 Same for `handleCancellation`.
- [x] 7.3 Same for `postTopLevel` (the top-level repost path).
- [x] 7.4 Test: one of the deletes throws — iteration continues, the remaining tss are still attempted.

## 8. Lint, type-check, format

- [x] 8.1 Run `npx tsc` and resolve any type errors.
- [x] 8.2 Run `npx oxlint src/streaming/slackStreamer.ts src/streaming/slackStreamer.test.ts src/slack/handlers/handlerResponse.ts src/slack/handlers/handlerResponse.test.ts` and fix any lints.
- [x] 8.3 Run `npx oxfmt` on the touched files.
- [x] 8.4 Run `npm test` and confirm the full suite passes.

## 9. Manual verification

- [ ] 9.1 With the bot running locally, force a recoverable failure (e.g., temporarily lower the keepalive interval or stub the SDK to simulate `message_not_in_streaming_state`) and verify in Slack that: Block 1 freezes, Block 2 opens with "Continuing previous stream…", subsequent tool calls render in Block 2, and skip/cancel actions delete both blocks.
- [ ] 9.2 Click the Slack stream's stop control mid-run and verify the streamer halts cleanly without rollover, with a single `warn`-level log entry.
