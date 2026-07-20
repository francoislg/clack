# casual-talk-plugin — Delta

## MODIFIED Requirements

### Requirement: Cron Spec Assembly (Channelless)

The plugin SHALL produce exactly one `CronJobSpec` and reconcile it via `sdk.reconcileCronJobs("casual-talk", [spec])` whenever its config is loaded or mutated. The spec SHALL be channelless (no `channel` field — depends on `channelless-cron-jobs`). When `config.enabled === false`, the plugin SHALL reconcile with `[]` so any previously-reconciled spec is removed.

The spec SHALL set:

- `specKey: "chatter"`
- `cronExpression`: from the cron-expression builder
- `timezone`: from `workHours.tz`
- `submitResponseMode`: `"optional-post-to"`
- `requiredTools`: `["mcp__clack__random_roll"]`
- `attachedTopics`: `["casual-talk"]` — the persona only; `response-rendering` is NOT pre-attached (it is attached at hit time per the prompt's on-hit directive)
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

The plugin SHALL assemble the cron job's `prompt` at reconcile time as a **lean triggering prompt**: it SHALL embed only the roll step and config-derived context, and SHALL NOT restate the engagement mechanics (channel triage, reacting, posting/termination) — those live in the `casual-talk:engagement` topic (see "Engagement Topic"). The prompt SHALL embed: the resolved die `N`, the rate label, the candidate channel list, the **effective fallback topics**, and the config-dependent skip-strictness variant. The effective fallback topics SHALL be computed from config as follows:

- When `useBuiltinFallbackTopics` is `true`, the effective list is the de-duplicated union of the plugin's built-in topic constant followed by the admin's `smallTalkTopics` (built-ins first, custom appended, duplicates removed preserving first occurrence).
- When `useBuiltinFallbackTopics` is `false`, the effective list is exactly `smallTalkTopics` (verbatim, the pre-feature behavior).

The prompt SHALL instruct Claude to:

1. Call `random_roll` with `min: 1, max: N, count: 1` as its FIRST action.
2. If the roll is not `1`: immediately call `submit_response({ skip_response: true })` and end the run, without reading any channel.
3. If the roll is `1`: BEFORE anything else, call `attach_integration("casual-talk:engagement")` and `attach_integration("response-rendering")`, then engage per the loaded instructions, using the candidate channels and fallback topics embedded in this prompt. This directive SHALL sit directly under the roll instruction in the assembled prompt.
4. NEVER reveal that this run was triggered by a roll or automation (restated compactly; the full persona constraints live in the engagement topic).

Per-channel context SHALL include the channel ID and, when set on the config entry, the `promptSuggestion` string. The skip-strictness variant SHALL state: with fallback topics configured, skipping a hit is reserved for genuine impossibility; with no fallback topics, a quiet day legitimately ends in a skip (chip-in-only mode).

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
- **THEN** the prompt indicates there are no fallback topics and states the chip-in-only skip variant (a quiet day legitimately ends in a skip)

#### Scenario: Prompt is lean — engagement mechanics not restated

- **WHEN** the prompt is assembled
- **THEN** the prompt does NOT contain the channel-triage instructions (`fetch_channel_messages` overview mechanics, freshness/human-leaf rules)
- **AND** the prompt does NOT contain the posting/termination mechanics (`attention_level`, `default_delivery_mode`, react-only termination)
- **AND** the prompt directs Claude on a hit to attach `casual-talk:engagement` and `response-rendering` and follow the loaded instructions

#### Scenario: Prompt does NOT reveal the triggering mechanism

- **WHEN** the prompt is assembled
- **THEN** the prompt instructs Claude to NEVER mention the die roll, the schedule, or "automation" in anything it posts or reacts

#### Scenario: Attach failure on a hit degrades gracefully

- **GIVEN** a hit roll where `attach_integration("casual-talk:engagement")` or `attach_integration("response-rendering")` returns an error
- **WHEN** the run continues
- **THEN** the run proceeds with best-effort engagement using the prompt's remaining context (it never crashes or retries in a loop) — a failed attach is a degraded hit, not a miss
- **AND** the existing `submit_response` formatting-failure hint remains the rendering backstop

## ADDED Requirements

### Requirement: Engagement Topic (`casual-talk:engagement`)

The plugin SHALL register an on-demand server named `engagement` (`sdk.registerMcpServer("engagement", { autoload: false, description })`) with NO tools bound, and SHALL bind the engagement instructions to it via the handle's `addTopicInstruction("user", ...)` — making `casual-talk:engagement` an attachable instructions-only catalog entry. Attaching it SHALL resolve with the `instructions_only` outcome and deliver the engagement content as the tool result.

The engagement content SHALL carry the static (non-config-derived) guidance previously in the cron prompt: channel triage mechanics (`fetch_channel_messages` overview semantics, freshness-by-last-reply, human-leaf/no-pile-on guard, join signals), the reacting guidance (reactable bar, `find_emoji`, existing-reaction preference, volume judgment), and the posting and termination mechanics (single `deliver_to` entry, mandatory `attention_level: "high"` and `default_delivery_mode: "invisible"`, destination picking, react-only vs post termination). The persona constraints themselves SHALL NOT be restated in the topic — they live in the pre-attached `casual-talk` persona topic (loaded on every fire); the engagement content carries only the reaction-scoped extension of the persona's never-reveal rule. Config-derived content (channels, fallback topics, die, skip variant) SHALL NOT appear in the topic — it stays in the reconcile-time prompt so config hot-reload keeps working. The split for skip behavior: the topic carries the GENERIC termination mechanics (react-only → `skip_response`; post → single `deliver_to`), while the skip-STRICTNESS decision rule (how reluctant to skip a hit, which depends on whether fallback topics are configured) lives ONLY in the prompt's config-dependent variant — the topic defers to it by reference.

Admins MAY override the content via the standard plugin-topic override path (`data/configuration/user/topics/casual-talk:engagement/`).

#### Scenario: Attach resolves instructions-only

- **GIVEN** the plugin is loaded
- **WHEN** Claude calls `attach_integration("casual-talk:engagement")`
- **THEN** the attach succeeds with the `instructions_only` outcome (no MCP server config, no tools)
- **AND** the tool result contains the engagement instructions (triage, reacting, posting/termination — persona constraints stay in the pre-attached persona topic)

#### Scenario: Topic content is static

- **WHEN** the engagement topic content is registered at plugin load
- **THEN** it contains no channel IDs, no fallback-topic lists, and no die value
- **AND** a config edit (channels/topics/rate) requires no soft restart for the topic to stay correct

#### Scenario: Termination contract lives in one place

- **WHEN** the engagement content and the cron prompt are both assembled
- **THEN** the full termination mechanics (react-only → `skip_response`; post → single `deliver_to`, no `skip_response`; `attention_level`/`default_delivery_mode` mandates) appear ONLY in the engagement topic
- **AND** the cron prompt references the loaded instructions rather than restating them
