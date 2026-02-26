## 1. Unified Session Model

- [x] 1.1 Add optional `activeChange` field to `SessionContext` interface in `src/sessions.ts` (branch, repo, description, worktree, status, prUrl, startedAt, lastActivityAt)
- [x] 1.2 Remove `refinements[]`, `lastAnswer`, and `threadContext` from `SessionContext` persistence — stop writing them to `context.json` (keep reading them for backward compat during transition, then remove)
- [x] 1.3 Add in-memory `Map<string, string>` index (`channel:threadTs` → `sessionId`) in `src/sessions.ts`
- [x] 1.4 Update `findSessionByThread()` to use index first, fall back to disk scan on miss, populate index on hit
- [x] 1.5 Update `createSession()` to populate the index on creation

## 2. Merge Change Session Into Unified Session

- [x] 2.1 Add functions to `src/sessions.ts` for managing `activeChange`: `setActiveChange()`, `clearActiveChange()`, `getActiveChangeForUser()`, `getActiveChangeCount()`
- [x] 2.2 Update `startChangeWorkflow()` in `src/changes/workflow.ts` to attach `activeChange` to the existing thread session instead of creating a separate `ChangeSession`
- [x] 2.3 Update `src/changes/execution.ts` to read/write `activeChange` on the unified session
- [x] 2.4 Update `src/changes/monitor.ts` to clear `activeChange` from the unified session instead of removing a separate session (also remove `notifySessionAutoCompleted` — covered by separate change)
- [x] 2.5 Update `src/changes/restore.ts` to restore `activeChange` runtime state into unified sessions from `data/worktree-sessions/`
- [x] 2.6 Remove `src/changes/session.ts` (the `activeSessions` and `sessionsByThread` maps are replaced by the unified session index)

## 3. Remove Session-Bound Action Tools

- [x] 3.1 Delete `src/tools/actions/requestReview.ts`
- [x] 3.2 Delete `src/tools/actions/requestMerge.ts`
- [x] 3.3 Delete `src/tools/actions/requestClose.ts`
- [x] 3.4 Remove imports and registrations of deleted tools from `src/tools/server.ts`
- [x] 3.5 Remove the `changeSession`-gated tool registration block in `buildQueryTools()` (the `if (ctx.changeSession && canRequestChanges(ctx.role))` block)
- [x] 3.6 Update `src/tools/types.ts` to remove `changeSession` from `QueryToolContext` if no longer needed

## 4. Simplify Tool Registration to Role-Only Gating

- [x] 4.1 Update `buildQueryTools()` in `src/tools/server.ts` — register `propose_change` and query tools based purely on role + `changesWorkflowEnabled`, not on session state
- [x] 4.2 Keep `request_update` tool (or absorb into `propose_change` detecting existing worktree) — this is the one action that needs Clack worktree infrastructure
- [x] 4.3 Remove `changeSession` parameter from `ToolBuildContext` / `QueryToolContext`

## 5. Update Claude Prompt Construction

- [x] 5.1 Update `buildPrompt()` in `src/claude.ts` to derive active change context from `session.activeChange` instead of `options.changeSession`
- [x] 5.2 Remove `session.lastAnswer` and `session.refinements` from prompt construction — these are now in the thread context messages
- [x] 5.3 Ensure prompt tells Claude that GitHub MCP is available for PR operations (merge, close, comment, review) on any PR
- [x] 5.4 Update `workMode` prompt hint to be advisory only — no mention of tool availability changes

## 6. Update processMessage and Handlers

- [x] 6.1 Update `processMessage()` in `src/slack/handlers/core.ts` — single session lookup via `findSessionByThread()`, remove separate `getSessionByThread()` call for change sessions
- [x] 6.2 Pass `session.activeChange` as context to `askClaude()` instead of a separate `changeSession`
- [x] 6.3 Update `src/slack/handlers/changeAction.ts` to work with unified session
- [x] 6.4 Update `src/slack/handlers/changeThreadActions.ts` to work with unified session
- [x] 6.5 Update `src/slack/handlers/newQuery.ts` — `workMode` remains permission-gated (dev+ only) but only affects prompt hint

## 7. Replace Timeout With Age-Based Eviction

- [x] 7.1 Update `cleanupExpiredSessions()` in `src/sessions.ts` from timeout-based to age-based (default 30 days)
- [x] 7.2 Skip eviction for sessions with active `activeChange` in non-terminal status
- [x] 7.3 Remove entries from the in-memory thread index when sessions are evicted
- [x] 7.4 Update cleanup interval default from 5 minutes to 60 minutes

## 8. Verify

- [x] 8.1 Run `npx tsc` — no type errors
- [x] 8.2 Run `npm test` — all tests pass
- [ ] 8.3 Verify a fresh query in a new thread creates a unified session with no `activeChange`
- [ ] 8.4 Verify a change workflow attaches `activeChange` to the session and clears it on completion
- [ ] 8.5 Verify re-engaging a thread after a PR was merged/closed works — Claude reads thread context and can help
