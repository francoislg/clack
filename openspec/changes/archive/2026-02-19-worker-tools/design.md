## Context

Today, the query path (Q&A via `askClaude`) is fully tool-driven: Claude calls MCP tools, tools return success/error, Claude adapts. The worker path (change execution via `executeChange`) is split: Claude handles the "thinking" work (implement, test, commit), then orchestrator code handles infrastructure (push, PR creation, Slack messages). When infrastructure code fails, execution dies with no recovery.

The tool server (`buildClackTools` in `server.ts`) already supports context-based tool gating (role, change thread state). The Agent SDK supports MCP servers on all `query()` invocations. The `runClaude()` function in `execution.ts` just doesn't use them yet.

## Goals / Non-Goals

**Goals:**
- All side effects (push, PR, Slack messaging, merge, close) happen through MCP tools that Claude calls
- Any tool failure returns a structured error that Claude can report/retry/adapt to
- The orchestrator code shrinks to: set up workspace → build tools → run Claude → read session state
- Same tool server architecture for query and worker contexts (one `buildClackTools` entry point, context selects tools)
- Clean up all dead orchestrator code after migration

**Non-Goals:**
- Changing the query path tools (they already work correctly)
- Adding new worker capabilities beyond what exists today (just moving existing logic into tools)
- Changing the worktree or git authentication system
- Modifying the Slack message rendering/formatting system
- Changing how external MCP servers (GitHub, Sentry) are loaded

## Decisions

### D1: Unified tool builder with mode-based selection

Extend `buildClackTools()` to accept a `mode` discriminant that controls which tools are registered. Worker modes get worker tools; query mode gets query tools. One function, one MCP server name (`clack`), one pattern.

```
buildClackTools({ mode: "query", ...queryFields })    → query + action + presentation tools
buildClackTools({ mode: "execute", ...workerFields })  → git_push, ensure_pr, report_status
buildClackTools({ mode: "update", ...workerFields })   → git_push, report_status
buildClackTools({ mode: "review", ...workerFields })   → git_push, report_status
buildClackTools({ mode: "merge", ...workerFields })    → merge_pr, report_status
buildClackTools({ mode: "close", ...workerFields })    → close_pr, report_status
```

**Why not separate builders?** The user explicitly wants composable unit tools in one server, not separate infrastructure. Same pattern, same types, same result shape.

**Alternative considered:** Separate `buildWorkerTools()` function. Rejected because it duplicates the server creation pattern and makes tool reuse harder (e.g., if query mode ever needs `report_status`).

### D2: Discriminated union for tool context

Replace the single `ToolContext` with a discriminated union:

```typescript
type ToolBuildContext =
  | QueryToolContext    // mode: "query" — userId, role, session, config, changeSession
  | WorkerToolContext   // mode: "execute"|"update"|"review"|"merge"|"close"
                        //   — worktreePath, branchName, repoName, repoUrl
                        //   — channelId, threadTs (for report_status)
                        //   — sessionId (for state updates)
                        //   — config
```

Worker context captures what tools need via closure: worktree path for git operations, Slack coordinates for messaging, session reference for state updates. Each tool factory takes just the fields it needs from context.

**Alternative considered:** Extend existing `ToolContext` with optional worker fields. Rejected because it makes the type dishonest — most fields would be undefined depending on mode.

### D3: `runClaude()` gains `mcpServers` option

Add an optional `mcpServers` parameter to `runClaude()` in `execution.ts`. When provided, it's passed through to the Agent SDK `query()` call. This is the minimal change to make worker Claude tool-aware.

The call site in `executeChange()` (and each follow-up flow) builds worker tools via `buildClackTools()` and passes the MCP server.

**Alternative considered:** Create a separate `runClaudeWithTools()` function. Rejected — unnecessary duplication. The existing function just needs one more option.

### D4: Tools update session state as side effects

Each worker tool that changes external state also updates the in-memory session as a side effect:

| Tool | Side effect |
|------|-------------|
| `git_push` | Logs push status to execution log |
| `ensure_pr` | Sets `session.prUrl`, updates session status to `pr_created` |
| `merge_pr` | Updates session status to `completed`, triggers worktree cleanup |
| `close_pr` | Updates session status to `completed`, triggers worktree cleanup |
| `report_status` | None (fire-and-forget Slack message) |

