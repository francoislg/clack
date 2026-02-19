## 1. Types and Context

- [x] 1.1 Add `WorkerToolContext` type to `src/tools/types.ts` with worktree path, branch name, repo name, repo URL, channel ID, thread timestamp, session ID, and config
- [x] 1.2 Create discriminated union `ToolBuildContext = QueryToolContext | WorkerToolContext` with `mode` discriminant in `src/tools/types.ts`
- [x] 1.3 Update `buildToolContext()` in `src/tools/context.ts` to support both query and worker context construction

## 2. Worker Tool Implementations

- [x] 2.1 Create `src/tools/worker/gitPush.ts` — `git_push` tool: refresh auth, push via simple-git, return structured result
- [x] 2.2 Create `src/tools/worker/ensurePR.ts` — `ensure_pr` tool: check existing PR, resolve template, create via Octokit, update session state
- [x] 2.3 Create `src/tools/worker/mergePR.ts` — `merge_pr` tool: merge via Octokit, delete remote branch, clean up worktree/session
- [x] 2.4 Create `src/tools/worker/closePR.ts` — `close_pr` tool: close via Octokit, optional branch deletion, clean up worktree/session
- [x] 2.5 Create `src/tools/worker/reportStatus.ts` — `report_status` tool: post message to Slack thread via `chat.postMessage`

## 3. Tool Server Integration

- [x] 3.1 Update `buildClackTools()` in `src/tools/server.ts` to accept `ToolBuildContext` (discriminated union) instead of `ToolContext`
- [x] 3.2 Add mode-based tool registration: `execute` → git_push + ensure_pr + report_status, `update` → git_push + report_status, `review` → git_push + report_status, `merge` → merge_pr + report_status, `close` → close_pr + report_status
- [x] 3.3 Update `askClaude()` in `src/claude.ts` to pass `{ mode: "query", ... }` when building tools (adapt to new union type)

## 4. runClaude MCP Support

- [x] 4.1 Add optional `mcpServers` parameter to `runClaude()` in `src/changes/execution.ts`
- [x] 4.2 Pass `mcpServers` through to the Agent SDK `query()` call when provided

## 5. Migrate Execute Flow

- [x] 5.1 Update `executeChange()` to build worker tools with `mode: "execute"` and pass MCP server to `runClaudeInWorktree()`
- [x] 5.2 Update `EXECUTION_SYSTEM_PROMPT` to instruct Claude to use `git_push`, `ensure_pr`, and `report_status` tools
- [x] 5.3 Remove `COMMIT_HASH:`/`SUMMARY:` text-marker parsing from `executeChange()`
- [x] 5.4 Update `startChangeWorkflow()` to read session state for `prUrl` instead of calling `ensurePR()` directly
- [x] 5.5 Remove `onProgress` callback plumbing from `startChangeWorkflow()` (orchestrator posts one initial message, then Claude uses `report_status`)

## 6. Migrate Follow-Up Flows

- [x] 6.1 Refactor `handleFollowUp()` to replace switch-based dispatch with tool-driven Claude invocations per command
- [x] 6.2 Migrate `update` command: build tools with `mode: "update"`, run Claude with update prompt + git_push/report_status tools
- [x] 6.3 Migrate `review` command: fetch PR comments in orchestrator, build tools with `mode: "review"`, run Claude with review prompt
- [x] 6.4 Migrate `merge` command: build tools with `mode: "merge"`, run Claude with merge prompt + merge_pr/report_status tools
- [x] 6.5 Migrate `close` command: build tools with `mode: "close"`, run Claude with close prompt + close_pr/report_status tools

## 7. Cleanup

- [x] 7.1 Remove `ensurePR()` function body from `src/changes/pr.ts` (logic now in ensure_pr tool)
- [x] 7.2 Remove `mergePR()` function body from `src/changes/pr.ts` (logic now in merge_pr tool)
- [x] 7.3 Remove `closePR()` function body from `src/changes/pr.ts` (logic now in close_pr tool)
- [x] 7.4 Remove `reviewPR()` function from `src/changes/pr.ts` (review prompt moved to orchestrator)
- [x] 7.5 Remove `onProgress` callback parameters from `executeChange()` and workflow functions
- [x] 7.6 Remove `generateChangePlan()` from `src/changes/execution.ts` if no longer used — KEPT: still used by `src/slack/handlers/newQuery.ts`
- [x] 7.7 Clean up unused imports across all modified files + removed deprecated `ToolContext`/`buildToolContext` aliases
