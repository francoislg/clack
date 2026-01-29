## 1. Configuration

- [x] 1.1 Add `monitoringIntervalMinutes` to `ChangesWorkflowConfig` interface in `src/config.ts`
- [x] 1.2 Update config validation to parse the new field (default: 15)
- [x] 1.3 Update `data/config.example.json` with the new option

## 2. PR Status Check

- [x] 2.1 Add `getPRStatus(prUrl: string)` function in `src/changes/pr.ts` that returns `{ state: 'OPEN' | 'MERGED' | 'CLOSED' }` using `gh pr view --json state`
- [x] 2.2 Handle errors gracefully (network failures, invalid URLs) and return `null` on failure

## 3. Completion Monitor Core

- [x] 3.1 Create `src/changes/monitor.ts` with `checkSessionCompletion(session)` function that checks PR status and returns cleanup action needed
- [x] 3.2 Add `runCompletionCheck()` that iterates all sessions with status `pr_created` and processes each
- [x] 3.3 Implement cleanup logic: call `removeWorktree()`, `removeSession()`, and update status appropriately for merged vs closed

## 4. Slack Notifications

- [x] 4.1 Add `notifySessionAutoCompleted(session, reason: 'merged' | 'closed')` function that posts to the original Slack thread
- [x] 4.2 Handle notification failures gracefully (log error, don't block cleanup)

## 5. Scheduler Integration

- [x] 5.1 Add `startCompletionMonitor()` and `stopCompletionMonitor()` exports from `src/changes/monitor.ts`
- [x] 5.2 Integrate into `src/index.ts` lifecycle (start after app starts, stop on shutdown)
- [x] 5.3 Skip starting monitor if `monitoringIntervalMinutes` is 0

## 6. Testing

- [ ] 6.1 Manually test with a session that has a PR, then merge the PR via GitHub web UI
- [ ] 6.2 Verify worktree is deleted, session removed, and Slack notification sent
- [ ] 6.3 Test with closed (not merged) PR and verify session folder is preserved
