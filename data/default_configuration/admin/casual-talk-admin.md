## Managing the Casual-Talk Plugin

When an admin asks about casual-talk — adding channels, changing the chattiness rate, enabling/disabling, etc. — call `attach_integration("casual-talk:management")` to load the management tool surface. The tools are admin-gated.

### Tools available after attach

- `set_casual_talk_config` — replace the entire config in one call
- `add_channel(id, promptSuggestion?)` — add a candidate channel (optionally with a per-channel character hint)
- `remove_channel(id)` — remove a channel from the candidate list
- `set_channel_prompt_suggestion(id, promptSuggestion)` — update the per-channel hint (empty string clears)
- `add_small_talk_topic(topic)` / `remove_small_talk_topic(topic)` — manage fallback opener ideas
- `set_expected_rate({ rate? | die? })` — set a named rate (`hourly`/`2-per-day`/`daily`/`2-per-week`/`weekly`) OR an explicit `die` size
- `set_work_hours({ start, end, tz, days })` — when the plugin may fire
- `enable()` / `disable()` — flip the plugin on/off (idempotent)

Each mutation triggers a soft restart so the new config takes effect immediately.

### The "rate is total" caveat

When discussing chattiness with an admin, remember that `expectedRate` is **total across all configured channels**, not per-channel. With `daily` and 5 channels, the workspace sees ~1 post/day total spread across the 5 channels, i.e. ~1 per channel every 5 days. Mention this when an admin sets a low rate with many channels — they may expect higher per-channel volume.

### How fires work

On every cron tick within `workHours`, the plugin rolls a die of size `N` (computed from `expectedRate` + workHours, or the explicit `die` override). On a `1`, Claude proceeds to evaluate the candidate channels; on anything else, the run skips silently with no post. This is by design — most fires are silent.

When the roll hits, Claude reads recent messages from each candidate channel, picks the one that feels most natural to drop into, and posts via `post_to` with the channel-specific tone (using the `promptSuggestion` hint if set). If no channel is a good fit, Claude skips without posting — also by design.

### Common admin asks

- "Add #lunch to casual-talk" → `add_channel({ id: "C…" })`
- "Make it post more often" → `set_expected_rate({ rate: "hourly" })` or `{ rate: "2-per-day" }`
- "Make it post less" → `set_expected_rate({ rate: "weekly" })` or a larger `die`
- "Casual-talk is being annoying" → `disable()`
- "What channels is casual-talk in?" → read `data/plugins/casual-talk/config.json` and report

### Reading current state

Read `data/plugins/casual-talk/config.json` directly to see the current configuration. The file is the source of truth; the tools mutate it and trigger a restart.
