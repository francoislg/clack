## Purpose

The `casual-talk` plugin provides scheduled autonomous Slack messaging, allowing the bot to post casual conversation snippets to configured channels at configurable cadences without requiring explicit user triggers.
## Requirements
### Requirement: Plugin Registration and Capability Gating

The `casual-talk` plugin SHALL be registered alongside existing Clack plugins (`src/plugins/index.ts`) and SHALL refuse to load when the host's cron scheduler is disabled.

#### Scenario: Plugin loads when crons are enabled

- **GIVEN** `sdk.capabilities.crons === true`
- **WHEN** the casual-talk plugin's init runs
- **THEN** it registers its dictionary, persona topic instruction, on-demand management server, admin tools, and reconciles its cron spec
- **AND** the plugin's `errors` array is empty

#### Scenario: Plugin refuses to load when crons are disabled

- **GIVEN** `sdk.capabilities.crons === false`
- **WHEN** the casual-talk plugin's init runs
- **THEN** it calls `sdk.error("Casual-talk requires the cron scheduler. Enable it via `config.cron.enabled: true`.")` and returns immediately
- **AND** no tools or instructions are registered
- **AND** no cron spec is reconciled

### Requirement: Plugin Config File

The plugin SHALL persist its config at `data/plugins/casual-talk/config.json`. The file SHALL be validated by a Zod schema with the shape:

```ts
interface CasualTalkConfig {
  enabled: boolean;
  channels: Array<string | { id: string; promptSuggestion?: string }>;
  workHours: { start: number; end: number; tz: string; days: number[] };
  expectedRate: "hourly" | "2-per-day" | "daily" | "2-per-week" | "weekly";
  die?: number;
  smallTalkTopics: string[];
  useBuiltinFallbackTopics: boolean;
}
```

Constraints:

- `workHours.start` and `workHours.end` are integers in `[0, 23]` with `start < end` (no wrap-around v1).
- `workHours.tz` is a non-empty IANA timezone string.
- `workHours.days` is a non-empty array of integers in `[0, 6]` (Sun=0, Sat=6).
- `die`, when present, is an integer `>= 1`.
- `channels` entries that are strings or objects with `id` SHALL pass the same Slack channel ID shape check used elsewhere (`isChannelId`).
- `useBuiltinFallbackTopics` is a boolean. Its Zod schema SHALL apply a default of `true` (`z.boolean().default(true)`) so config files written before this field existed continue to parse; the field materializes on the next config save.

When the file is missing, the plugin SHALL create it on first load with these defaults: `enabled: false`, `channels: []`, `workHours: { start: 9, end: 17, tz: "UTC", days: [1, 2, 3, 4, 5] }`, `expectedRate: "daily"`, `smallTalkTopics: []`, `useBuiltinFallbackTopics: true`.

#### Scenario: First load creates the config file with defaults

- **GIVEN** no `data/plugins/casual-talk/config.json` exists
- **WHEN** the plugin loads
- **THEN** the file is created with the default shape above
- **AND** `useBuiltinFallbackTopics` defaults to `true`
- **AND** the plugin treats itself as disabled (no cron spec reconciled, no Claude session triggered)

#### Scenario: Pre-existing config without the field parses with the default

- **GIVEN** a `data/plugins/casual-talk/config.json` that omits `useBuiltinFallbackTopics` (written before this field existed)
- **WHEN** the plugin loads
- **THEN** parsing succeeds and the resolved config has `useBuiltinFallbackTopics: true`

#### Scenario: Config validation rejects invalid workHours

- **GIVEN** a `data/plugins/casual-talk/config.json` with `workHours.start: 20, workHours.end: 8`
- **WHEN** the plugin loads
- **THEN** the plugin records a load error via `sdk.error(...)` describing the wrap-around violation
- **AND** no cron spec is reconciled (the prior reconciled spec, if any, is left for the next clean load to handle)

#### Scenario: Config round-trips through I/O

