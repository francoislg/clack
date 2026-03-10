## Why

Slack's Agents & Assistants API provides a native chatbot experience (dedicated chat panel, typing indicators, suggested prompts, thread titles). Clack's current DM handling uses raw `message.im` events and manual thinking indicators, missing these UX features. Additionally, enabling the Agents & Assistants feature on the Slack app settings page appears to break `app_mention` event delivery when the app doesn't handle the required assistant events — making adoption non-optional.

## What Changes

- Register a Bolt `Assistant` to handle DM interactions via the native assistant flow (`threadStarted`, `userMessage`, `threadContextChanged`)
- Use `setStatus()` for thinking indicators and `setSuggestedPrompts()` for thread greeting in assistant threads
- Use `setTitle()` to label threads after the first response
- Remove `directMessageHandler` and `threadReplyHandler` — replaced by the Assistant's `userMessage` handler
- Remove debug Assistant registration and raw socket event listener from `app.ts`
- Update `buildDeliveryContext()` in `claude.ts` to handle assistant thread sessions (no `originChannel`, use assistant context `channel_id` for `send_to_thread`)
- Extend `send_to_thread` handler in `dmActions.ts` to support assistant threads (fall back to assistant context `channel_id` when no `originChannel`)

**Unchanged:**
- Reactions: DM-first flow, synthesis, send_to_thread, user preference — all unchanged
- @Mentions: unchanged
- Manifest generation: already done (assistant scopes/events/features gated on `directMessages.enabled`)
- All DM-related code in `dmResponse.ts`, `dmActions.ts`, `sessions.ts`, `userPreferences.ts`, `homeTab.ts` — kept as-is

## Capabilities

### New Capabilities
- `slack-assistant`: Slack Agents & Assistants API integration — native chatbot experience with status indicators, suggested prompts, and thread titles

### Modified Capabilities
- `manifest-generation`: Add assistant-related scopes, events, and features to the generated manifest (already done)
- `slack-message-trigger`: DM handling moves from raw message events to the Assistant API; reactions and mentions unchanged

## Impact

- **Code**: `src/slack/app.ts` (assistant registration), new `src/slack/handlers/assistant.ts`, delete `src/slack/handlers/directMessage.ts` and `src/slack/handlers/threadReply.ts`, modify `src/claude.ts` (`buildDeliveryContext`), modify `src/slack/handlers/dmActions.ts` (`send_to_thread` fallback)
- **Config**: `config.directMessages.enabled` still gates assistant registration and manifest fields
- **Dependencies**: No new deps — `@slack/bolt` v4.6 already includes `Assistant` class
- **Manifest**: Already updated — users must regenerate manifest and reinstall Slack app
- **Session model**: Two new optional fields on `SessionContext`: `assistantOriginChannelId` (channel when thread was opened, immutable) and `assistantCurrentChannelId` (channel user is currently viewing, updated on context changes)
