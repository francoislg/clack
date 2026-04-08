## 1. Session Model

- [x] 1.1 Add `autoResponseActive?: boolean` to `SessionContext` interface in `src/sessions.ts`
- [x] 1.2 Set `autoResponseActive: true` in `createSession()` so new sessions default to active
- [x] 1.3 Add `setAutoResponseActive(sessionId, active)` helper that updates the field and persists to disk
- [x] 1.4 Ensure `autoResponseActive` is included in `context.json` serialization. On deserialization, default missing `autoResponseActive` to `true` for backward compatibility with pre-existing sessions

## 2. Pre-Analysis Tri-State

- [x] 2.1 Change `runPreAnalysis()` return type from `boolean` to `"respond" | "skip" | "stop"`
- [x] 2.2 Update response parsing to detect "stop" in classifier output alongside "respond"
- [x] 2.3 Update the thread pre-analysis prompt (`THREAD_PRE_ANALYSIS_CONTEXT`) to include "stop" guidance — return "stop" when the conversation has clearly moved on, "skip" when this specific message isn't relevant
- [x] 2.4 Update the system prompt template to include "stop" as a valid output alongside "skip" and "respond"
- [x] 2.5 Update pre-analysis tests to cover the "stop" outcome

## 3. Auto-Respond Handler

- [x] 3.1 In thread auto-respond path (`resolveAutoRespondContext`), check `session.autoResponseActive !== false` after finding the session — return null immediately if disengaged
- [x] 3.2 Handle pre-analysis `"stop"` result: call `setAutoResponseActive(session.sessionId, false)`, log disengagement at info level (session ID, channel, thread), and return null
- [x] 3.3 Update the top-level auto-respond path in `resolveAutoRespondContext` to compare `runPreAnalysis()` result against `"respond"` instead of truthy boolean. Treat `"stop"` the same as `"skip"` for top-level messages (no session exists to disengage)
- [x] 3.4 Add debug logging for disengaged thread skips

## 4. Submit Response Disengage Flag

- [x] 4.1 Add `disengage` boolean to the skip-enabled `submit_response` schema (alongside `skip_response`)
- [x] 4.2 Validate that `disengage: true` requires `skip_response: true`, return error otherwise
- [x] 4.3 Add `setDisengaged()` and `isDisengaged()` to `ResponseCapture` in `src/tools/server.ts`. Add `disengaged?: boolean` to `ClaudeResponse` in `src/claude/index.ts` and propagate through `buildSuccessResponse()` and `buildQueryTools()`
- [x] 4.4 Return `{ success: true, skipped: true, disengaged: true }` when both flags are set
- [x] 4.5 In `handleSkip()` in `src/slack/handlers/handlerResponse.ts`, check `response.disengaged` and call `setAutoResponseActive(session.sessionId, false)` when set
- [x] 4.6 Update submit_response tests to cover disengage scenarios

## 5. Stop Tracking Tool

- [x] 5.1 Create `src/tools/query/stopTracking.ts` — implement the `stop_tracking` tool accepting a Slack URL parameter
- [x] 5.2 Export `parseSlackMessageUrl` from `src/tools/query/fetchSlackMessage.ts` (or extract to shared helper), then import it in `stopTracking.ts`
- [x] 5.3 Parse URL to get `channelId` and `threadTs` (use `threadTs` from URL query param if present, otherwise `messageTs` as thread root). Look up session via `findSessionByThread`, validate that requesting user is session owner or has admin+ role
- [x] 5.4 Call `setAutoResponseActive(sessionId, false)` and return result
- [x] 5.5 Register `stop_tracking` in `src/tools/server.ts` when Slack client is available (all roles)
- [x] 5.6 Add tests for stop_tracking tool (success, no session, permission denied, already disengaged, invalid URL format)

## 6. Re-Activation via @Mention

- [x] 6.1 In mention handler (`src/slack/handlers/mention.ts`), before calling `processMessage()`, look up the existing session via `findSessionByThread(channelId, threadTs)`. If a session exists with `autoResponseActive === false`, call `setAutoResponseActive(sessionId, true)` and log at info level. Then proceed with `processMessage()` as normal
- [x] 6.2 Log re-activation at info level

## 7. Prompt Guidance

- [x] 7.1 Update auto-respond delivery context in `src/claude/promptBuilder.ts` to include disengage guidance — distinguish `skip_response` (temporary) from `skip_response + disengage` (permanent until re-mentioned)

## 8. Testing & Verification

- [x] 8.1 Add integration-style test: session created → autoResponseActive defaults true → thread reply evaluated
- [x] 8.2 Add test: session with autoResponseActive=false → thread reply skipped without pre-analysis
- [x] 8.3 Add test: pre-analysis "stop" → session disengaged
- [x] 8.4 Add test: submit_response skip+disengage → session disengaged
- [x] 8.5 Verify existing pre-analysis and auto-respond tests still pass after tri-state migration
- [x] 8.6 Run `npx tsc` to verify no type errors across the codebase
- [x] 8.7 Run `npm run test` to verify all existing and new tests pass