- **WHEN** the plugin reads and re-writes the config file with no mutations
- **THEN** the resulting file is byte-identical (to the extent JSON.stringify is stable for the shape)

### Requirement: Chattiness Heuristic

The plugin SHALL compute a target roll-die size `N` from the config's `expectedRate` and `workHours`, used to drive a "post if rolled-1-out-of-N" decision per cron tick.

The mapping SHALL be:

- `ticks_per_day = (workHours.end - workHours.start) * 4`
- `ticks_per_week = ticks_per_day * workHours.days.length`
- `"hourly"` → `ticks_per_day / 8`
- `"2-per-day"` → `ticks_per_day / 2`
- `"daily"` → `ticks_per_day`
- `"2-per-week"` → `ticks_per_week / 2`
- `"weekly"` → `ticks_per_week`

If `config.die` is set, it SHALL be used verbatim and `expectedRate` SHALL be ignored.

The result SHALL be rounded to the nearest integer and clamped to `>= 1` (a die of size 1 means every tick fires). The plugin SHALL surface the resolved value in the cron prompt for transparency, e.g. "(rate: daily ≈ 1/32)".

#### Scenario: Heuristic for daily over 9-16 weekdays

- **GIVEN** `workHours: { start: 9, end: 16, tz: "UTC", days: [1,2,3,4,5] }` and `expectedRate: "daily"`
- **WHEN** the heuristic runs
- **THEN** `ticks_per_day = (16 - 9) * 4 = 28`
- **AND** `die === 28`

#### Scenario: Heuristic for weekly over 9-17 weekdays

- **GIVEN** `workHours: { start: 9, end: 17, tz: "UTC", days: [1,2,3,4,5] }` and `expectedRate: "weekly"`
- **WHEN** the heuristic runs
- **THEN** `ticks_per_day = 32`, `ticks_per_week = 160`
- **AND** `die === 160`

#### Scenario: Explicit die overrides expectedRate

- **GIVEN** `expectedRate: "hourly"` and `die: 17`
- **WHEN** the heuristic runs
- **THEN** `die === 17` (the named rate is ignored)

#### Scenario: Die clamps to 1 minimum

- **GIVEN** a config that would compute `die <= 0` (e.g., a configuration error)
- **WHEN** the heuristic runs
- **THEN** the result is clamped to `1`
- **AND** a warning is logged via `sdk.logger.warn`

### Requirement: Cron-Expression Builder

The plugin SHALL build a cron expression from `workHours` using the fixed `*/15` minute cadence. The expression SHALL be `*/15 <start>-<end-1> * * <days>` where `<days>` is the `workHours.days` array joined by `,`.

The `<end - 1>` form is deliberate: a `workHours.end: 16` means "stop at 4pm" (no fires at 16:00 onward); cron hour matching is inclusive on both ends, so the upper bound is `end - 1`.

#### Scenario: Build expression for 9-16 weekdays

- **GIVEN** `workHours: { start: 9, end: 16, tz: "UTC", days: [1,2,3,4,5] }`
- **WHEN** the builder runs
- **THEN** the resulting expression is `*/15 9-15 * * 1,2,3,4,5`

#### Scenario: Build expression for 0-23 every day

- **GIVEN** `workHours: { start: 0, end: 24, tz: "UTC", days: [0,1,2,3,4,5,6] }`
- **WHEN** the builder runs
- **THEN** the resulting expression is `*/15 0-23 * * 0,1,2,3,4,5,6`

### Requirement: Cron Spec Assembly (Channelless)

The plugin SHALL produce exactly one `CronJobSpec` and reconcile it via `sdk.reconcileCronJobs("casual-talk", [spec])` whenever its config is loaded or mutated. The spec SHALL be channelless (no `channel` field — depends on `channelless-cron-jobs`). When `config.enabled === false`, the plugin SHALL reconcile with `[]` so any previously-reconciled spec is removed.

The spec SHALL set:

