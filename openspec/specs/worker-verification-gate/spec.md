# worker-verification-gate Specification

## Purpose
Configuration and execution of verification checks that run before `git_push` is permitted, allowing repositories to enforce quality gates (linting, tests, security checks) before code is pushed to origin.

## Requirements

### Requirement: Per-Repository Verification Checks Configuration

The system SHALL support a per-repository configuration file that declares an ordered list of shell commands to run as verification checks before a push is permitted.

#### Scenario: Configuration file resolution

- **GIVEN** a repository named `{repo-name}` is configured
- **WHEN** the verification gate needs to load checks for that repository
- **THEN** the system resolves `{repo-name}/verification_checks.json` via the two-tier chain (`data/configuration/` first, then `data/default_configuration/`)
- **AND** if the file exists, parses it as JSON with the schema `{ checks: Array<{ name: string, command: string, timeoutSeconds?: number }>, retryBudget?: number }`
- **AND** if the file does not exist in either tier, the gate is treated as disabled for that repository

#### Scenario: Default retry budget

- **WHEN** the configuration file omits `retryBudget`
- **THEN** the system uses a default retry budget of 3

#### Scenario: Default per-check timeout

- **WHEN** a check entry omits `timeoutSeconds`
- **THEN** the system applies a default timeout of 300 seconds to that check

#### Scenario: Invalid configuration file

- **GIVEN** a verification_checks.json exists but fails to parse (invalid JSON, missing required fields, wrong types)
- **WHEN** the gate attempts to load it
- **THEN** the system logs a warning with the parse error
- **AND** treats the gate as disabled for that invocation
- **AND** `git_push` proceeds as if no config were present

### Requirement: Verification Gate Execution

The system SHALL execute verification checks in the worktree before allowing a push, in the order declared in the configuration file.

#### Scenario: All checks pass

- **GIVEN** verification_checks.json declares checks `[A, B, C]` for the repository
- **WHEN** the gate runs
- **THEN** the system executes check A via `child_process.spawn` with `shell: true` and the worktree path as `cwd`
- **AND** if A exits 0, proceeds to check B, then C
- **AND** if all exit 0, the gate result is `pass`

#### Scenario: First failing check stops the run

- **GIVEN** verification_checks.json declares checks `[A, B, C]`
- **WHEN** check A exits non-zero
- **THEN** the system does NOT execute checks B or C
- **AND** the gate result is `fail` with the failing check name, exit code, and captured output

#### Scenario: Check exceeds timeout

- **WHEN** a check runs longer than its `timeoutSeconds`
- **THEN** the system sends SIGTERM to the process
- **AND** records the check as failed with an indication the timeout was reached
- **AND** stops further checks as if the check had failed normally

#### Scenario: Check output capture

- **WHEN** a check runs
- **THEN** the system captures stdout and stderr into a combined buffer
- **AND** caps the captured buffer at approximately 64KB (tail-first)

#### Scenario: Check environment and working directory

- **WHEN** a check runs
- **THEN** the `cwd` is the worktree path for the active change
- **AND** environment variables are inherited from the worker process

### Requirement: Retry Budget Tracking

The system SHALL track verification gate attempts on the active change state so failed attempts consume a bounded retry budget.

#### Scenario: Counter initialization

- **WHEN** a change is started and an ActiveChangeState is created
- **THEN** `verificationAttempts` is initialized to 0

#### Scenario: Counter increments on failure

- **WHEN** the verification gate fails for a change
- **THEN** `verificationAttempts` is incremented by 1

#### Scenario: Counter does not increment on pass

- **WHEN** the verification gate passes
- **THEN** `verificationAttempts` is not changed

#### Scenario: Budget exhausted

- **GIVEN** `verificationAttempts` equals the configured `retryBudget`
- **WHEN** the gate fails again on the next `git_push` attempt
- **THEN** the tool returns a terminal error indicating the budget has been exhausted
- **AND** the error message instructs the worker to stop retrying and call `report_status` to end the run

#### Scenario: Counter survives within a single change session

- **GIVEN** the worker's SDK session is running and the gate has failed once (`verificationAttempts = 1`)
- **WHEN** the worker retries `git_push` later in the same session
- **THEN** the counter persists and subsequent failures increment from 1, not from 0

### Requirement: Failure Surfacing to the Worker

The system SHALL hand back verification failures to the worker as structured tool errors that include the failing check name, exit code, truncated output, and remaining retry count.

#### Scenario: Failure payload format

- **WHEN** the gate fails and `git_push` returns
- **THEN** the tool returns an error payload whose message identifies the failing check by name
- **AND** includes the exit code
- **AND** includes the tail of the combined stdout+stderr, truncated to at most 80 lines or approximately 6KB (whichever is smaller)
- **AND** includes the number of retry attempts remaining (`retryBudget - verificationAttempts`)

#### Scenario: Terminal failure payload

- **WHEN** the gate fails after the budget is exhausted
- **THEN** the tool returns an error payload that explicitly states the retry budget has been exhausted
- **AND** instructs the worker to call `report_status` with a summary and stop attempting `git_push`

### Requirement: Execution Logging

The system SHALL log each gate invocation and outcome to the per-branch execution log so session history preserves the gate activity.

#### Scenario: Log on check start

- **WHEN** a check begins running
- **THEN** the system appends a log line of the form `"Verification: <name> — running"` via `appendExecutionLog`

#### Scenario: Log on check pass

- **WHEN** a check passes
- **THEN** the system appends `"Verification: <name> — passed (<durationSeconds>s)"`

#### Scenario: Log on check fail

- **WHEN** a check fails
- **THEN** the system appends `"Verification: <name> — FAILED (exit <code>, <durationSeconds>s)"`

#### Scenario: Log on budget exhausted

- **WHEN** the retry budget is exhausted
- **THEN** the system appends `"Verification: budget exhausted after <N> attempts — aborting"`

### Requirement: Gate Disabled Behavior

The system SHALL behave identically to the pre-gate implementation when no configuration file is present for the target repository.

#### Scenario: No config file present

- **GIVEN** `{repo-name}/verification_checks.json` does not resolve in either tier
- **WHEN** the worker calls `git_push`
- **THEN** the tool pushes immediately without running any checks
- **AND** `verificationAttempts` remains 0 for the active change

#### Scenario: Empty checks array

- **GIVEN** `verification_checks.json` resolves but `checks` is an empty array
- **WHEN** the worker calls `git_push`
- **THEN** the tool pushes immediately without running any checks
- **AND** treats the gate as a pass
