## Why

Scheduled posts that explicitly call `attach_integration("mongodb-prod")` are repeatedly degrading to "MongoDB Unavailable" because the underlying `setMcpServers` re-registration trips the SDK's 30s connection timeout. The integration is `alwaysLoad: true` — it is already live in the session-start baseline — so the re-attach is purely redundant, but `attach_integration` currently has no way to detect "already loaded at session start" and falls through to a real `setMcpServers` call. A worse second failure mode follows: when the SDK accepts the re-registration without a per-server error but the tools never actually relist, the manager records `outcome: "ok"` and the tool reports success, after which Claude searches for `mcp__mongodb-prod__*`, finds nothing, and gives up.

## What Changes

- `attach_integration` gains a "verify-then-skip" short-circuit: when the requested name is in the session-start baseline AND the SDK reports it as `connected`, the tool returns an "already loaded" success without calling `setMcpServers` and without re-injecting topic instructions.
- When the baseline server is in the baseline but **not** `connected` (failed/pending/missing), the tool falls through to a real attach as graceful recovery — boot-time failures remain recoverable.
- `McpServerManager.bind(...)` accepts an optional `mcpServerStatus` function (the SDK's `Query.mcpServerStatus`) alongside `setMcpServers`, and exposes `isInSessionStart(name)` and `isLiveInBaseline(name)`.
- Wired in `src/claude/index.ts` so production sessions pass `query.mcpServerStatus.bind(query)` at the same call site as `query.setMcpServers.bind(query)`.

No breaking changes; no public API changes; no migration needed.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `lazy-mcp-loading`: extends the `attach_integration` requirement with two new scenarios — short-circuit when the integration is in the session-start baseline and the SDK reports it connected; recovery attach when in the baseline but not connected.

## Impact

- Code: `src/tools/types.ts` (new `McpServerStatusFn` type), `src/claude/mcpServerManager.ts` (new `isInSessionStart` / `isLiveInBaseline`, extended `bind`), `src/tools/query/attachIntegration.ts` (new short-circuit branch), `src/claude/index.ts` (wiring).
- Tests: extended `mcpServerManager.test.ts` and `attachIntegration.test.ts`.
- SDK surface: depends on `Query.mcpServerStatus()` from `@anthropic-ai/claude-agent-sdk` (already available).
- Operational: eliminates the recurring "MongoDB Unavailable" cron failures in `#visitors` and removes redundant 30s reconnect storms for any always-on MCP server an operator's prompt happens to re-attach.
