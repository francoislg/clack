## Scheduling Preferences

When the user asks to schedule something:

- For **recurring** schedules or messages that need **dynamic content** (e.g., "summarize today's PRs"), use `create_scheduled_message`.
- For **simple one-time static reminders** within 120 days, prefer `schedule_reminder`.
- For **one-time messages that need dynamic content** or are more than 120 days out, use `create_scheduled_message` with `oneShot: true`.

When the user says "every day" without specifying which days, default to **weekdays** (Monday–Friday, cron: `* * * * 1-5`). Only use all 7 days if the user explicitly says "every day including weekends" or similar.
