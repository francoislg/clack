## Context

A manual `create_scheduled_message` cron job runs today on the GCP-hosted Clack instance: every 15 minutes during weekday work hours, Claude rolls a 100-sided die and on a 49 it reads the channel and drops a casual comment. The whole thing — channel ID, die size, scenario branching, persona instruction — lives in the prompt of one cron job. Adding a second target channel duplicates the entire job. Tuning chattiness requires hand-editing the die in the prompt. The persona instruction can't be edited without rewriting the prompt. Admins can't see what's configured without reading the raw cron-jobs.json.

Promoting this into a first-class plugin gives:

- A typed config (`data/plugins/casual-talk/config.json`) that admins can read and tools can mutate.
- A candidate-channel list — one cron job covering many channels, with the plugin deciding "where to drop in" at fire time.
- A user-friendly "chattiness" axis (`expectedRate`) that the plugin translates to a roll-die size based on actual work-hour ticks.
- An admin MCP surface to add/remove channels, change the rate, edit topics, and enable/disable — all from Slack.
- A persona topic that admins can override on disk without touching the plugin's code.

This change depends on `channelless-cron-jobs`. The plugin needs to fire on a schedule but decide the destination channel at fire time, which requires `CronJob.channel` to be optional. Without that capability, the SDK's `validateCronJobSpec` rejects the channelless spec.

## Goals / Non-Goals

**Goals:**

- One plugin folder containing all casual-talk logic — no imports outside `src/plugins/casual-talk/**` (per plugin hard rules).
- Config schema is the single source of truth — both the file loader and the admin tools validate against the same Zod schema.
- Heuristic is testable and obvious: given workHours, every named rate maps to a deterministic die size.
- Persona is overridable via the topic-instructions mechanism that already exists; the plugin's `PERSONA_CONTENT` is the default, not the law.
- Every config-mutating tool surfaces the affected entity in its Slack label (`{id}`, `{rate}`, `{topic}`).
- Channelless fires are honest: the prompt tells Claude how to choose and how to deliver via `post_to`; the schema mechanically prevents `submit_response`-text mistakes (enforced by `channelless-cron-jobs`).
- Plugin works with i18n the same way trivia does — direct-to-Slack strings via `sdk.t()`, Claude-facing prompts in English.

**Non-Goals:**

- Channel ranking heuristics in the plugin (Claude reads channels at fire time and decides — no plugin-side scoring).
- Pre-fetching channel metadata via `conversations.info` in v1 — the additional API calls per fire add complexity for a marginal win; Claude can do this itself via existing tools if needed. (We were leaning toward this in earlier exploration; trade-off documented below.)
- Per-channel "use formal tone here, casual there" beyond the `promptSuggestion` string.
- Posting visual content (gifs, attachments, polls) from the casual-talk plugin itself. The persona may suggest attaching integrations when available, but no integration is named or required.
- Jitter / variance in next-fire timing (will compose with the `channelless-cron-jobs` design's forward hook when that's built).
- Multi-workspace / per-Slack-workspace config splits (Clack is single-workspace today).
- Self-service Home Tab UI for config editing (admins use the MCP tools through Slack mentions / DMs; Home Tab edits come later if needed).
- Cadence customization (`*/15` is fixed v1).

## Decisions

### Decision 1: Static prompt assembly at reconcile time, not lazy at fire time

The plugin assembles the cron job's `prompt` once at reconcile time, embedding the resolved die `N`, the candidate channel IDs, and the small-talk topics. At fire time, Claude reads the prompt, calls `fetch_channel_messages` per candidate channel as needed, evaluates, and either posts via `post_to` or skips.

**Alternatives considered:**

- Lazy prompt assembly via a per-fire hook on `CronJobSpec`: rejected — no such hook exists today, and adding one would expand the cron-job pipeline meaningfully. The marginal benefit (fresh channel metadata snapshot in the prompt) is small, and Claude can re-fetch at fire time anyway.
- Plugin-side pre-fetch of `conversations.info` and `conversations.history` at fire time: rejected for v1. This was floated in exploration but adds bidirectional complexity (the plugin needs a fire-time hook, which it doesn't have, OR it'd need to use a plugin-managed Slack listener that runs alongside the cron — both are bigger than the problem). Letting Claude call `fetch_channel_messages` is simpler and matches what already works in the manual GCP version.
- Hard-coded channel names in the prompt: rejected — names drift; IDs are stable; Claude resolves the name via Slack APIs if it wants to mention the channel naturally.

### Decision 2: `expectedRate` as named-rate sugar over a raw die

The user wanted "frontend in a user-friendly way" with named rates, but also the ability to fall back to `1/X` if the heuristic doesn't fit. We store BOTH:

