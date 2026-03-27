## Why

Users want Clack to schedule reminders — "remind #ops tomorrow at 3pm to check the deploy dashboard." Currently there's no way to schedule future messages through Clack. Slack's own `/remind` works but isn't accessible programmatically for Bolt apps (the Reminders API is deprecated). `chat.scheduleMessage` is the stable, supported path.

## What Changes

- Add three new MCP tools: `schedule_reminder` (schedules a message), `list_reminders` (lists pending scheduled messages), `cancel_reminder` (cancels a pending scheduled message)
- Add `tz` field to the `UserInfo` cache (extracted from existing `users.info` calls) so Claude can resolve relative times ("3pm") to UTC timestamps in the user's timezone
- Add `allowScheduledMessages` config flag (default `false`) to gate tool availability
- Add timezone context to the system prompt so Claude knows how to handle time expressions
- Tools are direct-execution (no staged intent / confirm button) and available to all roles

## Capabilities

### New Capabilities
- `scheduled-messages`: Schedule, list, and cancel future messages in Slack channels via `chat.scheduleMessage`

### Modified Capabilities
- `clack-tools`: Register three new tools in the tool server, gated by config flag and Slack client availability
- `user-context`: Add timezone field to UserInfo, populated from existing `users.info` response

## Impact

- **Config**: New `allowScheduledMessages` boolean field on `Config`
- **Slack API**: Uses `chat.scheduleMessage`, `chat.scheduledMessages.list`, `chat.deleteScheduledMessage` — all covered by existing `chat:write` scope (no manifest changes needed)
- **Tools**: Three new tool files in `src/tools/query/` and `src/tools/actions/`
- **UserInfo**: Extended with `tz` field; `users.info` already fetched, just need to extract the field
- **System prompt**: Addition for timezone handling and 120-day limit awareness