- `specKey: "chatter"`
- `cronExpression`: from the cron-expression builder
- `timezone`: from `workHours.tz`
- `submitResponseMode`: `"optional-post-to"`
- `requiredTools`: `["mcp__clack__random_roll"]`
- `attachedTopics`: `["casual-talk"]`
- `prompt`: the assembled prompt (see "Prompt Assembly")
- `name`: a short human-readable label (e.g., `"Casual chatter"`)

The `"optional-post-to"` mode (not `"skipped"`) is REQUIRED so the run can deliver via `deliver_to`: casual-talk's deliverable is a `deliver_to` entry to a runtime-chosen channel, and `"skipped"` would strip the `deliver_to` field, leaving the run with no delivery path. This resolves the prior contradiction between the declared mode and the mandated `deliver_to` delivery. (Channelless runs are mechanically forced to `"optional-post-to"` regardless — see `submit-response-mode` — so this declaration documents intent and stays correct if the channelless rule is ever scoped differently.)

#### Scenario: Reconcile with enabled config creates one channelless spec

- **GIVEN** a valid config with `enabled: true` and at least one channel
- **WHEN** the plugin runs reconciliation
- **THEN** exactly one cron spec is reconciled
- **AND** the spec's `channel` field is omitted
- **AND** the spec's `attachedTopics` is `["casual-talk"]`
- **AND** the spec's `submitResponseMode` is `"optional-post-to"`
- **AND** the spec's `requiredTools` includes `mcp__clack__random_roll`

#### Scenario: Disabled config removes any prior spec

- **GIVEN** a previously-reconciled casual-talk cron job exists
- **WHEN** the plugin reconciles with `config.enabled: false`
- **THEN** `sdk.reconcileCronJobs("casual-talk", [])` is called
- **AND** the prior cron job is removed

#### Scenario: Casual-talk run delivers via deliver_to

- **GIVEN** an enabled casual-talk channelless run that rolls a hit and chooses a destination channel
- **WHEN** Claude calls `submit_response` with a `deliver_to` entry targeting that channel
- **THEN** the `optional-post-to` schema accepts the call
- **AND** the message is posted to the chosen channel
- **AND** the run is recorded as a successful delivery

### Requirement: Prompt Assembly

The plugin SHALL assemble the cron job's `prompt` at reconcile time to embed: the resolved die `N`, the candidate channel list, and the **effective fallback topics**. The effective fallback topics SHALL be computed from config as follows:

- When `useBuiltinFallbackTopics` is `true`, the effective list is the de-duplicated union of the plugin's built-in topic constant followed by the admin's `smallTalkTopics` (built-ins first, custom appended, duplicates removed preserving first occurrence).
- When `useBuiltinFallbackTopics` is `false`, the effective list is exactly `smallTalkTopics` (verbatim, the pre-feature behavior).

The prompt SHALL instruct Claude to:

1. Call `random_roll` with `min: 1, max: N, count: 1`.
2. If the roll is not `1`, immediately call `submit_response({ skip_response: true })` and end the run.
3. Otherwise: read each candidate channel via `fetch_channel_messages`, evaluate which channel feels most natural to join, and deliver in a SINGLE `submit_response` call carrying a `deliver_to` entry — `submit_response({ deliver_to: [{ channel, thread_ts?, response: { blocks } }] })`. Claude SHALL NOT also set `skip_response` on a delivering call.
4. If no channel feels right, end with `submit_response({ skip_response: true })` and no `deliver_to` (legitimate outcome).
5. NEVER reveal that this run was triggered by a roll or automation — the persona is "you're a person dropping in naturally."

Per-channel context SHALL include the channel ID and, when set on the config entry, the `promptSuggestion` string. Channel name and Slack metadata are NOT pre-fetched in v1 — Claude reads what it needs via `fetch_channel_messages`.

#### Scenario: Prompt embeds the resolved die size

- **GIVEN** a config that resolves to `die: 32`
- **WHEN** the prompt is assembled
- **THEN** the prompt mentions `1` of `32` as the "post-trigger" outcome
- **AND** the prompt mentions the resolved rate label (e.g., "rate: daily ≈ 1/32") for transparency

