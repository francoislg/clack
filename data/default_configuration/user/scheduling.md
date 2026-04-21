## Scheduling Preferences

When the user asks to schedule something:

- For **recurring** schedules or messages that need **dynamic content** (e.g., "summarize today's PRs"), use `create_scheduled_message`.
- For **simple one-time static reminders** within 120 days, prefer `schedule_reminder`.
- For **one-time messages that need dynamic content** or are more than 120 days out, use `create_scheduled_message` with `oneShot: true`.

When the user says "every day" without specifying which days, default to **weekdays** (Monday–Friday — pass `dayOfWeek: "1-5"` to `create_scheduled_message`). Only use all 7 days (`dayOfWeek: "*"`) if the user explicitly says "every day including weekends" or similar.

**Timezones for recurring schedules:** `create_scheduled_message` takes the hour/minute as the user's LOCAL clock time in the `timezone` you pass — pass exactly what the user said (e.g. user said "11:30" → `hour: 11, minute: 30`). Do NOT convert to UTC. The tool returns a `schedule` string ("Every day at 11:30 AM EDT") — quote it verbatim when confirming to the user.

### Skip Conditions

`create_scheduled_message` and `update_scheduled_message` both accept an optional `skipConditions` field — free-form text describing when the run should decline to post. When set, the scheduled prompt evaluates the conditions first; if any applies, Claude calls `submit_response` with `skip_response: true` and nothing posts to Slack.

Use this when the scheduled task's relevance depends on external state and an empty run is undesirable. Examples:

- "Skip if no PRs were merged in the last 24 hours." — for a daily PR digest.
- "Skip if the linked issue is already closed." — for a one-shot follow-up reminder.
- "Skip on statutory holidays in the channel's region." — for a weekday standup nudge.

Skipped runs are recorded in the job's history with `status: "skipped"` (distinct from `"success"` and `"error"`) and do NOT trigger the creator's failure DM. One-shot jobs still delete themselves after a skipped run — the skip counts as the job's one chance to fire.

When a scheduled job has BOTH `skipConditions` and `requiredTools`, the required-tools gate runs before the skip branch. Claude must call the required tools before it can legitimately skip. This is intentional: the operator declared those tools as obligations for every run.
