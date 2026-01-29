## Why

Currently, change sessions remain active until manually closed via Slack commands (merge, close). If a PR is merged or closed directly on GitHub, the session stays open indefinitely, consuming resources (worktree on disk, memory for session tracking) and cluttering the Home tab with stale workers.

## What Changes

- Add a background scheduler that periodically checks PR status for active sessions
- Automatically clean up sessions when their PRs are merged or closed externally
- Delete the associated worktree and session folder when a session completes
- Optionally notify the user in the original Slack thread when auto-cleanup occurs

## Capabilities

### New Capabilities

- `session-completion-monitoring`: Background monitoring of active change sessions to detect when PRs are merged/closed externally, triggering automatic cleanup of worktrees and session state.

### Modified Capabilities

- `changes-workflow`: Add session expiry configuration and automatic cleanup behavior when PRs are completed outside of Slack commands.

## Impact

- `src/changes/`: New monitoring scheduler, integration with PR status checks
- `src/index.ts`: Start/stop the monitoring scheduler on app lifecycle
- `src/changes/session.ts`: Add methods for marking sessions as auto-completed
- `src/changes/pr.ts`: Add PR status check function
- Config: Optional `changesWorkflow.monitoringIntervalMinutes` setting
