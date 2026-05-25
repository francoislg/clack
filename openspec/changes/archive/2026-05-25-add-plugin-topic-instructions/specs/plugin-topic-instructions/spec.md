## ADDED Requirements

### Requirement: Plugin SDK Surface for Topic Instructions

The `ClackSdk` interface SHALL expose `addTopicInstruction(role: RoleDir, topic: string, filename: string, content: string): void` for registering instruction content that is only loaded when the named topic is active.

The SDK SHALL store the content as a virtual default under the topic-scoped key path `topics/<topic>/<pluginName>__<filename>.md`, mirroring the `<pluginName>__` namespacing convention used by `addInstruction` so two plugins can contribute non-colliding files to the same topic.

The SDK SHALL NOT require the plugin to pre-register the topic name. The topic exists implicitly the first time a virtual default or an on-disk file references it.

#### Scenario: addTopicInstruction stores a topic-scoped virtual default

- **GIVEN** a plugin named `"trivia"`
- **WHEN** the plugin's init function calls `sdk.addTopicInstruction("user", "trivia", "persona", "PERSONA: ...")`
- **THEN** the SDK records a virtual default at role `"user"` with key `"topics/trivia/trivia__persona.md"` and content `"PERSONA: ..."`
- **AND** the plugin does not need to construct the `topics/` prefix itself
- **AND** the `<pluginName>__` filename prefix is applied by the SDK

#### Scenario: Multiple files per topic from one plugin

- **GIVEN** the trivia plugin
- **WHEN** the plugin calls `addTopicInstruction("user", "trivia", "persona", "...")` and `addTopicInstruction("user", "trivia", "reveal-tone", "...")`
- **THEN** both files are stored as virtual defaults under role `"user"` with keys `"topics/trivia/trivia__persona.md"` and `"topics/trivia/trivia__reveal-tone.md"`
- **AND** both are resolved together when the `trivia` topic is active

#### Scenario: Two plugins contributing to the same topic do not collide

- **GIVEN** plugin `"trivia"` calls `addTopicInstruction("user", "shared", "rules", "A")`
- **AND** plugin `"weather"` calls `addTopicInstruction("user", "shared", "rules", "B")`
- **WHEN** the `shared` topic is active
- **THEN** both files are resolved (keys `topics/shared/trivia__rules.md` and `topics/shared/weather__rules.md`)
- **AND** their content is concatenated in alphabetical filename order under a single `=== TOPIC: shared ===` header

### Requirement: Cron Spec Carries attachedTopics

`CronJobSpec` SHALL accept an optional `attachedTopics?: string[]` field. When a plugin includes the field in a spec passed to `sdk.reconcileCronJobs(ownerKey, specs)`, the reconciler SHALL persist the field on the resulting `CronJob` record.

The array MAY contain any topic names — including topics the same plugin owns, topics owned by other plugins, or topic names that have no registered virtual defaults (the latter resolves to an empty topic section without error).

#### Scenario: Spec with attachedTopics persists the field

- **GIVEN** no cron jobs exist with `plugin === "trivia"`
- **WHEN** `sdk.reconcileCronJobs("trivia", [{ specKey: "main:question", cronExpression: "0 9 * * *", channel: "C123", prompt: "…", timezone: "UTC", attachedTopics: ["trivia"] }])` is called
- **THEN** the persisted job has `attachedTopics: ["trivia"]`

#### Scenario: Spec without attachedTopics persists no field

- **WHEN** a spec is reconciled without an `attachedTopics` field
- **THEN** the persisted job has no `attachedTopics` field (or an absent field equivalent to an empty array at execution time)

#### Scenario: attachedTopics on an existing job is updated by re-reconcile

- **GIVEN** a persisted job with `plugin === "trivia"`, `specKey === "main:question"`, `attachedTopics: ["trivia"]`
- **WHEN** the spec is re-reconciled with `attachedTopics: ["trivia", "trivia-finale"]`
- **THEN** the persisted job has `attachedTopics: ["trivia", "trivia-finale"]`

#### Scenario: attachedTopics removed from spec clears the field

- **GIVEN** a persisted job with `attachedTopics: ["trivia"]`
- **WHEN** the spec is re-reconciled with no `attachedTopics` field
- **THEN** the persisted job has `attachedTopics` cleared (absent or empty array)

### Requirement: Cron Execution Pre-Attaches Declared Topics

