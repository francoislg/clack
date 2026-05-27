## Why

A "Random Chatter" cron job runs today on the GCP-hosted Clack instance as a hand-rolled `create_scheduled_message` setup: every 15 minutes during work hours, Claude rolls a 100-sided die, and on a 49 it reads the channel and drops a casual message. It works, but it's brittle (channel hard-coded into the prompt, dice math obtuse, no config), and replicating it to another channel means duplicating the entire prompt. Promoting it to a first-class plugin gives admins a Home-Tab-overrideable persona, an MCP surface to manage channels and "chattiness," a candidate-channel list so the bot can pick where to drop in, and clean config-driven reconciliation so adding/removing the bot from a channel is one tool call.

This proposal depends on `channelless-cron-jobs` (channel becomes optional on `CronJob` / `CronJobSpec` so the plugin can fire on a schedule without a pre-bound destination and let Claude pick from the candidate list at runtime).

## What Changes

- New plugin under `src/plugins/casual-talk/` registered through the plugin SDK (mirrors the `trivia` and `tenor-gif` plugin shape).
- Config file at `data/plugins/casual-talk/config.json`:
  - `enabled: boolean`
  - `channels: Array<string | { id: string; promptSuggestion?: string }>` — bare strings or objects with an optional per-channel `promptSuggestion`
  - `workHours: { start: number; end: number; tz: string; days: number[] }` — `start`/`end` in 0-23, `days` 0-6 (Sun=0)
  - `expectedRate: "hourly" | "2-per-day" | "daily" | "2-per-week" | "weekly"` — sugar that resolves to a die size given `workHours`
  - `die?: number` — explicit roll-die override; when set, ignores `expectedRate`
  - `smallTalkTopics: string[]` — fallback opener ideas when no recent activity exists
- Heuristic: with `*/15` cadence, `ticks_per_day = (end - start) * 4`, `ticks_per_week = ticks_per_day * days.length`. Named rates map to die sizes:
  - `"hourly"` → `ticks_per_day / 8` (≈ 4 with 9-16)
  - `"2-per-day"` → `ticks_per_day / 2` (≈ 16)
  - `"daily"` → `ticks_per_day` (≈ 32)
  - `"2-per-week"` → `ticks_per_week / 2` (≈ 80)
  - `"weekly"` → `ticks_per_week` (≈ 160)
  - `die` field, when set, wins.
- Plugin reconciles ONE `CronJobSpec` per active workspace config:
  - `cronExpression`: `*/15 <start>-<end-1> * * <days joined by ',' or as range>` (e.g. `*/15 9-16 * * 1,2,3,4,5`)
  - `channel`: **omitted** (requires `channelless-cron-jobs`)
  - `timezone`: from `workHours.tz`
  - `submitResponseMode`: `"skipped"` (channelless makes this implicit anyway; setting it explicitly makes the intent obvious)
  - `requiredTools`: `["mcp__clack__random_roll"]`
  - `attachedTopics`: `["casual-talk"]`
  - `prompt`: assembled at reconcile time, embedding the resolved die, the candidate channel IDs, and the small-talk topics
- Plugin-provided persona topic (admin-overridable):
  - `sdk.addTopicInstruction("user", "casual-talk", "persona", PERSONA_CONTENT)`
  - PERSONA_CONTENT: "Never reveal you were triggered by a roll. Tailor your post to the channel's character (read its name, purpose, last messages). If integrations are available that would enrich the post (gifs, polls, etc.), feel free to use them — but a plain-text one-liner is often the right call. Vary your openers. Keep it 1-2 sentences."
  - Override path: `data/configuration/user/topics/casual-talk/casual-talk__persona.md`
- Prompt assembly: the plugin produces a static prompt at reconcile time embedding the die size, candidate channel IDs (with their `promptSuggestion` strings when set), and the small-talk topic list. Claude calls `fetch_channel_messages` per candidate at fire time to get the per-channel context. `conversations.info` per channel is NOT used in v1 — channel character comes from the channel name + the optional `promptSuggestion` + the messages Claude fetches. (Trade-off documented in `design.md`.)
- On-demand admin MCP server `casual-talk:management` (declared via `sdk.registerMcpServer("management", { autoload: false, description: ... })`) hosting these tools (all `minRole: "admin"`):
  - `set_casual_talk_config` — replace full config
  - `add_channel(id, promptSuggestion?)`
  - `remove_channel(id)`
  - `set_channel_prompt_suggestion(id, promptSuggestion)`
  - `add_small_talk_topic(topic)`
  - `remove_small_talk_topic(topic)`
  - `set_expected_rate(rate)` — accepts a named rate or a raw `die` number
  - `set_work_hours(start, end, tz, days)`
  - `enable()` / `disable()`
- After every mutating tool call, `sdk.requestSoftRestart("casual-talk config changed")` triggers a soft restart so the cron spec is rebuilt and the prompt regenerated.
- i18n: every direct-to-Slack string (DM error notices, status messages) goes through `sdk.t()`. Plugin registers a dictionary with `en` (and `fr` if straightforward). Tool descriptions and Claude-facing prompt content stay English.
- Plugin registered in `src/plugins/index.ts` alongside the existing plugins.

## Capabilities

### New Capabilities

- `casual-talk-plugin`: the plugin's behavior — config schema, heuristic, cron-spec assembly, prompt assembly, persona topic, admin tool surface, lifecycle / soft-restart behavior.

### Modified Capabilities

(none — depends on `channelless-cron-jobs` but doesn't itself modify other capabilities)

## Impact

- **New code under `src/plugins/casual-talk/`**:
  - `index.ts` — plugin entry; capability gate (`sdk.capabilities.crons`), register dictionary, persona topic instruction, declare on-demand management server, register admin tools, build cron spec, reconcile.
  - `config.ts` — Zod schema + load/save under `data/plugins/casual-talk/config.json`, validation, defaults.
  - `heuristic.ts` — `expectedRate × workHours → die`, plus `workHours → cronExpression`.
  - `prompt.ts` — assemble the cron spec's `prompt` from die + channels + topics.
  - `persona.ts` — exported `PERSONA_CONTENT` constant.
  - `tools/*.ts` — one file per admin tool, each tested.
  - `i18n/strings.ts` — `en` (and `fr` where natural) tables.
- **`src/plugins/index.ts`**: registration line for the new plugin.
- **Data files (not committed)**: `data/plugins/casual-talk/config.json` materializes on first save.
- **Dependency on `channelless-cron-jobs`**: this change cannot land before `channelless-cron-jobs` ships (the plugin's `reconcileCronJobs` call omits `channel`, which the SDK rejects today). Marked explicitly in `tasks.md`.
- **No core changes**: all new code lives inside the plugin folder. No imports outside `src/plugins/casual-talk/**`, per `src/plugins/CLAUDE.md`'s hard rules.
- **No tool registry / catalog changes**: the management tools live on the plugin's on-demand server (`mcp__casual-talk_management__*`); they're invisible until an admin attaches the integration.
- **Tests**: heuristic math (every named rate × multiple workHours configs), cron-expression builder, prompt-assembly snapshot, config schema validation, every admin tool, reconcile flow (one spec produced, channelless).
