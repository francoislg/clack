# failed-change-recovery Specification

## ADDED Requirements

### Requirement: Recovery Actions on Execution Failure

When a change's execution fails, the failure message posted to the change thread SHALL offer three recovery actions as buttons: ♻️ Continue, 🔄 Start over, and 🗑️ Discard. All button labels and recovery-related user-facing text SHALL be localized via `t()` with EN and FR entries.

#### Scenario: Failure message carries recovery buttons

- **GIVEN** a change in `executing` status
- **WHEN** execution fails and the status becomes `failed`
- **THEN** the failure message in the thread includes Continue, Start over, and Discard buttons

#### Scenario: Recovery buttons re-engage a stopped thread

- **GIVEN** a change thread that was silenced via the stop reaction
- **WHEN** a dev clicks any recovery button
- **THEN** the thread is re-engaged, matching the existing change-thread button behavior

### Requirement: Continue Command

The system SHALL support a `continue` follow-up command that resumes a `failed` change in its existing worktree. Continue SHALL transition the change `failed → executing`, build a resume context from the persisted session state (phase and last message), run the setup-version hash check (re-running setup on mismatch) and the idempotent install step before execution, and then proceed through the unchanged change state machine.

#### Scenario: Continue resumes with context

- **GIVEN** a change with status `failed` and persisted state (`phase`, `lastMessage`)
- **WHEN** a dev clicks Continue
- **THEN** the status becomes `executing`
- **AND** Claude runs in the same worktree with a resume context describing the previous phase and last message

#### Scenario: Continue heals stale setup

- **GIVEN** a failed change whose worker has a `setupVersionHash` that no longer matches the current `worktree_setup_instructions.md` hash
- **WHEN** a dev clicks Continue
- **THEN** setup re-runs to completion before Claude executes
- **AND** the install step runs after setup

#### Scenario: Re-failure re-offers recovery

- **GIVEN** a continued change
- **WHEN** execution fails again
- **THEN** the status returns to `failed`
- **AND** a new failure message with the same recovery buttons is posted

#### Scenario: Continued change completes normally

- **GIVEN** a continued change
- **WHEN** execution succeeds and a PR is created
- **THEN** the change reaches `pr_created` and behaves exactly like a change that never failed

### Requirement: Start Over Command

The system SHALL support a `restart` follow-up command that scraps the failed work and re-runs the original request. Start over SHALL force-reset the worktree to `origin/<defaultBranch>` (re-creating the change branch and removing uncommitted and untracked work) WITHOUT triggering the dirty-quarantine path, run the setup-version check and install step, and re-enter `executing` with the original request and no resume context.

#### Scenario: Start over resets the worktree

- **GIVEN** a failed change whose worktree contains uncommitted edits and unpushed commits
- **WHEN** a dev clicks Start over
- **THEN** the branch is reset to `origin/<defaultBranch>` and untracked files are cleaned
- **AND** no quarantine is triggered
- **AND** execution restarts from the original change request

#### Scenario: Start over heals stale setup

- **GIVEN** a failed change whose worker has a stale `setupVersionHash`
- **WHEN** a dev clicks Start over
- **THEN** setup re-runs before execution

### Requirement: Discard Command

The system SHALL support a `discard` follow-up command that abandons a `failed` change. Discard SHALL set the change status to `cancelled` and release the worker through the standard release path: a clean worker returns to the pool as `idle`; a worker with modified tracked files is quarantined (preserving the work). In disposable mode, Discard SHALL remove the worktree via the existing cleanup path.

#### Scenario: Discard a clean worker

- **GIVEN** a failed change on a reusable worker with no modified tracked files
- **WHEN** a dev clicks Discard
- **THEN** the change status becomes `cancelled`
- **AND** the worker's claim is cleared and its status returns to `idle`

#### Scenario: Discard a dirty worker quarantines

- **GIVEN** a failed change on a reusable worker with modified tracked files
- **WHEN** a dev clicks Discard
- **THEN** the change status becomes `cancelled`
- **AND** the worker is quarantined per the existing quarantine lifecycle

#### Scenario: Discard in disposable mode

- **GIVEN** a failed change in disposable mode
- **WHEN** a dev clicks Discard
- **THEN** the change status becomes `cancelled`
- **AND** the worktree directory is removed via the existing cleanup path

### Requirement: Recovery Permissions

Any user with the `dev` role or higher SHALL be able to trigger recovery actions on any failed change, regardless of who originally requested the change. The button handlers SHALL verify the clicker's role as defense-in-depth, matching the existing change-thread button gate.

#### Scenario: Another dev recovers a colleague's change

- **GIVEN** a change requested by dev A that has failed
- **WHEN** dev B clicks Continue
- **THEN** the recovery proceeds exactly as if dev A had clicked it

#### Scenario: Non-dev cannot recover

- **GIVEN** a failed change
- **WHEN** a `member`-role user clicks a recovery button
- **THEN** the action is rejected with an ephemeral permission message
- **AND** the change status remains `failed`

### Requirement: Recovery Concurrency Guard

Recovery commands SHALL be admitted only while the change status is `failed`. Once a recovery action transitions the change to `executing`, further recovery clicks SHALL be rejected with the existing busy-status message.

#### Scenario: Second click while recovering

- **GIVEN** a failed change where dev A has clicked Continue and execution is in progress
- **WHEN** dev B clicks Start over
- **THEN** the action is rejected with the busy-status message
- **AND** the in-progress recovery is unaffected

#### Scenario: Recovery rejected on truly terminal statuses

- **GIVEN** a change with status `completed` or `cancelled`
- **WHEN** a recovery command is invoked
- **THEN** it is rejected with the terminal-status message
