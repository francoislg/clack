## MODIFIED Requirements

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

### Requirement: Prompt Assembly

The plugin SHALL assemble the cron job's `prompt` at reconcile time to embed: the resolved die `N`, the candidate channel list, and the **effective fallback topics**. The effective fallback topics SHALL be computed from config as follows:

- When `useBuiltinFallbackTopics` is `true`, the effective list is the de-duplicated union of the plugin's built-in topic constant followed by the admin's `smallTalkTopics` (built-ins first, custom appended, duplicates removed preserving first occurrence).
- When `useBuiltinFallbackTopics` is `false`, the effective list is exactly `smallTalkTopics` (verbatim, the pre-feature behavior).

The prompt SHALL instruct Claude to:

1. Call `random_roll` with `min: 1, max: N, count: 1`.
2. If the roll is not `1`, immediately call `submit_response({ skip_response: true })` and end the run.
3. Otherwise: read each candidate channel via `fetch_channel_messages` (limit ~30), evaluate which channel feels most natural to join, and use `post_to {channel, text}` to deliver. End with `submit_response({ skip_response: true })`.
4. If no channel feels right, end with `submit_response({ skip_response: true })` without posting (legitimate outcome).
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

#### Scenario: Prompt explicitly tells Claude to use post_to, not submit_response text

- **WHEN** the prompt is assembled
- **THEN** the prompt contains instructions stating that delivery MUST go through `post_to {channel, text}` and that `submit_response` is a run terminator only

#### Scenario: Prompt does NOT reveal the triggering mechanism

- **WHEN** the prompt is assembled
- **THEN** the prompt instructs Claude to NEVER mention the die roll, the schedule, or "automation" in the posted message text

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

## ADDED Requirements

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
