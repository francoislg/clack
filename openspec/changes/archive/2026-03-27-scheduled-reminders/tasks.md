## 1. Config & UserInfo

- [x] 1.1 Add `allowScheduledMessages` boolean field to `Config` interface and parse it in `loadConfig()` (default `false`)
- [x] 1.2 Add `tz` field to `UserInfo` interface and populate it from `result.user.tz` in the `getUserInfo()` function
- [x] 1.3 Add `allowScheduledMessages` to `ConfigFeatures` in `generate-manifest.ts` and log it in output (no new scopes needed)

## 2. Tool Implementation

- [x] 2.1 Create `src/tools/actions/scheduleReminder.ts` — `schedule_reminder` tool that calls `chat.scheduleMessage` with attributed message format
- [x] 2.2 Create `src/tools/query/listReminders.ts` — `list_reminders` tool that calls `chat.scheduledMessages.list` with optional channel filter
- [x] 2.3 Create `src/tools/actions/cancelReminder.ts` — `cancel_reminder` tool that calls `chat.deleteScheduledMessage`

## 3. Tool Registration

- [x] 3.1 Add `allowScheduledMessages` to `QueryToolContext` interface in `src/tools/types.ts`
- [x] 3.2 Register the three tools in `buildQueryTools()` in `src/tools/server.ts`, gated by `allowScheduledMessages && ctx.slackClient`
- [x] 3.3 Pass `allowScheduledMessages` from config when building the tool context in `src/tools/context.ts`

## 4. System Prompt

- [x] 4.1 Add user timezone to Claude's prompt context so it can resolve relative time expressions to UTC
- [x] 4.2 Add scheduling instructions to the system prompt (120-day limit, attribution format, timezone handling)

## 5. Tests

- [x] 5.1 Add tests for `schedule_reminder` tool (success, time errors, channel resolution)
- [x] 5.2 Add tests for `list_reminders` tool (with/without channel filter, empty list)
- [x] 5.3 Add tests for `cancel_reminder` tool (success, invalid ID)
- [x] 5.4 Verify `tz` field is populated in `UserInfo` tests