#### Scenario: Prompt embeds candidate channels with promptSuggestion

- **GIVEN** `channels: ["C123", { id: "C456", promptSuggestion: "memes only" }]`
- **WHEN** the prompt is assembled
- **THEN** the prompt lists `C123` and `C456` as candidate channels
- **AND** the prompt notes the `promptSuggestion` "memes only" against `C456`
- **AND** the prompt does NOT attach a suggestion to `C123`

#### Scenario: Built-ins enabled with no custom topics uses the built-in list

- **GIVEN** `useBuiltinFallbackTopics: true` and `smallTalkTopics: []`
- **WHEN** the prompt is assembled
- **THEN** the prompt lists the plugin's built-in fallback topics as openers

#### Scenario: Built-ins enabled with custom topics unions both

- **GIVEN** `useBuiltinFallbackTopics: true` and `smallTalkTopics: ["food", "weekend plans"]`
- **WHEN** the prompt is assembled
- **THEN** the prompt lists every built-in topic AND `"food"` AND `"weekend plans"`
- **AND** a custom topic that duplicates a built-in appears only once

#### Scenario: Built-ins disabled falls back to verbatim custom topics

- **GIVEN** `useBuiltinFallbackTopics: false` and `smallTalkTopics: ["food"]`
- **WHEN** the prompt is assembled
- **THEN** the prompt lists exactly `"food"` and none of the built-in topics

#### Scenario: Built-ins disabled with no custom topics has no fallback openers

- **GIVEN** `useBuiltinFallbackTopics: false` and `smallTalkTopics: []`
- **WHEN** the prompt is assembled
- **THEN** the prompt indicates there are no fallback topics (the pre-feature empty-list rendering), and Claude is to only join already-active conversations or skip

#### Scenario: Prompt tells Claude to deliver via deliver_to, not a post_to action

- **WHEN** the prompt is assembled
- **THEN** the prompt instructs that delivery MUST go through a `submit_response({ deliver_to: [...] })` call (channel + `response` blocks per entry)
- **AND** the prompt instructs Claude NOT to also set `skip_response` on a delivering call
- **AND** the prompt does NOT instruct Claude to use a `post_to` action for delivery

#### Scenario: Prompt does NOT reveal the triggering mechanism

- **WHEN** the prompt is assembled
- **THEN** the prompt instructs Claude to NEVER mention the die roll, the schedule, or "automation" in the posted message text

### Requirement: Persona Topic Instruction (Admin-Overridable)

The plugin SHALL register a topic instruction at topic `"casual-talk"` for role `"user"`, filename `"persona"`, with the persona content described in the proposal. The cron spec's `attachedTopics: ["casual-talk"]` SHALL ensure the persona is loaded for every fire. Admins MAY override the content by placing a file at `data/configuration/user/topics/casual-talk/casual-talk__persona.md`.

#### Scenario: Persona is registered at plugin load

- **WHEN** the plugin initializes
- **THEN** `sdk.addTopicInstruction("user", "casual-talk", "persona", PERSONA_CONTENT)` is called exactly once

#### Scenario: Admin override replaces the persona content

- **GIVEN** a file exists at `data/configuration/user/topics/casual-talk/casual-talk__persona.md`
- **WHEN** the cron job fires (with `attachedTopics: ["casual-talk"]`)
- **THEN** the system prompt includes the override file's content
- **AND** the plugin's `PERSONA_CONTENT` is NOT included (standard topic-override semantics)

### Requirement: Admin MCP Management Server

The plugin SHALL declare an on-demand MCP server `casual-talk:management` via `sdk.registerMcpServer("management", { autoload: false, description: ... })`. All config-mutation tools SHALL be bound to this server and SHALL have `minRole: "admin"`. Tools become available only after Claude calls `attach_integration("casual-talk:management")`.

#### Scenario: Management server is registered as on-demand

