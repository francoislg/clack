## 1. Rewrite `runClaude()` to use Agent SDK

- [x] 1.1 Replace `import { spawn } from "node:child_process"` with `import { query } from "@anthropic-ai/claude-agent-sdk"` in `src/changes/execution.ts`
- [x] 1.2 Rewrite `runClaude()` body: build SDK `query()` options from the existing parameters (`cwd`, `systemPrompt`, `allowedTools`, `disallowedTools`, `env` with git author overrides, `permissionMode: "bypassPermissions"`, `allowDangerouslySkipPermissions: true`, `persistSession: false`)
- [x] 1.3 Implement timeout via `AbortController` — create controller, wire `setTimeout` to call `abort()`, clear timeout on completion
- [x] 1.4 Implement the `for await (const message of query(...))` loop: extract text from assistant messages, fire `onProgress` on `tool_use` blocks, capture result/error from result events
- [x] 1.5 Preserve execution logging (`appendExecutionLog`) for branch-named runs: log tool use events, assistant text previews, result events, and errors
- [x] 1.6 Preserve heartbeat interval logging (every 30s) while the query is running
- [x] 1.7 Ensure the return type `{ success, text, error, lastMessage }` matches the existing contract exactly

## 2. Remove `shell: true` workaround

- [x] 2.1 Remove the `shell: true` option that was added as a Windows workaround (no longer needed since `spawn` is gone)

## 3. Verify callers are unaffected

- [x] 3.1 Confirm `executeChange()` in `execution.ts` works — calls `runClaudeInWorktree()` which calls `runClaude()`
- [x] 3.2 Confirm `generateChangePlan()` in `execution.ts` works — calls `runClaude()` directly with no tools
- [x] 3.3 Confirm `runWorktreeSetup()` in `execution.ts` works — calls `runClaudeInWorktree()`
- [x] 3.4 Confirm `createPR()` in `pr.ts` works — calls `runClaudeInWorktree()` with read-only tools
- [x] 3.5 Confirm `reviewPR()` in `pr.ts` works — calls `runClaudeInWorktree()` with write tools
- [x] 3.6 Confirm `detectFollowUpCommand()` in `detection.ts` works — calls `runClaudeInWorktree()` with no tools
- [x] 3.7 Confirm `handleFollowUp()` in `workflow.ts` works — calls `runClaudeInWorktree()` for git push

## 4. Build and verify

- [x] 4.1 Run TypeScript compilation (`npm run build`) and fix any type errors
- [x] 4.2 Run tests if available (`npm test`) and verify no regressions
