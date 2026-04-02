## 1. SlackStreamer Message Timestamp

- [x] 1.1 Capture `ts` from the first `append()` response in `SlackStreamer` and store it as a private field
- [x] 1.2 Expose `getMessageTs(): string | undefined` public getter on `SlackStreamer`
- [x] 1.3 Add test for `getMessageTs()` returning the captured timestamp

## 2. ResponseCapture Skip Flag

- [x] 2.1 Add `setSkipped()` and `isSkipped()` to the `ResponseCapture` interface and `createResponseCapture()` in `src/tools/server.ts`
- [x] 2.2 Add `isSkipped()` accessor to `ClackToolsResult` interface in `src/tools/server.ts`, wired to `responseCapture.isSkipped()` in `buildQueryTools()`
- [x] 2.3 Add `skipped?: boolean` to `ClaudeResponse` in `src/claude/index.ts`
- [x] 2.4 In `buildSuccessResponse()`, check `clackTools.isSkipped()` **before** the `structuredResponse` branch — return `{ success: true, skipped: true, answer: "" }` early

## 3. submit_response Skip Schema & Validation

- [x] 3.1 Add `skip_response?: boolean` parameter to `submit_response` tool schema, gated by a `allowSkip` flag on `SubmitResponseDeps`
- [x] 3.2 Use `z.union()` to create two schema branches: skip branch (skip_response + message only) and normal branch (sections required)
- [x] 3.3 Implement safeguard validation: when `skip_response: true`, check `message` matches exact string, reject with error containing the required string if not
- [x] 3.4 When skip is valid: call `responseCapture.setSkipped()`, skip deliver/render/capture, return `{ success: true, skipped: true }`
- [x] 3.5 Add tests for skip with correct message, skip with wrong message, skip without message, and normal flow unchanged

## 4. Tool Gating by Trigger Type

- [x] 4.1 Pass `allowSkip` to `createSubmitResponseTool()` in `buildQueryTools()`, set to `true` when `triggerType` is `"autoRespond"` or `"threadReply"`
- [x] 4.2 Verify `skip_response` parameter absent from schema for other trigger types

## 5. executeAndDeliver Skip Handling

- [x] 5.1 Add skip handling in `executeAndDeliver()` between `askClaude` return and the `cancelled`/`success`/`error` branching: when `response.skipped`, delete the streamer message via `chat.delete` (if streamer exists and has a `ts`), then return early — skip persistence and auto-execute
- [x] 5.2 Wrap `chat.delete` in try/catch — log errors but don't re-throw
- [x] 5.3 Add test for the skip path in `executeAndDeliver`

## 6. Prompt Guidance

- [x] 6.1 Update the auto-respond delivery context prompt in `promptBuilder.ts` to mention `skip_response` capability when trigger type allows skipping
- [x] 6.2 Ensure the prompt does NOT include the exact safeguard acknowledgment string