- **WHEN** the plugin initializes
- **THEN** the management server is registered with `autoload: false`
- **AND** the server's description summarizes "Manage casual-talk channels, topics, and chattiness"

#### Scenario: Admin tools are bound to the management server, not the default

- **WHEN** the plugin registers its tools
- **THEN** all config-mutation tools are bound via the `management` handle (not via `sdk.registerTool` shorthand)
- **AND** their MCP names live at `mcp__casual-talk_management__*` (not `mcp__casual-talk__*`)

### Requirement: Admin Tool — `set_casual_talk_config`

The plugin SHALL register a tool `set_casual_talk_config` that replaces the full config in one call. The tool's schema SHALL accept the full `CasualTalkConfig` shape — including `useBuiltinFallbackTopics` — validate it via the same Zod schema used for file loading, persist it via `sdk.writeFile`, and trigger `sdk.requestSoftRestart`. `useBuiltinFallbackTopics` MAY be omitted from the tool input, in which case the schema default (`true`) applies.

#### Scenario: Tool replaces config and triggers soft restart

- **GIVEN** an existing config
- **WHEN** an admin invokes `set_casual_talk_config` with a valid full config
- **THEN** `data/plugins/casual-talk/config.json` is overwritten with the new shape
- **AND** `sdk.requestSoftRestart("casual-talk config changed")` is called
- **AND** the tool returns success

#### Scenario: Tool accepts and persists useBuiltinFallbackTopics

- **WHEN** an admin invokes `set_casual_talk_config` with `useBuiltinFallbackTopics: false`
- **THEN** the persisted config has `useBuiltinFallbackTopics: false`

#### Scenario: Tool rejects invalid config without persisting

- **WHEN** an admin invokes `set_casual_talk_config` with an invalid shape (e.g., `workHours.start: 25`)
- **THEN** the tool returns an error citing the validation failure
- **AND** the existing config file is unchanged
- **AND** no soft restart is triggered

### Requirement: Admin Tool — `add_channel`

The plugin SHALL register a tool `add_channel` that appends a channel to the list. Args: `{ id: string; promptSuggestion?: string }`. If `id` is already in the list, the tool SHALL update the existing entry's `promptSuggestion` (or no-op when `promptSuggestion` is absent). When `promptSuggestion` is omitted the entry is stored as a bare string ID. The tool triggers `sdk.requestSoftRestart` on success.

#### Scenario: Add a new channel as bare string

- **GIVEN** `channels: ["C123"]`
- **WHEN** an admin invokes `add_channel({ id: "C456" })`
- **THEN** the config's `channels` becomes `["C123", "C456"]`
- **AND** a soft restart is triggered

#### Scenario: Add a new channel with promptSuggestion

- **GIVEN** `channels: ["C123"]`
- **WHEN** an admin invokes `add_channel({ id: "C456", promptSuggestion: "memes only" })`
- **THEN** the config's `channels` becomes `["C123", { id: "C456", promptSuggestion: "memes only" }]`

#### Scenario: Add channel that's already present updates the promptSuggestion

- **GIVEN** `channels: ["C123"]`
- **WHEN** an admin invokes `add_channel({ id: "C123", promptSuggestion: "now with a hint" })`
- **THEN** the entry is upgraded to `{ id: "C123", promptSuggestion: "now with a hint" }`

### Requirement: Admin Tool — `remove_channel`

The plugin SHALL register a tool `remove_channel({ id: string })` that removes the entry whose id matches. Tool triggers `sdk.requestSoftRestart` on success.

#### Scenario: Remove an existing channel

- **GIVEN** `channels: ["C123", { id: "C456", promptSuggestion: "memes" }]`
- **WHEN** an admin invokes `remove_channel({ id: "C456" })`
- **THEN** `channels` becomes `["C123"]`

#### Scenario: Remove a channel not in the list

- **WHEN** an admin invokes `remove_channel({ id: "C999" })` and `C999` is not in `channels`
- **THEN** the tool returns a "not found" notice
- **AND** the config is unchanged
- **AND** no soft restart is triggered