- `expectedRate` (named) — the friendly knob admins turn.
- `die` (number, optional override) — the precise knob power users turn.

When `die` is set, it wins. When `die` is absent, the heuristic maps `expectedRate × workHours → die`. The resolved die is embedded in the prompt for transparency ("rate: daily ≈ 1/32").

**Alternatives considered:**

- Store only `expectedRate`, drop the override: rejected — closes the door on custom rates without simplifying anything meaningful.
- Store only `die`, drop the named rates: rejected — the named rates are the user-visible affordance; admins shouldn't have to do the workHours math themselves.

### Decision 3: One cron spec, multiple candidate channels, channelless fire

The plugin produces exactly ONE `CronJobSpec` regardless of how many channels are configured. The single spec is channelless; the candidate list lives in the prompt. Reasons:

- It matches the user's stated rate semantics: `expectedRate: "daily"` means "~1 post per day TOTAL across all configured channels," not per channel.
- It scales linearly without the cron scheduler having to know about candidate sets.
- It composes cleanly with the future "channel selection" decisions (today: Claude reads each at fire time; future: a plugin-provided summary tool; either way, the cron-spec shape is unchanged).

The trade-off is per-channel visibility on the Home Tab — admins see "1 spec, no channel" instead of "5 channels with last-run status each." We accept this; the config file is the canonical source of truth for the channel list.

**Alternative considered:** one spec per channel, each channel-bound, each rolling its own die. Rejected — multiplies the rate by `channels.length` (a 5-channel "daily" would post 5/day, not 1/day) and produces a UX where admins see one Home Tab row per channel with mostly-skipped runs.

### Decision 4: Soft restart after every config mutation

Every config-mutating tool calls `sdk.requestSoftRestart(reason)` after persisting the change. The plugin's init function is the only place that calls `reconcileCronJobs` and assembles the prompt. Soft restart is the cleanest way to ensure both the cron spec and the prompt reflect the new config without the plugin needing a separate "re-reconcile" path.

**Alternatives considered:**

- Re-reconcile inline in each tool: rejected — the plugin would need to expose its reconcile path explicitly, and we'd have two code paths (init vs. tool-driven) that need to stay in sync.
- File watcher on `data/plugins/casual-talk/config.json`: feasible (the SDK supports `sdk.watchFile`), but soft restart is the established pattern for "config changed, re-init everything" — switching to file-watch would change the contract for other plugins later. Stay consistent.

### Decision 5: Persona is a topic instruction with the plugin shipping the default

Two ways to attach a persona for cron fires:

- (a) Inline in the cron spec's `prompt` (every fire's prompt re-states the persona).
- (b) Topic instruction pre-attached via `attachedTopics: ["casual-talk"]` (loaded at session start).

(b) wins because it makes the persona admin-overridable via the standard topic-override mechanism (`data/configuration/user/topics/casual-talk/casual-talk__persona.md`). Inline prompts can't be overridden without rebuilding the cron spec. The trivia plugin uses (b) for its persona/reveal-tone/finale-tone; we follow that pattern.

The cron spec's `prompt` then focuses on operational mechanics (die roll, channel evaluation, delivery instructions). The persona ("don't reveal automation, match channel character, vary openers") lives in the topic.

### Decision 6: Tool surface lives on an on-demand `casual-talk:management` server

The admin tools are not "always-on": they don't need to be in Claude's catalog every session. We follow trivia's pattern: declare the tools on an on-demand server (`autoload: false`) and rely on `attach_integration("casual-talk:management")` when an admin asks the bot to mutate the config. This keeps the always-on catalog lean.

**Alternative considered:** put the tools on the default server (always-on). Rejected — the tools are role-gated at `admin`, but they'd still appear in the catalog for every session, eating context window space. Trivia made the same decision; consistency wins.

### Decision 7: Defaults are conservative — config opens disabled

Plugin's first-boot defaults: `enabled: false`, `channels: []`, `expectedRate: "daily"`, no topics. Admins must explicitly enable and add channels. Reasons:

- Cold-start safety: a fresh deployment doesn't post into a random channel just because casual-talk happens to be installed.
- Discoverability: an admin notices the disabled state when checking the Home Tab plugin status and goes through enable-and-configure intentionally.
- Migration story for the GCP user: the manual cron job stays running until admins reconcile it into casual-talk; nothing posts twice in the meantime.

### Decision 8: `staticMessage` is not an option

The plugin always uses a dynamic prompt-driven cron job. There's no "static casual-talk message" mode. This dovetails with `channelless-cron-jobs`'s invariant that channelless jobs cannot be static (no Claude session = no destination decision).

## Risks / Trade-offs

