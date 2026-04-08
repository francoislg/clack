## 1. Type System & Status

- [x] 1.1 Add `"cancelled"` to `ChangeStatus` union in `src/changes/types.ts`
- [x] 1.2 Add `cancelledBy?: { userId: string; reason?: string }` to `PersistedSessionState` in `src/changes/types.ts`
- [x] 1.3 Add `cancelled?: boolean` and `cancelledBy?: { userId: string; reason?: string }` to `ChangeResult` in `src/changes/types.ts`
- [x] 1.4 Add `abortController?: AbortController` to `ActiveChangeState` in `src/changes/activeState.ts`
- [x] 1.5 Add `cancelledBy?: { userId: string; reason?: string }` to `ActiveChangeState` in `src/changes/activeState.ts`
- [x] 1.6 ~~Update `getActiveChangeBranches()`~~ — cancelled branches intentionally stay protected so the user can resume after cancellation. No change needed.

## 2. Execution Pipeline

- [x] 2.1 Accept optional `abortController` in `runClaude` options, use if provided, distinguish cancellation from timeout with `timedOut` flag (`src/changes/execution.ts`)
- [x] 2.2 Accept optional `abortController` in `ExecuteChangeOptions`, forward to `runClaudeInWorktree` (`src/changes/execution.ts`)
- [x] 2.3 Create and attach `AbortController` in `startChangeWorkflow` before execution, clean up in `finally` (`src/changes/workflow.ts`)
- [x] 2.4 Create and attach `AbortController` in `handleFollowUp` before switch, pass to all `runClaudeInWorktree`/`executeChange` calls, clean up in `finally` (`src/changes/workflow.ts`)
- [x] 2.5 Detect cancellation in `startChangeWorkflow` and `handleFollowUp`: check `activeChange.cancelledBy` after execution returns, set status to `"cancelled"` instead of `"failed"`, return `ChangeResult` with `cancelled` and `cancelledBy` fields
- [x] 2.6 Add `"cancelled"` to `terminalStatuses` in `handleFollowUp` guard in `src/changes/workflow.ts`

## 3. Persistence & Restore

- [x] 3.1 Add `statusToPhase("cancelled")` → `"Cancelled"` in `src/changes/persistence.ts`
- [x] 3.2 Persist `cancelledBy` in `writeSessionState` → `PersistedSessionState` (`src/changes/persistence.ts`)
- [x] 3.3 Treat `"cancelled"` as terminal in `restoreWorkerSessions` (`src/changes/restore.ts`)
- [x] 3.4 Add `"cancelled"` case to `shouldCleanupSession` in `src/changes/persistence.ts` to skip cleanup (preserved for resumption)

## 4. Cancel Tool

- [x] 4.1 Update `src/tools/actions/cancelWorkerRun.ts`: add `target_user_id` parameter, admin permission check for cross-user cancel, set `cancelledBy` on active change before aborting (file exists but is incomplete)
- [x] 4.2 Register `cancel_worker_run` in `buildQueryTools` alongside `propose_change`/`request_update` (`src/tools/server.ts`)
- [x] 4.3 Update `find_changes` status enum to include `"cancelled"` and return `cancelledBy` metadata for cancelled changes (`src/tools/query/findChanges.ts`)

## 5. Display

- [x] 5.1 Add cancellation-specific finalization: update `finalizeStreamedWorkflow` in `src/streaming/slackStreamer.ts` to accept optional `cancelledBy` info and format "This work session was cancelled by <@userId>". Update callers in `changeAction.ts` and `changeThreadActions.ts` to pass cancellation info from `ChangeResult`.
- [x] 5.2 Add `:no_entry_sign:` emoji for `"cancelled"` status in Home Tab (`src/slack/homeTab.ts`)

## 6. Tests

- [x] 6.1 Tests for `cancel_worker_run` tool: own run, admin cross-user, non-admin cross-user rejected, no active run, stale session, live abort
- [ ] 6.2 Tests for `runClaude` cancellation vs timeout distinction (deferred — requires mocking Agent SDK streaming)
- [x] 6.3 Tests for `statusToPhase("cancelled")` and `"cancelled"` in restore terminal statuses
