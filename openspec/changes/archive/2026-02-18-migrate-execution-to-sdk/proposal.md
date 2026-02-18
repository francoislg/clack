## Why

The changes workflow (`src/changes/execution.ts`) spawns the `claude` CLI as a child process via `node:child_process.spawn()`, while the Q&A path (`src/claude.ts`) already uses the Claude Agent SDK's `query()` function. This causes `ENOENT` errors on Windows (where the CLI installs as a `.cmd` wrapper that `spawn` can't resolve without `shell: true`), requires ~250 lines of manual stream-JSON parsing and process lifecycle management, and creates two divergent integration patterns for the same underlying capability.

## What Changes

- Replace the `runClaude()` function in `src/changes/execution.ts` with an implementation backed by the Agent SDK `query()` function
- Remove all `spawn`/`child_process` usage, stream-JSON parsing, heartbeat intervals, and manual stdout/stderr handling
- Preserve the existing function signature and return type so all callers (`executeChange`, `generateChangePlan`, `runWorktreeSetup`, PR creation, review, detection, workflow) continue working without changes
- Pass `env` (for `GIT_AUTHOR_NAME`/`GIT_COMMITTER_NAME`) through the SDK's `env` option
- Implement timeout via `AbortController` instead of `setTimeout` + `proc.kill`
- Set `persistSession: false` since these are ephemeral automated runs

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `claude-code-integration`: The "Autonomous Change Execution" requirement changes from spawning a CLI subprocess to using the Agent SDK `query()` function directly. The behavioral contract (tools, timeout, cwd, system prompt, result capture) stays the same, but the invocation mechanism changes.

## Impact

- **Code**: `src/changes/execution.ts` — `runClaude()` rewritten; `runClaudeInWorktree()` unchanged (thin wrapper)
- **Dependencies**: `node:child_process` import removed from `execution.ts`; `@anthropic-ai/claude-agent-sdk` import added
- **Callers**: No changes — `runClaude()` / `runClaudeInWorktree()` signature and return type preserved
- **Test script**: `src/changes/askClaudeWorktree.ts` works unchanged (imports `runClaude`)
- **Platform**: Fixes Windows compatibility (`ENOENT` on `spawn("claude")`)
