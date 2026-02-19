## Why

When the worker Claude finishes implementing changes, the orchestrator code takes over to push, create PRs, and send Slack messages. If any of these steps fail (e.g., a pre-push hook rejects the push), the entire execution is marked as failed with no recovery path — even though Claude's work (the commit) succeeded. The same fragility exists in follow-up actions (merge, review, update, close) where direct code calls handle side effects.

The query path already solved this: Claude calls MCP tools, tools return success or errors, Claude adapts. The worker path should follow the same pattern.

## What Changes

- **New unit MCP tools** for infrastructure operations: `git_push`, `ensure_pr`, `merge_pr`, `close_pr`, `report_status`
- **Worker Claude gets MCP tools**: execution, review, update, merge, and close flows all run through Claude with context-appropriate tool sets
- **Orchestrator code removed**: `ensurePR()` direct push/PR logic, `handleFollowUp()` switch-based dispatch, `reviewPR()` direct invocation — all replaced by Claude + tools
- **`COMMIT_HASH:`/`SUMMARY:` parsing removed**: tools update session state as side effects (e.g., `ensure_pr` sets `session.prUrl`), no more text marker extraction
- **Context-based tool selection**: the existing tool server gains a context parameter that controls which unit tools are registered (query, execute, update, review, merge, close)
- **Cleanup of dead code**: `ensurePR()`, `mergePR()`, `closePR()`, `reviewPR()` functions in `pr.ts`, the `handleFollowUp()` switch in `workflow.ts`, and `EXECUTION_SYSTEM_PROMPT` text-marker logic in `execution.ts`

## Capabilities

### New Capabilities
- `worker-tools`: Unit MCP tools for worker contexts — `git_push`, `ensure_pr`, `merge_pr`, `close_pr`, `report_status`. Each is an atomic operation that returns structured success/error responses. Tools handle auth, API calls, and session state updates internally.

### Modified Capabilities
- `clack-tools`: Tool server supports worker contexts alongside query contexts. `buildClackTools()` accepts a context type that determines which unit tools are registered. Same `createSdkMcpServer()` pattern, broader tool palette.
- `changes-workflow`: Orchestrator delegates all side effects to Claude via tools. `startChangeWorkflow` becomes: set up workspace, run Claude with execute tools, read session state. `handleFollowUp` becomes: run Claude with command-specific tools. No more direct push/PR/Slack code.
- `claude-code-integration`: Worker Claude invocations include the `clack` MCP server with worker tools. Execution prompts instruct Claude to push and create PRs via tools. Result capture reads session state instead of parsing text markers.

## Impact

- **`src/tools/server.ts`**: Extends `buildClackTools()` to accept context type and register worker tools
- **`src/tools/worker/`**: New directory for unit tool implementations (`gitPush.ts`, `ensurePR.ts`, `mergePR.ts`, `closePR.ts`, `reportStatus.ts`)
- **`src/changes/workflow.ts`**: `startChangeWorkflow()` and `handleFollowUp()` dramatically simplified
- **`src/changes/execution.ts`**: `executeChange()` updated to include MCP tools, prompt updated, marker parsing removed
- **`src/changes/pr.ts`**: `ensurePR()`, `mergePR()`, `closePR()`, `reviewPR()` — logic moves into tools, functions removed or reduced to thin wrappers called by tools
- **`src/tools/types.ts`**: New context type for worker vs query tool building
