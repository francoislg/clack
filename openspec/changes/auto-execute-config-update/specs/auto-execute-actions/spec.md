## MODIFIED Requirements

### Requirement: Auto-Execute Flag on Ref-Based Actions

The system SHALL support an optional `auto` boolean flag on ref-based actions (`change`, `config_update`, `update`, `review`, `merge`, `close`) in `submit_response`. When `auto` is `true`, the system executes the action immediately after posting the response, without waiting for a button click.

#### Scenario: Auto-execute a change action

- **GIVEN** Claude calls `propose_change` and receives a ref
- **WHEN** Claude calls `submit_response` with `{ type: "change", ref: "<id>", auto: true }`
- **THEN** the system posts the response to Slack
- **AND** immediately resolves the staged intent and triggers `startChangeWorkflow`
- **AND** posts a progress message in the thread that is updated with execution status

#### Scenario: Auto-execute a config_update action

- **GIVEN** Claude calls `propose_config_update` and receives a ref
- **WHEN** Claude calls `submit_response` with `{ type: "config_update", ref: "<id>", auto: true }`
- **THEN** the system posts the response to Slack
- **AND** immediately resolves the staged intent
- **AND** writes the config file via `writeInstructionFile()`
- **AND** posts a confirmation message in the thread

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

#### Scenario: Auto-execute failure posts error in thread

- **GIVEN** an action has `auto: true`
- **WHEN** the auto-executed workflow fails (e.g., session blocking, repo not found, write error)
- **THEN** the system posts the error message in the thread
- **AND** does NOT crash or affect the posted response

#### Scenario: Auto-execute with ephemeral/DM-first response

- **GIVEN** the response is ephemeral or DM-first
- **WHEN** an action has `auto: true`
- **THEN** auto-execution posts progress in the original channel thread (not the DM or ephemeral)
- **AND** uses the session's channel and threadTs for progress updates

## REMOVED Requirements

### Requirement: Auto flag not available on config_update (scenario)

**Reason**: The "Auto flag not available on config_update" scenario is removed because config_update now supports auto like all other ref-based actions.
**Migration**: Config updates with `auto: true` are now auto-executed. The scenario is replaced by "Auto-execute a config_update action" above.
