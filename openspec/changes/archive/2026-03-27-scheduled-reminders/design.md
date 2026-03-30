## Context

Clack currently has no way to schedule future messages. Users want to say things like "remind #ops tomorrow at 3pm to check the deploy dashboard" and have Clack post the message at the right time.

Slack provides `chat.scheduleMessage` (stable, bot-token compatible, covered by existing `chat:write` scope) and companion methods for listing and cancelling. The deprecated `reminders.add` API was considered but rejected — it requires user tokens, is degraded, and could be removed at any time.

The feature is opt-in via config since not all deployments want their bot scheduling messages.

## Goals / Non-Goals

**Goals:**
- Allow users to schedule messages to channels through natural conversation with Claude
- Allow users to list and cancel pending scheduled messages
- Resolve relative time expressions ("tomorrow at 3pm") using the requesting user's Slack timezone
- Gate the feature behind a config flag

**Non-Goals:**
- Recurring/repeating reminders (Slack API doesn't support this)
- Personal reminders (Slack's Reminders API is deprecated)
- Scheduling beyond 120 days (Slack API hard limit)
- Role-gating — all users can schedule messages
- Persistence — Slack is the source of truth for pending messages

## Decisions

### Use `chat.scheduleMessage` over `reminders.add`
The Reminders API (`reminders.add`) has been deprecated since March 2023, requires user tokens (Clack uses bot tokens), and Slack describes it as "degraded or useless." `chat.scheduleMessage` is stable, works with bot tokens, and uses the existing `chat:write` scope.

**Trade-off:** 120-day scheduling limit. Accepted as reasonable for v1 — Claude communicates this to the user when they request something beyond the window.

### Direct execution, not staged intent
Action tools like `propose_change` use a staged intent → confirm button flow. For reminders, this adds friction without much safety benefit. The tools execute immediately like `upload_file`. Claude confirms what it did in its response.

### Three separate tools instead of one multi-mode tool
`schedule_reminder`, `list_reminders`, and `cancel_reminder` are separate tools rather than a single tool with a mode parameter. This gives Claude clearer affordances and keeps each tool's schema simple.

### No persistence layer
`chat.scheduledMessages.list` returns all pending scheduled messages directly from Slack. No need for a local store. The list includes all messages scheduled by the bot — not filtered by requesting user. Claude can infer ownership from the attributed message text (`🔔 Reminder from <@U123>: ...`).

### User timezone from `UserInfo` cache
The existing `users.info` call already happens for user resolution. Adding `tz` to the `UserInfo` interface means timezone is available in the tool context without an extra API call. Claude uses this to convert relative times to UTC `post_at` timestamps.

### Config flag on top-level Config, not nested under slack
`allowScheduledMessages: boolean` (default `false`) on the `Config` interface. This is a feature toggle, not a Slack-specific setting. The manifest generator reads it to know no extra scopes are needed (the feature uses existing `chat:write`).

### Attributed message format
Scheduled messages include attribution so channel members know who requested it and why it appeared:

```
🔔 Reminder from <@U0123USER>:
Check the dashboard after the deploy freeze lifts.
```

Claude constructs this format. The `<@U...>` tag renders as a clickable mention in Slack and doubles as a machine-parseable owner identifier for `list_reminders`.

## Risks / Trade-offs

- **120-day limit** → Claude tells the user. No workaround without an internal scheduler (potential v2).
- **30 messages per channel per 5-minute window** → Unlikely to hit in practice. Claude returns the Slack error if it happens.
- **No recurring reminders** → Out of scope. `chat.scheduleMessage` doesn't support recurrence.
- **Attribution parsing is fragile** → If someone manually schedules a message via Slack API without the attribution format, `list_reminders` can't determine the owner. Acceptable since all messages flow through Clack's tool.
- **Bot must be in the channel** → `chat.scheduleMessage` requires the bot to be a member of the target channel. Claude returns a clear error if it's not.
