## ADDED Requirements

### Requirement: Pre-Attached Topics from Trigger Source

The `loadInstructions(role, options)` API SHALL accept an optional `topics?: string[]` field on its options. When the field is a non-empty array, the system SHALL treat those topic names as active for the duration of the resolution call — exactly as if they had been activated by `attach_integration`.

The pre-attached topics SHALL be merged (as a set union) with any topics already activated mid-session by `attach_integration` before the cascading resolver is invoked. The order of the resulting active-topic set SHALL be alphabetical, matching the existing resolver behavior.

When the `topics` field is absent or empty, `loadInstructions` SHALL behave exactly as it did before this change.

#### Scenario: Pre-attached topic activated on first turn

- **GIVEN** a session with no runtime-attached topics
- **WHEN** `loadInstructions("system", { changesWorkflowEnabled: false, variables: {}, topics: ["trivia"] })` is called
- **THEN** the resolver receives `activeTopics = new Set(["trivia"])` and returns a system prompt that includes a `=== TOPIC: trivia ===` section

#### Scenario: Pre-attached topic merged with runtime-attached topics

- **GIVEN** a session that has previously called `attach_integration("weather")` (so runtime topics include `"weather"`)
- **WHEN** `loadInstructions(role, { ..., topics: ["trivia"] })` is called for a subsequent turn
- **THEN** the resolver receives `activeTopics = new Set(["trivia", "weather"])`
- **AND** the resulting system prompt includes both `=== TOPIC: trivia ===` and `=== TOPIC: weather ===` sections in alphabetical order

#### Scenario: Empty or absent topics is a no-op

- **WHEN** `loadInstructions(role, options)` is called without a `topics` field (or with `topics: []`)
- **THEN** the resolved system prompt is byte-identical to the pre-change behavior for the same role, options, and runtime-attached topic state

#### Scenario: Pre-attached topic with no content resolves silently

- **GIVEN** no virtual default or on-disk file exists for the topic name `"nonexistent"`
- **WHEN** `loadInstructions(role, { ..., topics: ["nonexistent"] })` is called
- **THEN** the resolved system prompt does NOT contain a `=== TOPIC: nonexistent ===` header
- **AND** the call returns successfully without error