### Requirement: Admin Tool — `set_channel_prompt_suggestion`

The plugin SHALL register a tool `set_channel_prompt_suggestion({ id: string; promptSuggestion: string })` that updates the per-channel suggestion. An empty `promptSuggestion` clears it (the entry reverts to a bare string ID). Tool triggers `sdk.requestSoftRestart`.

#### Scenario: Set a suggestion on a bare-string channel

- **GIVEN** `channels: ["C123"]`
- **WHEN** an admin invokes `set_channel_prompt_suggestion({ id: "C123", promptSuggestion: "new hint" })`
- **THEN** the entry becomes `{ id: "C123", promptSuggestion: "new hint" }`

#### Scenario: Clear a suggestion reverts to bare string

- **GIVEN** `channels: [{ id: "C123", promptSuggestion: "old hint" }]`
- **WHEN** an admin invokes `set_channel_prompt_suggestion({ id: "C123", promptSuggestion: "" })`
- **THEN** the entry becomes `"C123"`

#### Scenario: Tool errors when channel is not in the list

- **WHEN** the tool is called with an `id` not in `channels`
- **THEN** the tool returns a "channel not configured" error
- **AND** the config is unchanged

### Requirement: Admin Tool — `add_small_talk_topic` and `remove_small_talk_topic`

The plugin SHALL register tools `add_small_talk_topic({ topic: string })` and `remove_small_talk_topic({ topic: string })`. `add` appends if absent (idempotent); `remove` deletes by exact match (no-ops when absent). Both trigger soft restart on success.

#### Scenario: Add a topic that's not present

- **GIVEN** `smallTalkTopics: ["food"]`
- **WHEN** an admin invokes `add_small_talk_topic({ topic: "weekend plans" })`
- **THEN** `smallTalkTopics` becomes `["food", "weekend plans"]`

#### Scenario: Add a topic that's already present is a no-op

- **GIVEN** `smallTalkTopics: ["food"]`
- **WHEN** an admin invokes `add_small_talk_topic({ topic: "food" })`
- **THEN** `smallTalkTopics` remains `["food"]`
- **AND** no soft restart is triggered

#### Scenario: Remove an existing topic

- **GIVEN** `smallTalkTopics: ["food", "weekend plans"]`
- **WHEN** an admin invokes `remove_small_talk_topic({ topic: "food" })`
- **THEN** `smallTalkTopics` becomes `["weekend plans"]`

### Requirement: Admin Tool — `set_expected_rate`

The plugin SHALL register a tool `set_expected_rate` that accepts either a named rate or a raw die. Args (one of):

- `{ rate: "hourly" | "2-per-day" | "daily" | "2-per-week" | "weekly" }` — sets `expectedRate` and clears `die`.
- `{ die: number }` — sets `die` (clears `expectedRate` is implicit: leaves it but the `die` override wins per the heuristic).

Tool triggers `sdk.requestSoftRestart`.

#### Scenario: Set rate to "weekly"

- **GIVEN** any prior config
- **WHEN** an admin invokes `set_expected_rate({ rate: "weekly" })`
- **THEN** `expectedRate` becomes `"weekly"`
- **AND** `die` is cleared (set to `undefined`)

#### Scenario: Set explicit die

- **WHEN** an admin invokes `set_expected_rate({ die: 17 })`
- **THEN** `die` becomes `17`
- **AND** the next reconcile uses 17 regardless of `expectedRate`

### Requirement: Admin Tool — `set_work_hours`

The plugin SHALL register a tool `set_work_hours({ start: number; end: number; tz: string; days: number[] })` that replaces the `workHours` block. Validated against the same constraints as the config schema. Tool triggers `sdk.requestSoftRestart`.

#### Scenario: Update work hours

- **WHEN** an admin invokes `set_work_hours({ start: 8, end: 18, tz: "America/Montreal", days: [1,2,3,4] })`
- **THEN** the config's `workHours` is replaced
- **AND** the next reconcile rebuilds the cron expression and the resolved die

