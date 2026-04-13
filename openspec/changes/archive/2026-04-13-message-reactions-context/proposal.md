## Why

Slack messages carry reaction data (emoji name + list of users who reacted), but Clack discards it entirely. Claude has no visibility into reactions — not in thread context, not via tools. Reactions carry useful signal: sentiment, consensus, acknowledgment, bot activity.

Separately, `fetchChannelMessages` maintains its own message formatting pipeline (`formatMessage()`) that duplicates the extraction logic in `fetchThreadContext()` — text, blocks, attachments, images, files, user resolution. Adding reactions (or any future enrichment) requires changes in two places. Unifying these paths makes reactions a one-time addition and prevents future divergence.

## What Changes

- Extract `msg.reactions` from Slack API responses into `ThreadMessage`, resolving reactor user IDs to usernames via the existing `resolveUsers()` cache
- Format reactions in thread context (system prompt) alongside existing attachments/images/files
- Surface reactions in `fetch_slack_message` and `fetch_channel_messages` tool output
- Unify `fetchChannelMessages`'s per-message extraction to reuse the shared `ThreadMessage` pipeline instead of its own `formatMessage()`, keeping only tool-specific concerns (thread reply expansion, channel-level pagination) separate

## Capabilities

### New Capabilities

_None — this extends existing capabilities._

### Modified Capabilities

- `session-management`: `ThreadMessage` gains a `reactions` field; thread context formatting includes reactions
- `clack-tools`: `fetch_slack_message` tool output includes reactions per message
- `channel-context`: `fetch_channel_messages` tool output includes reactions per message

## Impact

- `src/sessions.ts` — new `MessageReaction` type, new field on `ThreadMessage`
- `src/slack/messagesApi.ts` — reaction extraction in `fetchThreadContext()`, shared message extraction function
- `src/claude/promptBuilder.ts` — reaction formatting in `formatThreadContext()`
- `src/tools/query/fetchSlackMessage.ts` — include reactions in tool output
- `src/tools/query/fetchChannelMessages.ts` — refactor to use shared extraction, reactions come for free
