## 1. Active-change waiting marker

- [x] 1.1 Add `waiting?: { since: Date }` to `ActiveChangeState` in `src/changes/activeState.ts` (runtime-only, documented like `handle`)
- [x] 1.2 ~~Add `setActiveChangeWaiting` setter~~ — dropped: the workflow holds the `activeChange` reference and mutates it directly (matching the existing `activeChange.worktree`/`activeChange.handle` idiom), so a dedicated setter would be test-only dead code
- [x] 1.3 Add `waiting: boolean` and `lastActivityAt: Date` to the `ActiveWorker` interface
- [x] 1.4 Project both in `getActiveWorkers()` (`waiting` from `change.waiting != null`, pass through `lastActivityAt`)
- [x] 1.5 Unit-test the `getActiveWorkers` projection (waiting true/false, lastActivityAt)

## 2. Workflow wiring via existing onQueued seam

- [x] 2.1 In `src/changes/workflow.ts`, set the waiting marker inside the existing `onQueued` handler (alongside the current log + Slack ack)
- [x] 2.2 Clear the marker right after `acquire` resolves, before worktree setup
- [x] 2.3 Marker auto-cleared on rejected/cancelled acquire — the existing catch path calls `clearActiveChange(sessionId)`, removing the whole change (and its marker), so it can never leave `waiting: true` stuck
- [x] 2.4 Unit-test: queued acquire sets then clears the marker; rejected acquire clears the change; disposable-mode path (no `onQueued`) never sets it

## 3. find_changes projection

- [x] 3.1 In `src/tools/query/findChanges.ts`, emit `waiting`, `lastActivityAt` (ISO), and derived `ageMs = Date.now() - startedAt` per entry
- [x] 3.2 Confirm no pool-internal fields are added (queue depth/position, slot ids, quarantine, setup hash)
- [x] 3.3 Update the tool description to note `waiting` semantics and that `ageMs` is age-since-start
- [x] 3.4 Update `findChanges.test.ts` to assert the new fields (waiting true/false, freshness present, no pool internals)

## 4. Verify

- [x] 4.1 `npx tsc --noEmit` clean; `npx oxlint` + `npx oxfmt --check` clean on touched files
- [x] 4.2 `npm test` green (6083 passed)
- [x] 4.3 `openspec validate find-changes-surface-waiting-state --strict` passes