- **[Risk]** Admins add 10 channels with `expectedRate: "daily"` expecting ~10 posts/day, but the rate is total. They see one post per channel every 10 days and think the plugin is broken. **Mitigation:** the prompt embeds the resolved rate ("rate: daily ≈ 1/32") for self-checking; the tool descriptions (`set_expected_rate`, `add_channel`) state explicitly that the rate is TOTAL across all configured channels; the Home Tab plugin status section can surface "die: N (~X posts/day total)" when the row is rendered.
- **[Risk]** A casual-talk post in a channel triggers Clack's `auto-respond` capability if the bot is configured to listen on that channel. The bot would reply to itself. **Mitigation:** the existing `auto-respond` capability has a `botUserId` guard (the bot ignores its own posts). Add a test that verifies a casual-talk-style post in an auto-respond-watching channel does NOT trigger another fire.
- **[Risk]** `expectedRate: "weekly"` with a 5-day work week produces a die of 160. The probability of any given tick firing is 1/160. Over a single week (160 ticks) the EXPECTED number of fires is exactly 1 — but variance is high; in practice a fraction of weeks will fire 0 times and a fraction will fire 2+ times. Admins may perceive the bot as "broken" when no post happens in a given week. **Mitigation:** document the statistical nature loudly in `set_expected_rate`'s tool description; mention "expected" rates, not "guaranteed." Future: the `jitterMinutes` hook from `channelless-cron-jobs`'s design could be paired with a "burn-down counter" mode for more even distribution, but that's a separate change.
- **[Risk]** Soft restart triggers global plugin reload, which is heavier than needed for a casual-talk config change. **Trade-off accepted:** `requestSoftRestart` is the established pattern; the perf cost is small (sub-second for a config-only change). Optimizing here would be premature.
- **[Risk]** `fetch_channel_messages` for many candidate channels at fire time is slow and chatty. **Mitigation:** the resolved die `N` is large enough that most fires skip without ever entering the per-channel-read path (roll ≠ 1 → immediate skip). When a fire does proceed, Claude reads N channels in parallel via tool calls. For ≤5 channels this is fine; for 20+ we may want a plugin-side pre-fetch tool — deferred to a follow-up.
- **[Trade-off]** No `conversations.info` pre-fetch means Claude doesn't know the channel name or purpose without fetching messages. **Trade-off accepted:** channel purposes are often empty or stale; the channel name appears in fetched messages' rendering (Claude can also call `find_channel` if it wants the name); the optional `promptSuggestion` covers the "give it a vibe hint" case. If admins find this lacking we add a `find_channel` pre-fetch step later.
- **[Trade-off]** No Home Tab editor for the config — admins use Slack tools or hand-edit the file. **Trade-off accepted:** the tool surface is fine for v1; Home Tab integration is a UX polish that doesn't change the core capability. Cron job's enable/disable button on the Home Tab still works (it flips `job.enabled`, which the plugin honors on next reconcile via the existing override semantics).
- **[Trade-off]** Replacing the existing GCP manual cron job requires admin action — disable the manual job, deploy the plugin, enable the plugin with the same channel(s). **Trade-off accepted:** there's no auto-migration from a hand-rolled `create_scheduled_message` job to a plugin-managed one (we don't know the user's intent for free-text prompts). The README or release notes document the steps.

## Migration Plan

This is a new plugin with a new config file. No data migration is required.

Rollout steps for an admin who's using the manual GCP cron job today:

1. Ship the build that includes both `channelless-cron-jobs` and `add-casual-talk-plugin`.
2. The plugin loads disabled by default — nothing fires.
3. Admin uses `set_casual_talk_config` (or individual `add_channel` / `set_work_hours` / `enable` calls) to populate the config.
4. Admin sets `enabled: true` via the `enable` tool.
5. Plugin reconciles its channelless cron spec; soft-restart triggers; new fires use the plugin path.
6. Admin deletes the old manual cron job via `delete_scheduled_message`.

Rollback: disable the plugin (`disable`). The next reconcile removes the cron spec. The old manual cron job can be recreated from the documented GCP recipe.

## Open Questions

- Do we want a quick-glance "what's the resolved die right now?" tool (`get_casual_talk_status`) for admins, or is the Home Tab row + reading the config enough? Default: skip in v1; add if friction shows up.
- Should the persona content be a single file or split (`persona-baseline.md` + `persona-channel-suggestions.md`)? Default: single file; admins can manage one override file. Splitting is over-engineering.
- Should `set_work_hours` validate the timezone via a real IANA-tz check (e.g., calling `Intl.DateTimeFormat({ timeZone: tz })` and catching errors), or trust the string? Default: real check — prevents silent breakage when an admin typos a tz.
