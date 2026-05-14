## MODIFIED Requirements

### Requirement: Tool Call Progress
The system SHALL display Claude's tool calls as task cards within a plan block, updated in real-time as tools execute. Consecutive same-group tool calls collapse into a single task card; the header title increments a `(<count>)` suffix on every call, and each call appends a detail line below the header up to the group's resolved `maxDetails` cap. Once the cap is reached, additional same-group calls continue to advance the header count but SHALL NOT append further detail lines.

#### Scenario: Thinking task lifecycle
- **WHEN** the stream starts
- **THEN** a persistent "thinking" task card is shown in `in_progress` status
- **AND** its title updates to reflect the current tool (e.g., "Reading src/config.ts") when a tool starts
- **AND** its title reverts to "Analyzing..." when a tool completes
- **AND** it is marked `complete` when the stream stops

#### Scenario: Tool call starts
- **WHEN** Claude invokes a tool (e.g., Read, Grep, git_log)
- **THEN** the system appends `task_update` chunks: one updating the thinking task title, one creating a new task card in `in_progress` status with a human-readable title

#### Scenario: Tool call completes successfully
- **WHEN** a tool call returns its result without error
- **THEN** the system appends a `task_update` chunk updating the task card to `complete` status

#### Scenario: Tool call fails
- **WHEN** a tool call returns with `is_error: true`
- **THEN** the system appends a `task_update` chunk updating the task card to `complete` status with " (failed)" appended to the title
- **AND** includes the error message as `details` on the task update

#### Scenario: submit_response excluded from task cards
- **WHEN** Claude calls the `submit_response` tool
- **THEN** no task card is created for that tool call (it is the answer, not a step)

#### Scenario: Grouped detail lines accumulate below the resolved cap
- **WHEN** five consecutive tools join the same open group with a resolved `maxDetails` of `5`
- **THEN** the task card header SHALL read `<title> (5)` and the details SHALL contain exactly five detail lines (one per call)

#### Scenario: Grouped detail lines stop at the cap while header count continues
- **WHEN** a sixth tool joins the same open group with a resolved `maxDetails` of `5`
- **THEN** the task card header SHALL read `<title> (6)`
- **AND** the system SHALL NOT append a detail line for that sixth call
- **AND** the existing five detail lines SHALL remain unchanged

#### Scenario: Cap of zero produces a header-only task card
- **WHEN** a group is opened with a resolved `maxDetails` of `0`
- **THEN** the task card SHALL be created with the group's title and no detail lines
- **AND** subsequent calls in the group SHALL increment only the header count

#### Scenario: Re-emission of grouped details respects the cap
- **WHEN** an MCP tool emits `tool_progress` (empty args) followed by `tool_use` (real args) for a call whose ordinal in the group exceeds `maxDetails`
- **THEN** the re-emission SHALL NOT append a new detail line

#### Scenario: Cap applies independently to separate groups in the same stream
- **WHEN** the stream contains two separate groups (different group keys), each with their own resolved `maxDetails`
- **THEN** each group's detail line count SHALL be governed by its own cap, independent of the other group
