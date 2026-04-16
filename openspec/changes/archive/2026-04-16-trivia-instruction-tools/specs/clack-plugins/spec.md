## ADDED Requirements

### Requirement: Plugin Tool Mapping Supports Hidden Flag

The `ToolEntryObject` form of a plugin tool mapping SHALL support an optional `hidden: boolean` field. When `true`, the tool's invocations SHALL be suppressed from the Slack streaming task-card UI while still executing server-side normally.

This SHALL be plumbed into the existing streaming hidden-tools mechanism: tools whose mapping specifies `hidden: true` are merged into the resolved hidden list at tool-mapping load time.

#### Scenario: Plugin registers a hidden tool

- **WHEN** a plugin calls `sdk.registerTool("member", toolDef, { label: "…", hidden: true })`
- **THEN** the tool is registered and callable
- **AND** invocations of the tool do not render a task card in the Slack streaming UI

#### Scenario: Hidden flag is optional

- **WHEN** a plugin calls `sdk.registerTool("member", toolDef, "Some label")` or passes an object without `hidden`
- **THEN** the tool behaves as a visible tool (current behavior unchanged)

#### Scenario: Hidden tool still records a ToolCallRecorder entry

- **WHEN** a hidden tool is invoked
- **THEN** the session's `ToolCallRecorder` still captures the call
- **AND** the entry is available via session-transcript tools such as `find_sessions`

## REMOVED Requirements

### Requirement: Plugin-Declared Default Required Tools for Scheduled Runs

**Reason**: Plugin-wide required-tools enforcement does not fit plugins with multiple schedule shapes. Trivia introduced two schedules with disjoint required-tool lists (question-posting needs `save_question`; answer-reveal needs `submit_answers`); a single plugin-wide list would either break one schedule or be empty. Per-job `requiredTools` on cron jobs — a pre-existing mechanism that is self-describing — is the correct enforcement layer. The setup recipe tool (`create_schedules_instructions`) is the single place where per-schedule `requiredTools` is declared.

**Migration**: The only plugin calling `sdk.requireToolsForScheduled` is the Trivia plugin, which is modified in the same change to remove the call. Schedules created via the new setup recipe specify `requiredTools` inline. The pre-existing live trivia cron jobs (`6a9ecb1f-f3c`, `b9a28355-52b`) already carry their own explicit `requiredTools` lists and are unaffected.
