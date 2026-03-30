## Why

Users need Clack to perform recurring tasks autonomously — daily PR summaries, weekly standup reminders, one-off future messages. Today, `schedule_reminder` only handles static one-shot messages via Slack's API (120-day limit). There's no way to schedule recurring Claude-powered tasks that generate dynamic content at delivery time.

## What Changes

- **Cron job system**: Persistent storage for scheduled messages with cron expressions, managed via CRUD operations. Supports both recurring jobs and one-shot future messages. Jobs can be static (post text as-is) or dynamic (Claude runs at delivery time with full tool access).
- **In-process scheduler**: Tick-based scheduler (60s interval) using `cron-parser` for expression matching. Concurrency guard prevents overlapping executions. One-shot jobs auto-delete after firing.
- **Three new Claude tools**: `create_scheduled_message`, `list_scheduled_messages`, `cancel_scheduled_message` — allowing users to manage schedules through natural conversation. Claude handles ambiguous requests by asking clarifying questions.
- **Scheduled trigger type**: New `"scheduled"` trigger type that runs through `processMessage` as the creator (their role, their repos) but with `silentThinking` — no streaming UX, just the final response posted top-level to the target channel.
- **Silent thinking delivery**: `executeAndDeliver` gains a `silentThinking` mode that skips the SlackStreamer entirely. Claude runs, collects the result, and posts it as a single `chat.postMessage`. No "thinking..." indicators, no task cards.
- **Home Tab section**: Admins see all scheduled messages. Non-admins see their own. Enable/disable/delete controls.
- **Error handling**: On failure, the creator receives a DM with the error. No retries on the same tick — the job stays enabled and tries again at the next scheduled time.

## Capabilities

### New Capabilities
- `cron-messages`: Cron job storage, scheduling engine, execution pipeline, and Claude tools for managing scheduled messages

### Modified Capabilities
- `home-tab`: New Scheduled Messages section with role-based visibility and management controls
- `clack-tools`: Three new query/action tools for scheduled message management, gated by config flag
- `streaming-responses`: Support for `silentThinking` mode that bypasses the SlackStreamer and posts the final result directly

## Impact

- **New dependency**: `cron-parser` npm package for cron expression matching
- **New state file**: `data/state/cron-jobs.json`
- **Config**: New `allowScheduledMessages` flag (already exists for the reminder tools — may reuse or add separate flag)
- **Types**: New `"scheduled"` added to `TriggerType`
- **Delivery layer**: `executeAndDeliver` in `handlerResponse.ts` gains `silentThinking` parameter
- **Process lifecycle**: Scheduler starts on boot, loads jobs from disk, stops on shutdown
