## Context

The Q&A path (`src/claude.ts`) already uses the Claude Agent SDK's `query()` function for all question-answering. The changes workflow (`src/changes/execution.ts`) uses `node:child_process.spawn("claude", ...)` to invoke the CLI, then manually parses `stream-json` output. This creates two divergent integration patterns and causes `ENOENT` failures on Windows where the CLI installs as a `.cmd` wrapper.

The `runClaude()` function is called by 7 sites across 4 files. All callers consume the same return type: `{ success, text, error, lastMessage }`.

## Goals / Non-Goals

**Goals:**
- Replace `spawn` with Agent SDK `query()` in `runClaude()`
- Maintain identical function signature and return type for all callers
- Preserve all existing behavior: progress callbacks, timeout, execution logging, env vars
- Fix Windows compatibility

**Non-Goals:**
- Changing the `runClaudeInWorktree()` wrapper (stays as-is, calls new `runClaude()`)
- Changing any callers of `runClaude()` or `runClaudeInWorktree()`
- Changing the Q&A path in `src/claude.ts` (already uses SDK)
- Adding new features or capabilities beyond the SDK migration

## Decisions

### Use `abortController` for timeout instead of `setTimeout` + `proc.kill`

The SDK accepts an `abortController` option. We create one, wire a `setTimeout` to call `abort()`, and clean up on completion. This replaces the current pattern of storing the spawned process and calling `proc.kill("SIGTERM")`.

**Alternative**: Use `maxBudgetUsd` — rejected because it doesn't map to wall-clock time, and the existing behavior is time-based.

### Set `persistSession: false`

These are ephemeral automated runs (change execution, plan generation, PR body generation). They should not persist session files to `~/.claude/projects/`. The Q&A path doesn't set this because it uses different options, but for automated headless runs it avoids disk clutter.

### Set `permissionMode: 'bypassPermissions'` + `allowDangerouslySkipPermissions: true`

This replaces the CLI flag `--dangerously-skip-permissions`. The SDK requires both the permission mode and the explicit opt-in flag.

### Pass `env` with git author overrides

The current code sets `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, `GIT_COMMITTER_EMAIL` on the spawned process. The SDK's `env` option accepts the same shape (`Record<string, string | undefined>`) and defaults to `process.env`, so we spread `process.env` with the git overrides — same pattern, different delivery mechanism.

### Keep heartbeat logging via the async iteration loop

The current implementation has a `setInterval` heartbeat that logs "still running" every 30 seconds. With the SDK, we track `lastOutputTime` and log heartbeats from within the `for await` loop or from a parallel interval. The interval approach is simpler and preserved.

### Map `onProgress` from `tool_use` blocks in assistant messages

The SDK yields typed `SDKAssistantMessage` objects with `message.content` blocks. We check for `tool_use` type blocks and call `onProgress(`Using ${block.name}`)` — same as the current JSON parsing logic, but without manual JSON parsing.

## Risks / Trade-offs

**[SDK spawns its own subprocess internally]** The Agent SDK's `query()` function internally spawns a Claude Code process. This means we're still spawning a subprocess, just through the SDK's abstraction. → The SDK handles PATH resolution, `.cmd` wrappers, and process lifecycle correctly across platforms, so this is a net improvement.

**[Behavior differences in edge cases]** The SDK may handle certain edge cases (partial output on crash, signal handling) differently than raw `spawn`. → The Q&A path already uses the SDK in production with no issues. The SDK is the supported integration path.

**[`env` replaces entire environment]** The SDK docs say `env` "defaults to `process.env`". We must spread `process.env` into our override to avoid losing the existing environment. → Simple to get right, same pattern as the current `spawn` call.
