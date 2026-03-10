## Context

Clack currently handles DMs via raw `message.im` events through `directMessageHandler` (new messages) and `threadReplyHandler` (thread replies). The DM-first reaction flow (`dmActions.ts`, `dmResponse.ts`) delivers reaction-triggered answers via DM with synthesis — this is **unchanged** by this proposal.

Bolt v4.6 ships a built-in `Assistant` class that intercepts all DM thread messages when registered. The Assistant middleware swallows matching events (does NOT call `next()`), so existing `message` event listeners for DMs become unreachable once an Assistant is registered — they are replaced, not augmented.

## Goals / Non-Goals

**Goals:**
- Register Bolt's `Assistant` to handle all DM interactions natively
- Use `setStatus()` for thinking indicators in assistant threads (replaces emoji/message for DMs)
- Use `setSuggestedPrompts()` on thread start for discoverability
- Use `setTitle()` to label threads with a summary after the first response
- Support `send_to_thread` in assistant threads (post to the channel the user was viewing)
- Update `buildDeliveryContext()` so Claude knows when it's in an assistant thread

**Non-Goals:**
- Changing how reactions work (DM-first flow stays intact)
- Changing how @mentions work
- Removing DM delivery preference, settings modal, or synthesis flow
- Implementing `threadContextChanged` beyond the default context store behavior
- Custom thread context store (default metadata-based store is sufficient)

## Decisions

### 1. Assistant registration replaces DM handlers

Register `app.assistant(new Assistant({...}))` in `app.ts`, gated on `config.directMessages.enabled`. This replaces:
- `registerDirectMessageHandler` — new top-level DMs now arrive as `userMessage`
- `registerThreadReplyHandler` — DM thread replies also arrive as `userMessage`

The DM-first reaction flow in `dmActions.ts` continues to work because it uses `app.action()` handlers (button clicks), not `app.event("message")` listeners.

### 2. threadStarted handler

When a user opens a new assistant thread:
1. Call `saveThreadContext()` to persist the channel context (`channel_id`)
2. Call `setSuggestedPrompts()` with example prompts
3. Do NOT send a greeting message or auto-create a session — wait for the first actual message

### 3. userMessage handler

When a user sends a message in an assistant thread:
1. Call `setStatus("Thinking...")`
2. Extract the saved thread context's `channel_id` (via `getThreadContext()`)
3. Call `processMessage()` with `triggerType: "directMessages"`
4. After `processMessage` resolves, call `setTitle()` with a truncated version of the user's question

`setStatus` and `setTitle` are called in the handler, not inside `processMessage`, because these Bolt utilities are only available in the assistant middleware context.

### 4. Session fields: `assistantOriginChannelId` and `assistantCurrentChannelId`

Add two optional fields to `SessionContext`:
- `assistantOriginChannelId` — the channel the user was viewing when they first opened the assistant thread. Set once in `threadStarted` or on first `userMessage`. Never changes.
- `assistantCurrentChannelId` — the channel the user is currently viewing. Updated on every `threadContextChanged` and `userMessage`.

`assistantOriginChannelId` tells `buildDeliveryContext()` that this is an assistant thread session. `send_to_thread` uses `assistantCurrentChannelId` (so it posts to wherever the user is now, not where they were when they started the thread).

These are distinct from `originChannel` (which is set by the DM-first reaction flow and refers to the channel where the reaction was added).

### 5. send_to_thread: dual-mode

The `send_to_thread` handler in `dmActions.ts` already handles the DM-first reaction case (uses `originChannel` + `originThreadTs`). Extend it with a fallback:
- If `session.originChannel` exists → post to that channel thread (existing behavior)
- Else if `session.assistantCurrentChannelId` exists → post to that channel as a **top-level message** (new behavior, no thread_ts since we don't have one). Uses `assistantCurrentChannelId` so it targets wherever the user is now.
- Else → error, no destination

The `auto: true` path (`autoSendToThread`) works the same way — check both fields.

### 6. buildDeliveryContext update

Update `buildDeliveryContext()` in `claude.ts` to handle three modes:
1. **DM-first** (`session.dmChannel && session.originChannel`): existing behavior, `send_to_thread` shares to original thread
2. **Assistant** (`session.assistantOriginChannelId`): new — tell Claude it's in a private assistant thread, `send_to_thread` shares to the channel the user is currently viewing
3. **In-channel** (reactions thread / mentions): existing behavior, no `send_to_thread`

### 7. Manifest changes

Already done. The manifest generator adds assistant scopes/events/features gated on `config.directMessages.enabled`.

### 8. Debug code cleanup

Remove the temporary `Assistant` registration and raw `slack_event` listener from `app.ts` that were added during the `app_mention` investigation.

## Risks / Trade-offs

- **Manifest must be regenerated** → Users must regenerate their manifest and reinstall the Slack app.
- **`setTitle` quality** → Simple truncation of the user's question may produce poor titles. Acceptable for v1.
- **`send_to_thread` posts top-level in assistant mode** → In the assistant flow, we only know the channel, not a specific thread. The post goes as a top-level message. This differs from the DM-first flow where it threads onto the original message.
- **Streaming in assistant threads** → `SlackStreamer` uses `chat.startStream` which may or may not work in assistant DM threads. If it fails, the `hasFailed` fallback posts via `chat.postMessage` which works in any DM channel.
