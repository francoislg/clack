## Context

When a user triggers Clack (via @mention or DM), the request flows through `processMessage()` → `askClaude()` → Agent SDK `query()`. Once the `for await` loop starts, there is no way to stop it — query mode has no `AbortController`. Worker mode (`runClaude()` in `execution.ts`) already uses an `AbortController` for timeouts, proving the SDK supports it.

Currently, all handlers (`directMessage.ts`, `threadReply.ts`) skip `message_changed` events via `if (msg.subtype) return`. There is no handler for message edits at all.

Session state is tracked in two places: in-memory (`state.ts` → `activeSessions` Map) and on disk (`sessions.ts`). Thread-to-session lookup exists via `findSessionByThread()`. Neither tracks whether a Claude invocation is currently running.

## Goals / Non-Goals

**Goals:**
- Cancel in-flight Claude query invocations when the triggering message is edited
- Restart the request with updated text when the edit still contains a bot mention (mentions) or is a DM
- Cancel without restart when the bot mention is removed from an edited message
- Clean up thinking indicators (emoji or "Investigating..." message) on cancellation
- Support cancellation for both query mode (`askClaude`) and worker mode (`runClaude`)

**Non-Goals:**
- Re-processing edits after Claude has already responded (post-completion edits are ignored)
- Cancellation for reactions mode (the reactor is not the message author)
- Feeding new context to an already-running invocation (update-in-flight)
- Cancellation via explicit user action (e.g., a "Cancel" button) — could come later, using the same registry

## Decisions

### 1. In-flight request registry as a standalone module

Create `src/slack/inFlightRequests.ts` with a `Map<string, InFlightRequest>` keyed by `"channelId:messageTs"` (the original triggering message timestamp, not the thread timestamp).

```typescript
interface InFlightRequest {
  abortController: AbortController;
  sessionId: string;
  triggerType: "directMessages" | "mentions";
  thinkingState: ThinkingState;  // For cleanup
}
```

**Why `channelId:messageTs` and not `channelId:threadTs`?** The `message_changed` event provides the edited message's `ts`. For top-level messages (DMs, first @mention), `messageTs === threadTs`. But for thread reply edits, we need the specific message. Using `messageTs` is more precise.

**Why a separate module?** The existing `state.ts` tracks session metadata for button handlers. The in-flight registry has a different lifecycle (set on invocation start, deleted on completion) and different data (abort controller, thinking state). Mixing them would couple unrelated concerns.

**Alternative considered:** Storing the `AbortController` on `SessionInfo` in `state.ts`. Rejected because `SessionInfo` persists beyond the invocation and is serialized to disk — `AbortController` is ephemeral and non-serializable.

### 2. Wire AbortController into askClaude()

Add an optional `abortController` parameter to `AskClaudeOptions`. The `askClaude()` function passes it through to the Agent SDK's `query()` options. On abort, the `for await` loop throws an `AbortError` — handle it the same way `runClaude()` already does.

The caller (`processMessage()` in `core.ts`) creates the `AbortController`, registers it in the in-flight registry before calling `askClaude()`, and deregisters it in a `finally` block.

**Alternative considered:** Creating the `AbortController` inside `askClaude()` and returning it. Rejected because the caller needs the controller *before* the async call starts (to register it), and `askClaude()` is an async function that doesn't return until completion.

### 3. New message_changed handler

Create `src/slack/handlers/messageChanged.ts`, registered in `app.ts`. Listens on `app.event("message")` and filters for `subtype === "message_changed"`.

Flow:
1. Extract `channel`, `message.ts` (the edited message's timestamp), `message.text` (new text), `previous_message.text` (old text)
2. Look up `"channel:message.ts"` in the in-flight registry
3. If no match → ignore (either already completed or never triggered)
4. If match → abort the in-flight request
5. Clean up thinking state (remove emoji or delete "Investigating..." message)
6. Determine restart: for mentions, check if new text contains `<@BOT_ID>>`; for DMs, always restart (unless new text is empty)
7. If restarting → call `processMessage()` with the new text

**Bot ID caching:** The handler needs the bot's user ID to check for mention presence. Currently, `mention.ts` calls `client.auth.test()` per event. For the edit handler, cache the bot ID on first use (it never changes at runtime).

### 4. Cancellation also covers worker mode

The `runClaude()` function already has an `AbortController` for timeouts, but it's internal. To support external cancellation, the caller needs to either:
- Pass in an `AbortController` (like `askClaude` will now accept), or
- Expose the internal one

Since worker mode is triggered from `executeChange()` which is called from change workflow handlers, and the in-flight registry keys by `channelId:messageTs`, worker-mode cancellation will follow the same registry pattern. The `executeChange()` caller registers the abort controller before starting and deregisters on completion.

### 5. Abort cleanup responsibilities

When an abort happens, two things need cleaning up:

| What | Who cleans it up |
|------|-----------------|
| Thinking indicator (emoji/message) | The `message_changed` handler, using `ThinkingState` from the registry |
| In-flight registry entry | The `message_changed` handler (before restart) |
| Session state | No special cleanup — the session persists and gets reused on restart |
| MCP tool server | The Agent SDK handles process cleanup on abort |

On restart, `processMessage()` finds the existing session via `findSessionByThread()` and reuses it, updating the question text. This is the same path that thread replies already take.

## Risks / Trade-offs

**[Race condition: abort and completion overlap]** → The `message_changed` handler calls `abort()`, but the `for await` loop in `askClaude()` might have already exited. Mitigation: the `finally` block in `processMessage()` deregisters from the registry. If the handler doesn't find an entry, it's a no-op. Use `delete`-before-abort ordering in the handler to prevent double-processing.

**[DM message_changed events might not fire in Socket Mode]** → Slack's documentation is ambiguous about whether `message_changed` is delivered for DMs in all API modes. Mitigation: test during implementation; if DM edits don't fire `message_changed`, document this as a known limitation (mentions would still work).

**[Restart triggers a second thinking indicator]** → When restarting, `processMessage()` will post a new thinking indicator. The old one was already cleaned up by the abort handler. This is fine — the user sees the indicator disappear then reappear, signaling the restart.

**[Multiple rapid edits]** → User edits twice in quick succession. First edit aborts and restarts; second edit arrives while the restart is registering. Mitigation: the registry lookup is synchronous (Map.get), so the second edit either finds the first request (aborts it) or finds the restart (aborts it). Both are correct behavior — only the latest edit survives.
