## 1. In-Flight Request Registry

- [x] 1.1 Create `src/slack/inFlightRequests.ts` with `InFlightRequest` type, `Map<string, InFlightRequest>` store, and `register()` / `deregister()` / `get()` functions keyed by `"channelId:messageTs"`
- [x] 1.2 Export a `ThinkingState`-compatible interface from the registry (or re-export from core) so the abort handler can clean up indicators

## 2. AbortController in Query Mode

- [x] 2.1 Add optional `abortController?: AbortController` to `AskClaudeOptions` in `src/claude.ts`
- [x] 2.2 Pass `abortController` through to the Agent SDK `query()` options in `askClaude()`
- [x] 2.3 Handle `AbortError` in `askClaude()` catch block — return a distinguishable "cancelled" response (e.g. `{ success: false, cancelled: true }`) instead of treating it as an error

## 3. Wire Registry into processMessage

- [x] 3.1 In `processMessage()` (`src/slack/handlers/core.ts`), create an `AbortController` before calling `askClaude()`
- [x] 3.2 Register the in-flight request (with abort controller, session ID, trigger type, and thinking state) after showing thinking feedback but before calling `askClaude()`
- [x] 3.3 Deregister the in-flight request in a `finally` block after `askClaude()` completes
- [x] 3.4 When `askClaude()` returns a cancelled response, skip response posting and error handling (the message_changed handler handles cleanup)

## 4. Message Changed Handler

- [x] 4.1 Create `src/slack/handlers/messageChanged.ts` that listens for `message` events with `subtype === "message_changed"`
- [x] 4.2 Extract `channel`, `message.ts`, `message.text`, and `previous_message.text` from the event
- [x] 4.3 Look up the in-flight registry by `"channel:message.ts"` — if no match, return early
- [x] 4.4 Abort the in-flight request and clean up thinking indicator (remove emoji or delete message)
- [x] 4.5 For mentions: check if new text contains `<@BOT_ID>` — if yes, strip mention and restart via `processMessage()`; if no, cancel only
- [x] 4.6 For DMs: restart via `processMessage()` with new text (unless empty)
- [x] 4.7 Cache bot user ID on first use (avoid repeated `client.auth.test()` calls)

## 5. Register Handler in App

- [x] 5.1 Import and call `registerMessageChangedHandler(app)` in `src/slack/app.ts` — register when either DMs or mentions are enabled

## 6. Testing

- [x] 6.1 Verify `message_changed` event is received in Socket Mode for both channel messages and DMs
- [x] 6.2 Test: edit @mention message while in-flight → aborts and restarts with new text
- [x] 6.3 Test: remove @mention from message while in-flight → aborts without restart
- [x] 6.4 Test: edit DM while in-flight → aborts and restarts with new text
- [x] 6.5 Test: edit message after Claude has responded → no effect (registry miss)
- [x] 6.6 Test: rapid successive edits → only the latest edit's text is processed
