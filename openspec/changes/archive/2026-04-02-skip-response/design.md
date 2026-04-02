## Context

Today, `submit_response` is the only way for Claude to end a query — it must always deliver content. In auto-respond contexts, the pre-analysis gate (Sonnet) decides whether to engage, but it's a lightweight classifier without tool access. When it says "respond" and the full Claude session starts, Claude may discover through deeper analysis that the conversation doesn't need a Clack response (users talking to each other, question already answered, etc.). The streamer has already posted "Acknowledged, working on it..." by this point, and Claude is forced to produce an answer.

Key files in the current flow:
- `src/tools/presentation/submitResponse.ts` — tool definition and handler
- `src/tools/server.ts` — `ResponseCapture` interface, tool assembly and gating
- `src/claude/index.ts` — `ClaudeResponse` type, `buildSuccessResponse()`, `buildToolResults()`
- `src/slack/handlers/handlerResponse.ts` — `executeAndDeliver()`, delivery context, success/cancel/error paths
- `src/streaming/slackStreamer.ts` — `SlackStreamer`, stream lifecycle, message posting

## Goals / Non-Goals

**Goals:**
- Allow Claude to gracefully skip responding in auto-respond/thread-reply contexts
- Clean up all visual artifacts (delete the streamer message) so it's as if Clack never engaged
- Require intentional confirmation from Claude to prevent accidental skips

**Non-Goals:**
- Adding skip to explicit triggers (mentions, DMs, reactions) — the user asked, they deserve an answer
- Changing the pre-analysis gate behavior
- Adding analytics/tracking for skip frequency (can be added later via logs)

## Decisions

### 1. Flag on `submit_response` rather than a separate tool

Add `skip_response?: boolean` to the existing `submit_response` schema rather than creating a new `skip_response` tool.

**Why:** The entire architecture treats `submit_response` as THE terminal tool. System prompts, instructions, and the fallback behavior in `executeAndDeliver` all assume "Claude must call submit_response." A separate tool would break this contract and require auditing every instruction that references it. With a flag, Claude still calls `submit_response` — it's just saying "my answer is: nothing."

### 2. Safeguard via exact message string with error-driven discovery

When `skip_response: true`, the `message` field must exactly match: `"I acknowledge that responding to this would serve no purpose, so I am skipping it."` If it doesn't match, the tool rejects with an error containing the required string.

**Why:** This forces Claude to be deliberate. The prompt tells Claude about `skip_response` but doesn't include the exact string — Claude discovers it through the error on first attempt. This keeps the prompt clean (focused on decision-making, not protocol details) and costs one extra round-trip, which is invisible in auto-respond contexts where no human is actively waiting.

### 3. Schema relaxation when skipping

When `skip_response: true`, `sections` and `actions` are not required. The tool only validates the `message` field.

**Why:** Requiring Claude to fabricate dummy sections for a skip is wasteful. The skip path skips all rendering, block validation, and delivery — sections/actions would be ignored anyway.

**Implementation:** Use `z.union()` with two branches — a skip branch (`skip_response: true` + `message`) and the existing response branch (`sections` required). This keeps Zod validation clean rather than adding conditional logic.

### 4. Capture streamer message `ts` for deletion

Modify `SlackStreamer.append()` to capture the `ts` from the first Slack API response and expose it via a `getMessageTs()` getter.

**Why:** The `chatStreamer.append()` call returns a response object with `ts?: string`. Currently this return value is discarded. We need the `ts` to call `client.chat.delete()` after a skip. Capturing from the first append (which creates the message) is the earliest and most reliable point.

**Alternative considered:** Capturing from `stop()` return value — but `stop()` is called in the `finally` block and its return is also discarded. Capturing from `append()` is simpler and doesn't require changing the `stop()` call chain.

### 5. Skip signal propagation via `ResponseCapture`

Extend `ResponseCapture` with `setSkipped()` / `isSkipped()` methods. The skip flag propagates through `buildToolResults()` → `buildSuccessResponse()` → `ClaudeResponse.skipped`.

**Why:** `ResponseCapture` is already the mechanism by which `submit_response` communicates results back to `askClaude`. Adding a skipped flag follows the same pattern. The `ClaudeResponse` type gains an optional `skipped?: boolean` field, parallel to the existing `cancelled?: boolean`.

**Critical ordering:** When skip is used, `responseCapture.set()` is NOT called (the skip path skips capture), so `responseCapture.get()` returns `null`. `buildSuccessResponse()` must check `isSkipped()` **before** checking `structuredResponse`, otherwise it falls through to the "No submit_response called" path and returns `success: false`. The `isSkipped()` accessor must also be exposed on `ClackToolsResult` (alongside `getResult()`, `getRenderedBlocks()`, etc.) so `buildSuccessResponse()` can read it.

### 6. Message deletion in `executeAndDeliver`

After `askClaude` returns with `response.skipped`, the handler short-circuits **before** `handleSuccess()` — same pattern as the existing `response.cancelled` check:
1. Check `response.skipped` between `askClaude` return and the `cancelled`/`success`/`error` branching
2. Stop the streamer (already in `finally` block)
3. Call `client.chat.delete({ channel, ts: streamer.getMessageTs() })` to remove the message
4. Return early — skip `persistResponseState()` and `handleAutoExecuteActions()`

**Why:** The skip check must happen before `handleSuccess()` because `handleSuccess()` would try to deliver via streamer fallback (since `alreadyDelivered` is false). Modeled on the existing cancellation pattern at `executeAndDeliver` lines 120-123.

### 7. Tool schema gated by trigger type

The `skip_response` parameter is only included in the tool schema when `triggerType` is `"autoRespond"` or `"threadReply"`. For other triggers, the parameter doesn't exist in the schema and Claude can't use it.

**Why:** Skip only makes sense when Clack proactively engaged. For explicit triggers, the user asked for a response. Gating at the schema level is cleaner than prompt-only gating — Claude can't misuse what it can't see. The trigger type is already available in the session context passed to tool construction.

### 8. Prompt guidance in auto-respond delivery context

Add a brief instruction in the auto-respond delivery context prompt (built in `promptBuilder.ts`) telling Claude it can skip when the conversation doesn't need a Clack response. Don't include the exact safeguard string — let the error teach it.

## Risks / Trade-offs

**[Extra round-trip on skip]** → The safeguard message validation causes one retry when Claude skips. Mitigation: this only happens in auto-respond where latency is invisible. The retry is a single tool call, not a full re-query.

**[Deleted message confusion]** → A user might see "Acknowledged, working on it..." and then it vanishes. Mitigation: this window is short (seconds), and the alternative (a useless forced response) is worse. Users who weren't watching won't notice.

**[chat.delete permission]** → The bot needs the `chat:write` scope to delete its own messages, which it already has. No new OAuth scopes required.

**[Skipped session cleanup]** → If a session is created but then skipped, it becomes an orphan. Mitigation: don't persist the session on skip. The session object exists in memory during the query but is never written to disk. Existing session cleanup handles any in-memory remnants.
