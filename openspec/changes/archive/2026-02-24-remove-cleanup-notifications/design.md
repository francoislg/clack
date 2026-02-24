## Context

The completion monitor (`src/changes/monitor.ts`) runs on a configurable interval and checks GitHub for PR state changes. When it detects a merge or close, it cleans up the session (worktree, memory, disk) and posts a Slack notification to the thread. That notification actively harms follow-up interactions — Claude reads it as "this is over" and refuses to help.

## Goals / Non-Goals

**Goals:**
- Remove the Slack notification from the auto-cleanup flow
- Preserve all other cleanup behavior (worktree removal, session state cleanup, logging)

**Non-Goals:**
- Changing the cleanup logic itself
- Changing the monitoring interval or configuration
- Addressing session unification (separate change)

## Decisions

### Remove `notifySessionAutoCompleted` entirely

**Decision**: Delete the function and its call site rather than making it conditional/configurable.

**Rationale**: The notification is an implementation detail that leaks internal state into the thread context. It provides no actionable information to the user (they already know the PR was merged/closed — they did it, or they can see it on GitHub). Adding a config toggle would add complexity for something that is purely harmful.

**Alternative considered**: Replace the message with something like "PR merged! You can still ask follow-up questions." — Rejected because any message from Clack about session lifecycle pollutes the thread context that Claude reads. Less is more.

## Risks / Trade-offs

- **[Users lose visibility into auto-cleanup]** → Low risk. The cleanup is invisible infrastructure. Users who care about PR state check GitHub. The Slack thread already contains the PR link.
- **[No rollback complexity]** → This is a pure removal. If we ever want notifications back, the git history has the code.
