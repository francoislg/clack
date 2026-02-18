# auto-execute-actions Specification

## Purpose
Auto-execution of ref-based actions (change, update, review, merge, close) when Claude sets `auto: true` in `submit_response`, enabling immediate workflow execution without requiring a button click for clear user directives.

## Requirements

### Requirement: Auto-Execute Flag on Ref-Based Actions

The system SHALL support an optional `auto` boolean flag on ref-based actions (`change`, `update`, `review`, `merge`, `close`) in `submit_response`. When `auto` is `true`, the system executes the action immediately after posting the response, without waiting for a button click.

#### Scenario: Auto-execute a change action

- **GIVEN** Claude calls `propose_change` and receives a ref
- **WHEN** Claude calls `submit_response` with `{ type: "change", ref: "<id>", auto: true }`
- **THEN** the system posts the response to Slack
- **AND** immediately resolves the staged intent and triggers `startChangeWorkflow`
- **AND** posts a progress message in the thread that is updated with execution status

#### Scenario: Auto-execute an update action

- **GIVEN** an active change thread with a PR
- **AND** Claude calls `request_update` and receives a ref
- **WHEN** Claude calls `submit_response` with `{ type: "update", ref: "<id>", auto: true }`
- **THEN** the system posts the response to Slack
- **AND** immediately resolves the staged intent and triggers the update follow-up
- **AND** posts a progress message in the thread that is updated with execution status

#### Scenario: Auto-execute a merge action

- **GIVEN** an active change thread with a PR
- **AND** Claude calls `request_merge` and receives a ref
- **WHEN** Claude calls `submit_response` with `{ type: "merge", ref: "<id>", auto: true }`
- **THEN** the system posts the response to Slack
- **AND** immediately resolves the staged intent and triggers the merge follow-up

#### Scenario: Auto-execute a review action

- **GIVEN** an active change thread with a PR
- **AND** Claude calls `request_review` and receives a ref
- **WHEN** Claude calls `submit_response` with `{ type: "review", ref: "<id>", auto: true }`
- **THEN** the system posts the response to Slack
- **AND** immediately resolves the staged intent and triggers the review follow-up

#### Scenario: Auto-execute a close action

- **GIVEN** an active change thread with a PR
- **AND** Claude calls `request_close` and receives a ref
- **WHEN** Claude calls `submit_response` with `{ type: "close", ref: "<id>", auto: true }`
- **THEN** the system posts the response to Slack
- **AND** immediately resolves the staged intent and triggers the close follow-up

#### Scenario: Auto flag defaults to false

- **WHEN** Claude calls `submit_response` with a ref-based action without `auto`
- **THEN** the action renders as a button and waits for user click (existing behavior)

#### Scenario: Auto flag not available on config_update

- **WHEN** Claude calls `submit_response` with `{ type: "config_update", ref: "<id>", auto: true }`
- **THEN** the `auto` flag is ignored
- **AND** the action renders as a button requiring user confirmation

#### Scenario: Auto-execute failure posts error in thread

- **GIVEN** an action has `auto: true`
- **WHEN** the auto-executed workflow fails (e.g., session blocking, repo not found)
- **THEN** the system posts the error message in the thread
- **AND** does NOT crash or affect the posted response

#### Scenario: Auto-execute with ephemeral/DM-first response

- **GIVEN** the response is ephemeral or DM-first
- **WHEN** an action has `auto: true`
- **THEN** auto-execution posts progress in the original channel thread (not the DM or ephemeral)
- **AND** uses the session's channel and threadTs for progress updates

### Requirement: Claude Instruction Guidance for Auto-Execute

The system SHALL include instructions guiding Claude on when to set `auto: true`.

#### Scenario: Clear directive uses auto

- **WHEN** the user gives a clear directive ("Fix this", "Do it", "Merge the PR", "Update the PR with X")
- **THEN** Claude sets `auto: true` on the corresponding ref-based action

#### Scenario: Ambiguous intent uses button

- **WHEN** the user's intent is ambiguous or Claude is suggesting a change the user hasn't explicitly requested
- **THEN** Claude does NOT set `auto: true`
- **AND** the action renders as a confirmation button

#### Scenario: Proactive suggestion uses button

- **WHEN** Claude identifies a bug or issue and offers to fix it via a `choice` action
- **THEN** the resulting change action (if chosen) does NOT use `auto: true`
- **AND** the user confirms via button click
