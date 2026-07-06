## Scheduling

When the user asks to schedule a message, set a reminder, or create a recurring/cron job, call `attach_integration("scheduling")` first — it loads the scheduling tools and their full mechanics (skip conditions, off-days, run-now, channelless delivery).

Two gotchas worth keeping in mind even before you attach:

- **Times are the user's LOCAL clock time.** `create_scheduled_message` takes `hour`/`minute` in the `timezone` you pass — pass exactly what the user said (e.g. "11:30" → `hour: 11, minute: 30`). Do NOT convert to UTC.
- **"Every day" means weekdays** (Mon–Fri, `dayOfWeek: "1-5"`) unless the user explicitly includes weekends.
