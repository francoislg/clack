## 1. Query Wrapper Functions

- [x] 1.1 Create `src/claude/query.ts` with `clackQuery()` and `clackSession()` wrappers. `clackQuery` hardcodes `persistSession: false`. `clackSession` sets `persistSession: true`, accepts optional `resumeSessionId`, and captures `session_id` from the init message via an `onSessionId` callback.
- [x] 1.2 Add graceful degradation to `clackSession`: catch resume failures, log warning, fall back to fresh session, emit the new session ID.
- [x] 1.3 Write tests for `clackQuery` (verifies `persistSession: false`) and `clackSession` (verifies persistence, resume passthrough, session ID capture, graceful fallback).

## 2. Migrate Call Sites to Wrappers

- [x] 2.1 Switch `askClaude()` in `src/claude/index.ts` to use `clackSession()`. Pass `session.sdkSessionId` as `resumeSessionId`. Store captured session ID on the session via `onSessionId` callback. (Depends on 3.1 for `sdkSessionId` field.)
- [x] 2.2 Switch `runClaudeInWorktree()` in `src/changes/execution.ts` to use `clackSession()`. Remove explicit `persistSession: false`. Accept and pass `resumeSessionId` from change state.
- [x] 2.3 Switch `summarizeForSlack()` and `analyzeError()` in `src/claude/utilities.ts` to use `clackQuery()`.
- [x] 2.4 Switch `runPreAnalysis()` in `src/claude/preAnalysis.ts` to use `clackQuery()`.
- [x] 2.5 Switch `testMcpServer()` in `src/claude/testMcp.ts` to use `clackQuery()`.
- [x] 2.6 Switch migration engine in `src/migrations/engine.ts` to use `clackQuery()`.
- [x] 2.7 Remove all direct `import { query } from "@anthropic-ai/claude-agent-sdk"` statements from call sites.

## 3. Session State Changes

- [x] 3.1 Add `sdkSessionId?: string` to `SessionContext` in `src/sessions.ts`. Ensure it is persisted to `context.json` (not stripped by `stripRuntimeFields`).
- [x] 3.2 Add `lastSeenThreadTs?: string` to `SessionContext` for thread context delta tracking. Persist to `context.json`.
- [x] 3.3 Wire `askClaude()` to save the SDK session ID to the Clack session after each query (via `updateSession`).
- [x] 3.4 Update `buildPrompt()` in `src/claude/promptBuilder.ts` to inject delta thread context (messages newer than `lastSeenThreadTs`) when resuming, full thread context otherwise.
- [x] 3.5 Update `lastSeenThreadTs` after each successful query completion.

## 4. Change Execution Resume

- [x] 4.1 Add `sdkSessionId?: string` to `ActiveChangeState` (the mutable runtime state that survives across follow-ups). If it needs to survive restarts, also update the persistence path in `src/changes/persistence.ts`.
- [x] 4.2 Pass `resumeSessionId` from change state into `executeChange()` and through to `runClaudeInWorktree()`.
- [x] 4.3 Capture and store the SDK session ID after change execution calls.
- [x] 4.4 Update the `update` and `review` cases in `handleFollowUp()` in `src/changes/workflow.ts` to pass the stored SDK session ID when re-invoking `executeChange()` / `runClaudeInWorktree()`.

## 5. Session Trace Tool

- [x] 5.1 Create `src/tools/query/getSessionTrace.ts` implementing the `get_session_trace` MCP tool. Reads SDK JSONL files, parses into structured summary with default and verbose modes.
- [x] 5.2 Register `get_session_trace` in `src/tools/server.ts` with admin role gating.
- [x] 5.3 Write tests for the trace tool (parsing, truncation, missing session handling, access control).

## 6. Verification

- [x] 6.1 Run `npx tsc --noEmit` to verify no type errors.
- [x] 6.2 Run `npm test` to verify existing tests pass.
- [x] 6.3 Verify no remaining direct `query` imports from `@anthropic-ai/claude-agent-sdk` outside `src/claude/query.ts`.