#### Scenario: Invalid work hours rejected

- **WHEN** the tool is called with `start: 20, end: 8`
- **THEN** the tool returns an error citing the wrap-around violation
- **AND** the config is unchanged

### Requirement: Admin Tools — `enable` and `disable`

The plugin SHALL register tools `enable()` and `disable()` that flip `config.enabled` and trigger soft restart. Idempotent: enabling an already-enabled plugin is a no-op (no soft restart).

#### Scenario: Enable a previously-disabled plugin

- **GIVEN** `enabled: false`
- **WHEN** an admin invokes `enable()`
- **THEN** `enabled` becomes `true`
- **AND** a soft restart is triggered

#### Scenario: Disable an enabled plugin

- **GIVEN** `enabled: true` with one reconciled cron job
- **WHEN** an admin invokes `disable()`
- **THEN** `enabled` becomes `false`
- **AND** a soft restart is triggered
- **AND** on the next plugin init, the cron job is removed via `reconcileCronJobs("casual-talk", [])`

### Requirement: Tool Labels Include the Changed Value

Tool mappings for admin tools SHALL surface the affected entity in the Slack task card label, per the user's repository preference. Examples:

- `add_channel` → `"Adding casual-talk channel — {id}"`
- `remove_channel` → `"Removing casual-talk channel — {id}"`
- `set_channel_prompt_suggestion` → `"Updating channel prompt — {id}"`
- `add_small_talk_topic` → `"Adding small-talk topic — {topic}"`
- `remove_small_talk_topic` → `"Removing small-talk topic — {topic}"`
- `set_expected_rate` → `"Setting expected rate — {rate}"` (or `"— die {die}"` when `die` was supplied; mapping decides)
- `set_work_hours` → `"Updating casual-talk work hours"`
- `enable` → `"Enabling casual-talk"`
- `disable` → `"Disabling casual-talk"`
- `set_casual_talk_config` → `"Replacing casual-talk config"`
- `toggle_builtin_fallback_topics` → `"Toggling built-in fallback topics — {enabled}"`

#### Scenario: Tool label interpolates the channel id

- **WHEN** Claude calls `add_channel({ id: "C456" })`
- **THEN** the Slack task-card label rendered for this tool call includes `C456`

### Requirement: i18n for Direct-to-Slack Strings

Every string in the plugin that reaches Slack on the direct path (DM error notices, status messages, persona overrides where applicable) SHALL be resolved via `sdk.t(key, vars?)`. The plugin SHALL register a dictionary via `sdk.registerDictionary({ en, fr? })`. Tool descriptions and Claude-facing prompt content SHALL remain in English (per the i18n convention).

#### Scenario: Plugin registers an EN dictionary on init

- **WHEN** the plugin initializes
- **THEN** `sdk.registerDictionary({ en: ... })` is called with at least an `en` table
- **AND** all direct-to-Slack strings the plugin uses are present as keys in the table

#### Scenario: Missing translation key is a programming error

- **WHEN** the plugin calls `sdk.t("nonexistent_key")`
- **THEN** the SDK throws an error explaining the missing key (per the standard plugin i18n contract)

### Requirement: Soft Restart on Config Mutation

Every config-mutating admin tool SHALL call `sdk.requestSoftRestart(reason)` on success so the next plugin init rebuilds the cron spec and prompt from the new config. Read-only tools (none in v1) would not trigger restart.

#### Scenario: Soft restart re-applies the cron spec

- **GIVEN** an initial config with `expectedRate: "daily"`, one reconciled cron spec
- **WHEN** an admin invokes `set_expected_rate({ rate: "weekly" })`
- **THEN** `requestSoftRestart` is called with a non-empty reason
- **AND** on the next plugin init, the reconciled cron spec's `prompt` reflects the new die (e.g., 1/160 instead of 1/32)

### Requirement: Built-in Fallback Topics Constant

