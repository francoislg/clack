## Why

When a user edits the message that triggered Clack (e.g., fixing a typo, rephrasing a question, or removing the @mention entirely), Clack has no way to cancel the in-flight request. The original query runs to completion, wasting resources and delivering a stale answer based on the pre-edit text. Users need the ability to cancel or restart requests by editing their triggering message.

## What Changes

- Add an **in-flight request registry** that tracks active Claude invocations per thread, holding an `AbortController` for each
- Wire `AbortController` into **query mode** (`askClaude`) — currently only worker mode supports abort
- Add a **`message_changed` event handler** that detects edits to triggering messages and:
  - **Aborts + restarts** if the edit still contains a bot mention (mentions mode) or is a DM
  - **Aborts without restart** if the bot mention was removed from the message
  - **Ignores** the edit if no in-flight request exists (Claude already finished)
- **Clean up** on abort: remove thinking indicators and reset session state
- **Reactions mode is excluded** — the reactor is not the message author, so edits don't apply

## Capabilities

### New Capabilities
- `request-cancellation`: Cancelling in-flight Claude requests via message edits, including the in-flight registry, abort lifecycle, and restart-on-edit behavior

### Modified Capabilities
- `slack-message-trigger`: DM and mention handlers must register/deregister in-flight requests and accept abort signals
- `session-management`: Sessions must handle aborted invocations (partial state cleanup, thinking indicator removal)

## Impact

- **src/claude.ts** — `askClaude()` must accept and use an `AbortController`
- **src/slack/handlers/** — New `messageChanged.ts` handler; updates to `mention.ts`, `directMessage.ts`, `threadReply.ts` to register in-flight state
- **src/slack/state.ts** or new module — In-flight request registry
- **src/slack/app.ts** — Register the new `message_changed` handler
- **src/sessions.ts** — Cleanup logic for aborted sessions
