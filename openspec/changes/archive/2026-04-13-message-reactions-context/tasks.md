## 1. Data Model

- [x] 1.1 Add `MessageReaction` interface to `src/sessions.ts` (`emoji: string`, `userIds: string[]`, `usernames?: string[]`)
- [x] 1.2 Add optional `reactions?: MessageReaction[]` field to `ThreadMessage`

## 2. Shared Message Extraction

- [x] 2.1 Extract per-message building logic from `fetchThreadContext()` into a standalone `buildThreadMessage()` function in `messagesApi.ts`
- [x] 2.2 Include reaction extraction in `buildThreadMessage()` — map `msg.reactions` to `MessageReaction[]`, omit field when no reactions
- [x] 2.3 Resolve reactor user IDs to usernames in `fetchThreadContext()` by collecting them alongside message author IDs in the batch `resolveUsers()` call
- [x] 2.4 Verify existing `messagesApi.test.ts` tests still pass after extraction refactor

## 3. Prompt Formatting

- [x] 3.1 Add reaction formatting in `formatThreadContext()` in `promptBuilder.ts` — append `[reactions: :emoji: by @user, @user; ...]` line when reactions present
- [x] 3.2 Add tests in `promptBuilder.test.ts` for reaction formatting (with reactions, without reactions, multiple emojis)

## 4. fetch_slack_message Tool

- [x] 4.1 Include `reactions` in the message output mapping in `fetchSlackMessage.ts` (omit when empty, same pattern as images/files)
- [x] 4.2 Add test in `fetchSlackMessage.test.ts` verifying reactions appear in tool output

## 5. Unify fetchChannelMessages

- [x] 5.1 Refactor `fetchChannelMessages.ts` to use `buildThreadMessage()` for per-message extraction instead of its own `formatMessage()`
- [x] 5.2 Keep thread reply expansion and pagination logic in `fetchChannelMessages.ts`
- [x] 5.3 Verify reactions flow through to `fetch_channel_messages` tool output
- [x] 5.4 Verify existing `fetchChannelMessages.test.ts` tests still pass after refactor
- [x] 5.5 Add test in `fetchChannelMessages.test.ts` verifying reactions appear in tool output

## 6. Type Check and Integration

- [x] 6.1 Run `npx tsc` to verify no type errors
- [x] 6.2 Run full test suite (`npm test`) to verify no regressions