The plugin SHALL define a built-in fallback topics constant (`BUILTIN_FALLBACK_TOPICS`) — a small, curated, workplace-safe list of generic small-talk opener ideas — inside the plugin folder. The list SHALL be authored in English only, since topics are Claude-facing prompt content (Claude renders the eventual opener in the configured language per the LANGUAGE directive) and therefore are NOT routed through `sdk.t()`. The constant SHALL avoid politically, religiously, or otherwise sensitive subject matter, since it ships to every deployment.

#### Scenario: Built-in topics are defined and non-empty

- **WHEN** the plugin module loads
- **THEN** `BUILTIN_FALLBACK_TOPICS` is a non-empty array of strings

#### Scenario: Built-in topics are not localized

- **WHEN** built-in topics are emitted into the prompt
- **THEN** they are taken verbatim from the English constant and are NOT resolved through `sdk.t()`

### Requirement: Admin Tool — `toggle_builtin_fallback_topics`

The plugin SHALL register an admin tool `toggle_builtin_fallback_topics({ enabled: boolean })` bound to the `casual-talk:management` server. It SHALL set `config.useBuiltinFallbackTopics` to the supplied value and trigger `sdk.requestSoftRestart` on change. It SHALL be idempotent: when the flag already equals the requested value, the tool returns a success message indicating no change and does NOT trigger a soft restart.

#### Scenario: Turning built-ins off when currently on

- **GIVEN** `useBuiltinFallbackTopics: true`
- **WHEN** an admin invokes `toggle_builtin_fallback_topics({ enabled: false })`
- **THEN** `useBuiltinFallbackTopics` becomes `false`
- **AND** a soft restart is triggered

#### Scenario: Turning built-ins on when currently on is a no-op

- **GIVEN** `useBuiltinFallbackTopics: true`
- **WHEN** an admin invokes `toggle_builtin_fallback_topics({ enabled: true })`
- **THEN** `useBuiltinFallbackTopics` remains `true`
- **AND** no soft restart is triggered
- **AND** the tool returns a success message noting the flag was already in that state

#### Scenario: Tool result string resolves through the plugin dictionary

- **WHEN** the tool returns its result message
- **THEN** the message is resolved via `sdk.t(...)` and has both EN and FR entries in the plugin dictionary

### Requirement: Plugin Stays Inside Its Folder

All plugin code SHALL live under `src/plugins/casual-talk/**`. The plugin SHALL NOT import from `src/config.ts`, `src/logger.ts`, `src/slack/...`, `src/instructions.ts`, or any other module outside its own folder. Third-party packages, Node built-ins, and `../sdk.js` (the plugin SDK) are the only allowed imports.

#### Scenario: No core imports in plugin code

- **WHEN** the plugin code is reviewed (or linted, when enforcement lands)
- **THEN** no `import` statement under `src/plugins/casual-talk/**` resolves to a module outside `src/plugins/casual-talk/**`, `node_modules`, or `../sdk.js`

### Requirement: Casual Posts Engage Their Thread With High Attention

The casual-talk chatter prompt SHALL instruct Claude to set `attention_level: "high"` on the `deliver_to` entry whenever it joins or opens a thread, so casual-talk threads engage human replies instead of being fire-and-forget.

When the plugin does not supply an attention level on a delivery, the default `"off"` SHALL apply (no engagement) — attention is plugin-provided per delivery, not a structural config default.

#### Scenario: Casual opener engages its thread

- **WHEN** the casual-talk run delivers a fresh opener or a thread reply via `deliver_to`
- **THEN** the entry carries `attention_level: "high"`
- **AND** the destination thread is seeded as an engaged session (per `submit-response-deliver-to` + `engaged-thread-registration`)

#### Scenario: A human reply to a casual thread is answered

- **GIVEN** a casual-talk post engaged its thread with high attention
- **WHEN** a human replies in that thread
- **THEN** the thread auto-respond path resolves the seeded session and Clack may respond (subject to the attention-rung pre-analysis gate)

