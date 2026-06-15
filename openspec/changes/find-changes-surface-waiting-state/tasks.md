## 1. Active-change waiting marker

- [ ] 1.1 Add `waiting?: { since: Date }` to `ActiveChangeState` in `src/changes/activeState.ts` (runtime-only, documented like `handle`)
- [ ] 1.2 Add `setActiveChangeWaiting(sessionId, waiting: boolean)` setter — mutates in-memory state, no-ops if session absent, no disk write
- [ ] 1.3 Add `waiting: boolean` and `lastActivityAt: Date` to the `ActiveWorker` interface
- [ ] 1.4 Project both in `getActiveWorkers()` (`waiting` from `change.waiting != null`, pass through `lastActivityAt`)
- [ ] 1.5 Unit-test the setter (set/clear/absent-session no-op) and the `getActiveWorkers` projection

## 2. Workflow wiring via existing onQueued seam

- [ ] 2.1 In `src/changes/workflow.ts`, set the waiting marker inside the existing `onQueued` handler (alongside the current log + Slack ack)
- [ ] 2.2 Clear the marker right after `acquire` resolves, before worktree setup
- [ ] 2.3 Clear the marker in the error/`finally` path so a rejected/cancelled queued acquire (`PoolExhausted`, cancellation) never leaves `waiting: true` stuck
- [ ] 2.4 Unit-test: queued acquire sets then clears the marker; rejected acquire clears it; disposable-mode path (no `onQueued`) never sets it

## 3. find_changes projection

- [ ] 3.1 In `src/tools/query/findChanges.ts`, emit `waiting`, `lastActivityAt` (ISO), and derived `ageMs = Date.now() - startedAt` per entry
- [ ] 3.2 Confirm no pool-internal fields are added (queue depth/position, slot ids, quarantine, setup hash)
- [ ] 3.3 Update the tool description to note `waiting` semantics and that `ageMs` is age-since-start
- [ ] 3.4 Update `findChanges.test.ts` to assert the new fields (waiting true/false, freshness present, no pool internals)

## 4. Verify

- [ ] 4.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` clean on touched files
- [ ] 4.2 `npm test` green
- [ ] 4.3 `openspec validate find-changes-surface-waiting-state --strict` passes
