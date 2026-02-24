## Why

When the completion monitor detects a PR was merged or closed externally, it posts a Slack notification like "Your PR was closed externally. Session cleaned up automatically." This message poisons Claude's reasoning — when a user later re-engages the thread, Claude reads the thread context, sees "session cleaned up," and concludes it can't help. The notification is an implementation detail that actively harms the user experience.

## What Changes

- **Remove the Slack notification** posted by the completion monitor when sessions are auto-cleaned. The monitor still detects external merges/closes and performs cleanup (worktree removal, session state cleanup) — it just stops telling the user about it in the thread.
- Remove the `notifySessionAutoCompleted` function and its invocation from the completion check loop.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `session-completion-monitoring`: Remove the "Slack Notification on Auto-Cleanup" requirement entirely. The monitor still cleans up sessions, but no longer posts messages to Slack threads.

## Impact

- `src/changes/monitor.ts` — Remove `notifySessionAutoCompleted()` function and its call in `runCompletionCheck()`
- No API changes, no config changes, no breaking changes
- Existing threads that already received cleanup notifications are unaffected (messages already posted stay)
