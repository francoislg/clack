## 1. Type surface

- [x] 1.1 Add `McpServerStatusFn` type to `src/tools/types.ts` (alias for `() => Promise<McpServerStatus[]>`, importing `McpServerStatus` from `@anthropic-ai/claude-agent-sdk`).

## 2. McpServerManager

- [x] 2.1 Add `mcpServerStatusFn?: McpServerStatusFn` private field.
- [x] 2.2 Extend `bind(setMcpServers, mcpServerStatus?)` to accept and store the optional status fn.
- [x] 2.3 Add `isInSessionStart(name): boolean` returning `name in this.sessionStart`.
- [x] 2.4 Add async `isLiveInBaseline(name): Promise<boolean>` that queries the bound status fn and returns `true` only when the entry's `status === "connected"`. Return `false` when the fn isn't bound, the name is missing from the result, the status is anything else, or the call throws (log a warn on throw).

## 3. attach_integration

- [x] 3.1 After the existing `isAttached` duplicate-attach branch in `src/tools/query/attachIntegration.ts`, add a new branch: when `manager.isInSessionStart(name)` AND `await manager.isLiveInBaseline(name)`, return a success result with text `"Integration <name> is always-loaded as part of the session baseline — its tools are already available. No attach needed; proceed using the integration's tools directly."`, append `mcpAttachHistory: [{ outcome: "duplicate" }]` via `appendAttachHistory`, and log `mcp.attach … outcome=baseline_live`.
- [x] 3.2 When `isInSessionStart(name)` is true but `isLiveInBaseline(name)` is false, log `mcp.attach … outcome=baseline_not_live — attempting recovery attach` and fall through to the existing `loadMcpServer` + `manager.attach` path unchanged.

## 4. Wiring

- [x] 4.1 In `src/claude/index.ts`'s `onQuery` callback, pass `query.mcpServerStatus.bind(query)` as the second argument to `mcpManager.bind(...)`.

## 5. Tests

- [x] 5.1 In `src/claude/mcpServerManager.test.ts`, add a `describe("isInSessionStart", ...)` covering names in/out of the baseline and names added via `hydrateSessionStart`.
- [x] 5.2 In the same file, add a `describe("isLiveInBaseline", ...)` covering: connected → true, failed → false, missing-from-status → false, status-fn-not-bound → false, status-fn-throws → false.
- [x] 5.3 In `src/tools/query/attachIntegration.test.ts`, add a test for the baseline short-circuit: registry has `mongodb-prod` with `alwaysLoad: true`, baseline contains it, status fn returns `[{ name: "mongodb-prod", status: "connected" }]`. Assert: text contains `"always-loaded"`, `setMcpServers` not called, `loadMcpServer` not called, `mcpAttachHistory` recorded with `outcome: "duplicate"`.
- [x] 5.4 In the same file, add a test for the recovery fallthrough: same setup but status fn returns `[{ status: "failed" }]`. Assert: text contains `"Attached integration: mongodb-prod"`, `setMcpServers` called once, `loadMcpServer` called once.

## 6. Verification

- [x] 6.1 Run `npx tsc --noEmit` and confirm no new type errors in the touched files.
- [x] 6.2 Run `node --test --import tsx src/claude/mcpServerManager.test.ts src/tools/query/attachIntegration.test.ts` — all tests pass (32/32 expected).