When `executeDynamicJob` runs a `CronJob` whose `attachedTopics` is a non-empty array, the system SHALL forward those topic names into `processMessage` as pre-attached topics. The pre-attached topics SHALL be merged with any topics activated mid-session by `attach_integration` when the cascading resolver computes the system prompt for any turn in the session.

Pre-attached topics SHALL apply from the first turn (system-prompt assembly) onward — Claude does not have to call `attach_integration` to see the content.

#### Scenario: Pre-attached topic populates the system prompt at turn 1

- **GIVEN** a `CronJob` with `attachedTopics: ["trivia"]`
- **AND** the trivia plugin has registered a virtual default for `topics/trivia/trivia__persona.md` at the `user` role with content `"PERSONA: ..."`
- **WHEN** the job fires and `executeDynamicJob` calls `processMessage`
- **THEN** the assembled system prompt for the first Claude turn contains `=== TOPIC: trivia ===` followed by the persona content
- **AND** no `attach_integration` tool call is required to surface the content

#### Scenario: Pre-attached topic merges with runtime-attached topics

- **GIVEN** a `CronJob` with `attachedTopics: ["trivia"]`
- **WHEN** Claude calls `attach_integration("weather")` mid-session
- **THEN** the next turn's system prompt includes both `=== TOPIC: trivia ===` and `=== TOPIC: weather ===` sections
- **AND** topic order within the prompt remains alphabetical

#### Scenario: Pre-attached topic with no content resolves silently

- **GIVEN** a `CronJob` with `attachedTopics: ["nonexistent"]`
- **AND** no plugin virtual defaults or on-disk files exist for the `nonexistent` topic
- **WHEN** the job fires
- **THEN** the system prompt does NOT include a `=== TOPIC: nonexistent ===` header
- **AND** no error or warning is emitted

### Requirement: Topic Instruction Overrides Live Under data/configuration

An admin SHALL override a plugin-shipped topic instruction by placing a file at `data/configuration/<role>/topics/<topic>/<pluginName>__<filename>.md`. The file SHALL take precedence over the plugin's virtual default for the same role.

The override path follows the same convention as baseline plugin instruction overrides — only the `<role>/topics/<topic>/` prefix changes.

#### Scenario: On-disk override wins over plugin virtual default

- **GIVEN** the trivia plugin contributes `topics/trivia/trivia__persona.md` with content `"PLUGIN PERSONA"`
- **AND** an admin creates `data/configuration/user/topics/trivia/trivia__persona.md` with content `"ADMIN PERSONA"`
- **WHEN** a cron run with `attachedTopics: ["trivia"]` fires
- **THEN** the assembled system prompt's `=== TOPIC: trivia ===` section contains `"ADMIN PERSONA"`
- **AND** does NOT contain `"PLUGIN PERSONA"`

#### Scenario: Removing the override restores the plugin default

- **GIVEN** an override file existed and was deleted from `data/configuration/`
- **WHEN** the next cron run with the topic attached fires
- **THEN** the system prompt's topic section reverts to the plugin's virtual default content

#### Scenario: Hot reload picks up override edits within one turn

- **GIVEN** an admin edits `data/configuration/user/topics/trivia/trivia__persona.md`
- **WHEN** the next `loadInstructions` call runs (next turn or next cron fire)
- **THEN** the edited content is reflected in the assembled system prompt
- **AND** no application restart is required

### Requirement: Plugin-Authored Topic Files Listed Under Home Tab Source Labels

When `list_config_files` and the Home Tab enumerate topic instruction files (per the existing `Topic File Discovery in Home Tab` requirement in the `cascading-config-resolver` capability), files contributed by plugins SHALL appear with source labels distinguishing them from on-disk defaults:

- `"plugin"` — the file exists only as a plugin-contributed virtual default; no on-disk override.
- `"plugin-customized"` — the plugin contributes a virtual default AND an on-disk override file exists.
- `"customized"` / `"custom-only"` — same semantics as baseline files when no plugin is involved.

#### Scenario: Plugin-only topic file labeled as plugin

- **GIVEN** the trivia plugin contributes `topics/trivia/trivia__persona.md` with no on-disk override
- **WHEN** `list_config_files` is called
- **THEN** the response surfaces the file under `role: "user"`, `topic: "trivia"` with `file: "trivia__persona.md"` and `source: "plugin"`

#### Scenario: Plugin file with override labeled as plugin-customized

- **GIVEN** both a plugin virtual default and a `data/configuration/user/topics/trivia/trivia__persona.md` override file exist
- **WHEN** `list_config_files` is called
- **THEN** the file's source is `"plugin-customized"`
