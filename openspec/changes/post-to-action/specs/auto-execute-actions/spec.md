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

#### Scenario: Auto-execute post_to in DM-first mode

- **GIVEN** a DM-first session where the user is refining an answer
- **WHEN** Claude calls `submit_response` with `{ type: "post_to", auto: true }`
- **THEN** the system posts the response to the DM thread
- **AND** immediately reads the snapshot content persisted at delivery time
- **AND** resolves the target via fallback chain: explicit params → origin channel → assistant channel → session channel
- **AND** posts the snapshot content to the resolved target
- **AND** stores the `channelPostTs` for future updates
- **AND** confirms in the DM thread: "Answer posted."

#### Scenario: Auto-execute post_to as top-level channel message

- **GIVEN** a Thread, Mention, or Assistant session
- **WHEN** Claude calls `submit_response` with `{ type: "post_to", auto: true }` and no explicit `channel` or `thread_ts`
- **THEN** the system reads the snapshot content persisted at delivery time
- **AND** resolves the target channel via fallback chain (session channel for Thread/Mention, assistant channel for Assistant)
- **AND** posts the snapshot content as a top-level message in the resolved channel (no `thread_ts`)

#### Scenario: Auto-execute post_to with explicit target

- **GIVEN** any session
- **WHEN** Claude calls `submit_response` with `{ type: "post_to", auto: true, channel: "<id>", thread_ts: "<ts>" }`
- **THEN** the system posts the snapshot content to the specified channel and thread
- **AND** the fallback chain is not used

#### Scenario: Auto-execute post_to skipped for DM and auto-respond

- **GIVEN** a Direct Message session (no channel context) or an auto-respond session
- **WHEN** Claude calls `submit_response` with `{ type: "post_to", auto: true }`
- **THEN** the system logs a debug message and does NOT post
- **AND** the response delivery to the current thread is unaffected

#### Scenario: Auto flag defaults to false

- **WHEN** Claude calls `submit_response` with an action without `auto`
- **THEN** the action renders as a button and waits for user click (existing behavior)

#### Scenario: Auto-execute failure posts error in thread

- **GIVEN** an action has `auto: true`
- **WHEN** the auto-executed workflow fails (e.g., session blocking, repo not found, write error)
- **THEN** the system posts the error message in the thread
- **AND** does NOT crash or affect the posted response

#### Scenario: Auto-execute receives DM coordinates
- **WHEN** `handleAutoExecuteActions` is called after posting a response
- **THEN** it receives optional `dmChannel` and `dmThreadTs` parameters
- **AND** if set, passes them to `triggerChangeWorkflow` and `triggerFollowUp` as stream target overrides
- **AND** progress streaming targets the DM thread instead of the channel thread

#### Scenario: Auto-execute with ephemeral/DM-first response

- **GIVEN** the response is in DM mode
- **WHEN** an action has `auto: true`
- **THEN** auto-execution streams progress in the DM thread (via `dmChannel`/`dmThreadTs`)
- **AND** uses a `SlackStreamer` in the DM thread for live task card updates

### Requirement: Claude Instruction Guidance for Auto-Execute

The system SHALL include instructions guiding Claude on when to set `auto: true`.

#### Scenario: Clear directive uses auto

- **WHEN** the user gives a clear directive ("Fix this", "Do it", "Merge the PR", "Update the PR with X")
- **THEN** Claude sets `auto: true` on the corresponding ref-based action

#### Scenario: Clear post-to directive uses auto

- **WHEN** the user explicitly asks to post content elsewhere ("post that in the channel", "share this to the thread", "in the channel")
- **THEN** Claude sets `auto: true` on the `post_to` action

#### Scenario: Ambiguous intent uses button

- **WHEN** the user's intent is ambiguous or Claude is suggesting a change the user hasn't explicitly requested
- **THEN** Claude does NOT set `auto: true`
- **AND** the action renders as a confirmation button

#### Scenario: Proactive suggestion uses button

- **WHEN** Claude identifies a bug or issue and offers to fix it via a `choice` action
- **THEN** the resulting change action (if chosen) does NOT use `auto: true`
- **AND** the user confirms via button click

### Requirement: Auto-Execute Permission Gating

The system SHALL only auto-execute ref-based actions for users with the dev role or higher. The `post_to` action is NOT ref-based and SHALL be available to all roles.

#### Scenario: Privileged user auto-execute proceeds

- **GIVEN** a user with dev, admin, or owner role
- **WHEN** a response contains a ref-based action with `auto: true`
- **THEN** the system auto-executes the action immediately after posting the response

#### Scenario: Non-privileged user auto-execute blocked for ref-based actions

- **GIVEN** a user with the member role
- **WHEN** a response contains a ref-based action with `auto: true`
- **THEN** the system does NOT auto-execute the action
- **AND** the action renders as a button (but the button handler also checks permissions)

#### Scenario: post_to auto-execute available to all roles

- **GIVEN** a user with any role (including member)
- **WHEN** a response contains a `post_to` action with `auto: true`
- **THEN** the system auto-executes the `post_to` action regardless of role

#### Scenario: Role defaults to member when unset

- **WHEN** the role is not provided to the auto-execute handler
- **THEN** the system defaults to `"member"` and does NOT auto-execute ref-based actions
- **AND** `post_to` auto-execute still proceeds
