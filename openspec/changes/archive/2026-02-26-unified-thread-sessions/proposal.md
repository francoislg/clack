## Why

Clack maintains two separate session systems — Q&A sessions (`SessionContext` in `src/sessions.ts`) and change sessions (`ChangeSession` in `src/changes/session.ts`) — both anchored to the same Slack thread. This creates context amnesia: when a change session is cleaned up (PR merged/closed), all knowledge of it evaporates. A user returning to the thread gets a blank slate. The two-session model also creates a hard routing split where the emoji type determines the mode upfront, rather than letting Claude analyze intent from the message content.

## What Changes

- **Unify Q&A and change sessions into a single thread session model.** One session per thread, always. Change execution becomes runtime state attached to the session, not a separate entity.
- **Thread context from Slack becomes the primary memory.** Stop persisting `refinements[]` and `lastAnswer` — they're already in the Slack thread that gets fetched on every request. The session persists only what can't be derived: delivery preferences, staged intents, errors, and DM coordinates.
- **`workMode` becomes an intent hint, not a hard mode switch.** The permission gate stays (only `dev+` gets change tools), but within that gate, Claude decides based on message content whether to propose a change, answer a question, or take an action on an existing PR.
- **Sessions never close from the user's perspective.** There is no "session closed" state. A thread session can be idle (no active execution), but re-engaging the thread always works. Active runtime state (worktree, process handle) may come and go, but the session persists.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `session-management`: Replace the Q&A-only session model with a unified thread session. Remove `refinements[]` and `lastAnswer` as persisted fields (derived from thread context). Remove session timeout/expiry — sessions persist until explicitly cleaned up or storage-based eviction. Add optional change execution state (branch, repo, PR URL, worktree) as runtime-only fields.
- `changes-workflow`: Change sessions stop being a separate entity. Active change execution becomes runtime state on the unified thread session. Session-bound follow-up tools (`request_review`, `request_merge`, `request_close`) are removed — Claude uses GitHub MCP for PR operations on any PR and `propose_change` for worktree-based code changes. Claude determines intent from the message, not from which tools are gated.
- `slack-reaction-trigger`: `workMode` becomes a hint to Claude rather than a deterministic mode switch. The permission gate (dev+ only) remains. Non-dev users reacting with the work emoji get standard Q&A (unchanged). Dev users get the full tool set regardless of emoji, with the work emoji adding a prompt hint that biases Claude toward proposing changes.
- `clack-tools`: Tool registration is purely role-based, not state-based. Active change info (branch, PR URL, worktree) is prompt context Claude reads, not a tool gating mechanism. Remove session-bound action tools (`request_review`, `request_merge`, `request_close`). Dev+ users always get the same tool set regardless of thread state.

## Impact

- **Core session system**: `src/sessions.ts` — major refactor of `SessionContext`, session creation, persistence, and lookup
- **Change session system**: `src/changes/session.ts`, `src/changes/types.ts` — merge into unified model or become a thin runtime-state layer
- **Orchestration**: `src/slack/handlers/core.ts` — `processMessage` uses unified session lookup, no separate `getSessionByThread` call
- **Tool server**: `src/tools/server.ts` — `buildQueryTools` simplified to role-only gating; remove `request_review`, `request_merge`, `request_close` tools
- **Action tools**: `src/tools/actions/requestReview.ts`, `requestMerge.ts`, `requestClose.ts` — removed (PR operations handled by GitHub MCP)
- **Claude prompt**: `src/claude.ts` — change session context hint derived from unified session's runtime state
- **Change handlers**: `src/slack/handlers/changeAction.ts`, `changeThreadActions.ts` — use unified session
- **Persistence**: `src/changes/persistence.ts` — may merge with session persistence or become runtime-state-only
- **Restore**: `src/changes/restore.ts` — restores runtime state into unified sessions
- **Monitor**: `src/changes/monitor.ts` — operates on unified sessions' runtime state
