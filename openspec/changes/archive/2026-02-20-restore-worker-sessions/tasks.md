## 1. Persist Slack References

- [x] 1.1 Add `channel: string | null` and `threadTs: string | null` to `PersistedSessionState` in `src/changes/types.ts`
- [x] 1.2 Update `writeSessionState()` in `src/changes/persistence.ts` to include `channel` and `threadTs` from the session

## 2. Session Scanner

- [x] 2.1 Add `getAllPersistedSessions()` to `src/changes/persistence.ts` — scans all `data/worktree-sessions/*/state.json` and returns parsed `PersistedSessionState[]` (no status filtering)

## 3. In-Memory Registration

- [x] 3.1 Add `restoreSession()` to `src/changes/session.ts` — inserts a `ChangeSession` into `activeSessions` and `sessionsByThread` Maps without any disk writes or folder creation

## 4. Core Restoration Logic

- [x] 4.1 Create `src/changes/restore.ts` with `restoreWorkerSessions()` that reads all persisted sessions, applies status-based filtering (restore `pr_created`, downgrade mid-execution with PR, skip/fail mid-execution without PR, skip terminal states, skip missing Slack refs), validates worktree existence and repo config, reconstructs `ChangeSession` objects, and calls `restoreSession()`

## 5. Startup Wiring

- [x] 5.1 Wire `restoreWorkerSessions()` into `src/index.ts` inside the `if (config.changesWorkflow?.enabled)` block, after `initializeWorktrees()` and before `startCompletionMonitor()`, with non-fatal error handling

## 6. Verification

- [x] 6.1 Run `npx tsc` — type-check passes
- [x] 6.2 Run `npm test` — existing tests pass
