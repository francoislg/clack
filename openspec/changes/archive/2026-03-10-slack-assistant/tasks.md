## 1. Manifest Generation

- [x] 1.1 Verify `scripts/generate-manifest.ts` correctly adds `assistant:write` scope, `assistant_thread_started` and `assistant_thread_context_changed` events, and `features.assistant_view` when direct messages are enabled (already done — just verify)

## 2. Session Model

- [x] 2.1 Add optional `assistantOriginChannelId` field to `SessionContext` in `src/sessions.ts` — the channel the user was viewing when they opened the assistant thread (set once, never changes)
- [x] 2.2 Add optional `assistantCurrentChannelId` field to `SessionContext` in `src/sessions.ts` — the channel the user is currently viewing (updated on context changes)

## 3. Assistant Handler

- [x] 3.1 Create `src/slack/handlers/assistant.ts` with a `registerAssistant(app)` function
- [x] 3.2 Implement `threadStarted`: call `saveThreadContext()` and `setSuggestedPrompts()` with example prompts (no greeting)
- [x] 3.3 Implement `userMessage`: call `setStatus("Thinking...")`, extract `channel_id` from `getThreadContext()`, call `processMessage()` with `triggerType: "directMessages"`, then call `setTitle()` with truncated question
- [x] 3.4 Implement `threadContextChanged`: call `saveThreadContext()`, update `assistantCurrentChannelId` on the session if one exists for this thread
- [x] 3.5 In `userMessage`, store context `channel_id` on the session: set `assistantOriginChannelId` only on first message (when field is not yet set), always update `assistantCurrentChannelId`

## 4. App Registration

- [x] 4.1 In `src/slack/app.ts`, replace `registerDirectMessageHandler` and `registerThreadReplyHandler` with `registerAssistant` (still gated on `config.directMessages.enabled`)
- [x] 4.2 Remove the debug Assistant registration and raw `slack_event` listener
- [x] 4.3 Update imports: remove `directMessage`, `threadReply`, add `assistant`; remove `Assistant` class import from `@slack/bolt`

## 5. Remove Replaced Handlers

- [x] 5.1 Delete `src/slack/handlers/directMessage.ts`
- [x] 5.2 Delete `src/slack/handlers/threadReply.ts`

## 6. Update Delivery Context

- [x] 6.1 Update `buildDeliveryContext()` in `src/claude.ts` to handle assistant thread sessions: when `session.assistantOriginChannelId` is set (and no `originChannel`), tell Claude it's in a private assistant thread and that `send_to_thread` shares the answer to the channel

## 7. Extend send_to_thread

- [x] 7.1 In `src/slack/handlers/dmActions.ts`, update the `send_to_thread` handler to fall back to `session.assistantCurrentChannelId` when `originChannel` is not set — post as a top-level message (no thread_ts)
- [x] 7.2 Update `autoSendToThread()` in `dmActions.ts` with the same fallback logic

## 8. Channel Message Reading

- [x] 8.1 Create `src/tools/query/fetchChannelMessages.ts` — a `fetch_channel_messages` tool that calls `conversations.history` with `channel_id` (required), `limit` (optional, default 20), `oldest`/`latest` (optional timestamps), and `include_threads` (optional, default false). Resolve user names and transform mentions. Return messages with user, text, ts, is_bot fields.
- [x] 8.2 Register `fetch_channel_messages` in `src/tools/server.ts` — gated on `slackClient` presence (same block as `fetch_slack_message`)
- [x] 8.3 Update delivery context in `buildDeliveryContext()` to tell Claude the channel ID and that it can use `fetch_channel_messages` to read messages from it

## 9. Verification

- [x] 9.1 `npm run build` — clean compilation
- [ ] 9.2 Regenerate manifest and verify it includes assistant fields
- [ ] 9.3 Test: open assistant thread, receive suggested prompts, send message, get response
- [ ] 9.4 Test: send_to_thread from assistant thread posts to the channel
- [ ] 9.5 Test: reaction trigger with DM preference still works (DM-first flow unchanged)
- [ ] 9.6 Test: reaction trigger with thread preference still works
