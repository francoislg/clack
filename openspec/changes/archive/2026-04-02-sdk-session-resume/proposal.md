## Why

Every follow-up in a Clack thread starts a fresh Claude query. Claude has no memory of its own reasoning, tool calls, or results from previous turns -- it only sees reconstructed Slack thread text. This means it re-reads the same files, re-discovers the same patterns, and can't reference prior findings. The Claude Agent SDK already supports session resumption via `resume: sessionId`, and Clack is already persisting SDK sessions to disk (we never set `persistSession: false` in `askClaude()`). We're paying the storage cost without getting the benefit.

Additionally, 4 of 7 `query()` call sites silently persist sessions they'll never resume (summarization, error analysis, pre-analysis, MCP tests) due to the SDK default. A 5th (migrations) does the same. And a 6th (change execution) explicitly disables persistence for sessions it should actually keep. There's no enforcement that new call sites make an explicit choice about persistence.

## What Changes

- Introduce two wrapper functions (`clackQuery` and `clackSession`) that replace direct `query()` imports from the SDK. `clackQuery` hardcodes `persistSession: false` for fire-and-forget calls. `clackSession` persists sessions and supports resumption via session ID.
- Capture the SDK `session_id` from the `init` message during `clackSession` calls and store it on the Clack `SessionContext`.
- On follow-up queries (same thread), pass `resume: sdkSessionId` so Claude has full conversation history including tool calls and results.
- Wire `executeChange()` through `clackSession` so change follow-ups (review feedback, update requests) resume with full context of prior worktree work.
- Stop persisting throwaway SDK sessions: summarization, error analysis, pre-analysis, MCP tests, and migrations all switch to `clackQuery`.
- Add an admin-only MCP tool (`get_session_trace`) that retrieves the SDK conversation trace for any Clack session, enabling cross-session debugging ("debug what happened when Jimmy asked X").

## Capabilities

### New Capabilities
- `sdk-session-wrapper`: Enforced query abstraction (`clackQuery` / `clackSession`) that prevents accidental SDK session persistence and provides session resumption for multi-turn conversations.
- `session-trace-tool`: Admin-only MCP tool to retrieve the full SDK conversation trace (messages, tool calls, results) for any Clack session, enabling cross-session debugging.

### Modified Capabilities
- `session-management`: Sessions now store an `sdkSessionId` field mapping to the Claude Agent SDK session UUID, enabling resumption across turns.
- `claude-code-integration`: All SDK `query()` calls go through `clackQuery` or `clackSession` wrappers. Q&A and change execution use `clackSession` with resume support. Utility calls use `clackQuery` with persistence disabled.

## Impact

- **`src/claude/`**: New `query.ts` module with wrapper functions. `index.ts` (`askClaude`) switches to `clackSession`. `utilities.ts`, `preAnalysis.ts`, `testMcp.ts` switch to `clackQuery`.
- **`src/changes/execution.ts`**: Switches to `clackSession`, removes explicit `persistSession: false`, gains resume support for change follow-ups.
- **`src/migrations/engine.ts`**: Switches to `clackQuery` (stops persisting migration sessions).
- **`src/sessions.ts`**: `SessionContext` gains `sdkSessionId?: string` field with persistence.
- **`src/tools/`**: New `query/getSessionTrace.ts` tool, registered in `server.ts` with admin gating.
- **Disk**: Eliminates junk SDK session files from utility calls. Existing Q&A session files remain and become usable via resume.
