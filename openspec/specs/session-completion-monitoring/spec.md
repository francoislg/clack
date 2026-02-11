# session-completion-monitoring Specification

## Purpose

Background monitoring of active change sessions to detect when PRs are merged/closed externally, triggering automatic cleanup of worktrees and session state.

## Requirements

### Requirement: Session Completion Monitor

The system SHALL run a background monitor that detects when change session PRs are completed externally.

#### Scenario: Monitor startup
- **WHEN** the application starts
- **THEN** the completion monitor scheduler starts
- **AND** runs at the configured interval (default 15 minutes)

#### Scenario: Monitor shutdown
- **WHEN** the application shuts down
- **THEN** the completion monitor scheduler stops gracefully

#### Scenario: Check PR status for active sessions
- **GIVEN** sessions exist with status `pr_created` and a valid `prUrl`
- **WHEN** the monitor runs
- **THEN** it queries GitHub for each PR's current state
- **AND** uses Octokit `pulls.get()` for structured PR state

#### Scenario: Detect externally merged PR
- **GIVEN** a session has status `pr_created`
- **AND** the PR state is `MERGED`
- **WHEN** the monitor detects this
- **THEN** the session status is set to `completed`
- **AND** the worktree is deleted
- **AND** the session folder is deleted
- **AND** the session is removed from memory

#### Scenario: Detect externally closed PR
- **GIVEN** a session has status `pr_created`
- **AND** the PR state is `CLOSED` (not merged)
- **WHEN** the monitor detects this
- **THEN** the session status is set to `failed`
- **AND** the worktree is deleted
- **AND** the session folder is preserved (for debugging)
- **AND** the session is removed from memory

#### Scenario: Skip sessions without PRs
- **GIVEN** a session has status `executing` or `planning`
- **WHEN** the monitor runs
- **THEN** the session is skipped (no PR to check)

#### Scenario: Handle GitHub API errors gracefully
- **GIVEN** a PR status check fails (network error, auth issue)
- **WHEN** the monitor processes that session
- **THEN** the error is logged
- **AND** the session is NOT cleaned up
- **AND** processing continues to the next session

### Requirement: Slack Notification on Auto-Cleanup

The system SHALL notify users when their sessions are automatically cleaned up.

#### Scenario: Notify on external merge detection
- **GIVEN** a session is detected as merged externally
- **WHEN** cleanup completes
- **THEN** a message is posted to the original Slack thread
- **AND** the message indicates the PR was merged and the session cleaned up

#### Scenario: Notify on external close detection
- **GIVEN** a session is detected as closed externally
- **WHEN** cleanup completes
- **THEN** a message is posted to the original Slack thread
- **AND** the message indicates the PR was closed and the session cleaned up

#### Scenario: Notification failure does not block cleanup
- **GIVEN** a session is being auto-cleaned
- **AND** the Slack notification fails
- **WHEN** cleanup runs
- **THEN** the cleanup still completes
- **AND** the notification failure is logged

### Requirement: Completion Monitor Configuration

The system SHALL allow configuration of the completion monitor behavior.

#### Scenario: Configure monitoring interval
- **WHEN** `changesWorkflow.monitoringIntervalMinutes` is set
- **THEN** the monitor runs at that interval
- **AND** defaults to 15 minutes if not specified

#### Scenario: Disable monitoring
- **WHEN** `changesWorkflow.monitoringIntervalMinutes` is set to 0
- **THEN** the completion monitor does not start
- **AND** sessions must be cleaned up manually via Slack commands