This eliminates text-marker parsing (`COMMIT_HASH:`, `SUMMARY:`, `PUSH_SUCCESS`). The orchestrator reads session state after Claude finishes to determine outcome.

**Alternative considered:** Keep text-marker parsing alongside tools. Rejected — defeats the purpose. Tools are the source of truth.

### D5: Worker tools return structured results, Claude decides

Every tool returns a structured JSON response:

```typescript
// Success
{ success: true, pr_url: "https://github.com/..." }

// Failure with actionable detail
{ success: false, error: "pre-push hook failed", details: "eslint: 3 errors in src/foo.ts" }
```

Claude receives the tool result and decides what to do: retry, fix the issue, report to the user via `report_status`, or move on. No tool throws — all errors are returned in the response.

### D6: `report_status` replaces `onProgress` callbacks

Currently, the orchestrator sends Slack progress messages via `onProgress` callbacks during execution. With `report_status` as a tool, Claude sends progress messages directly to the Slack thread.

The tool takes a message string and posts it to the thread (using `chat.postMessage` or `chat.update`). The orchestrator no longer needs progress callbacks for worker flows.

For the initial "Setting up workspace..." and "Implementing changes..." messages, the orchestrator still posts one initial message before Claude starts. After that, Claude owns communication via `report_status`.

**Trade-off:** Claude controls message frequency. Acceptable because Claude naturally sends messages at tool-use boundaries, which is a reasonable cadence.

### D7: Execution prompt changes

The `EXECUTION_SYSTEM_PROMPT` changes from:

> "Commit your changes... Output COMMIT_HASH: and SUMMARY:"

To:

> "Commit your changes. Push using the `git_push` tool. Create a PR using the `ensure_pr` tool. Report your progress and results using `report_status`."

Each follow-up action (review, update, merge, close) gets a tailored prompt that references the available tools. The prompts become shorter because the tools are self-documenting.

### D8: Orchestrator flow after migration

**`startChangeWorkflow`:**
1. Create worktree, run setup
2. Build worker tools with `mode: "execute"`
3. Run Claude with tools (Claude implements, commits, pushes, creates PR, reports)
4. Read session state for `prUrl` and status
5. Return result

**`handleFollowUp`:**
1. Build worker tools with `mode: command` (update/review/merge/close)
2. Run Claude with tools and command-specific prompt
3. Read session state for outcome
4. Return result

No switch statement. No direct API calls. The orchestrator is just context setup + Claude invocation + result reading.

### D9: Cleanup targets

After migration, remove:
- `ensurePR()` function body in `pr.ts` (logic moves to `ensure_pr` tool)
- `mergePR()` function body in `pr.ts` (logic moves to `merge_pr` tool)
- `closePR()` function body in `pr.ts` (logic moves to `close_pr` tool)
- `reviewPR()` function in `pr.ts` (review prompt moves to orchestrator, tools handle push)
- `handleFollowUp()` switch branches in `workflow.ts` (replaced by tool-driven dispatch)
- `COMMIT_HASH:`/`SUMMARY:`/`PUSH_SUCCESS` parsing in `execution.ts`
- `onProgress` callback plumbing in workflow and execution (replaced by `report_status`)
- `generateChangePlan()` if unused (plan generation is now inline in `askClaude`)

Keep `getPRStatus()` and `parsePRUrl()` — tools will use these internally.

## Risks / Trade-offs

**[Token cost increase]** → Worker Claude now uses tokens to call tools that were previously direct code. Mitigation: the tool calls are brief (push, create PR) and the overall token increase is small relative to the implementation work Claude already does.

**[Claude might not call tools in the right order]** → e.g., calling `ensure_pr` before committing. Mitigation: tools validate preconditions and return clear errors. The execution prompt specifies the expected sequence. In practice, Claude follows instructions reliably.

**[Slack message frequency]** → Claude controls when `report_status` is called. Mitigation: prompt instructs Claude to report at key milestones (start, completion, errors), not on every tool call. Can add rate limiting in the tool if needed later.

**[Session state consistency]** → Tools update session state as side effects. If Claude's execution is aborted mid-way, session state may be partially updated. Mitigation: this is the same risk as today (orchestrator code can also be interrupted). Session recovery already handles partial state via worktree detection.

**[Large change surface]** → Touches tool server, execution, workflow, and PR modules. Mitigation: the migration can be done incrementally — add worker tools first, then migrate one flow at a time (execute → update → review → merge → close), then clean up.
