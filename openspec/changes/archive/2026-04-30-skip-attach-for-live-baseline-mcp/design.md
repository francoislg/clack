## Context

`attach_integration` is the only entry point Claude has to make a non-baseline MCP server's tools appear mid-session. Today its idempotency check (`McpServerManager.isAttached`) only inspects servers it dynamically attached during the current session — it has no awareness of the session-start baseline (the always-on subset passed to `options.mcpServers`). When a prompt explicitly tells Claude to *"Attach the mongodb-prod integration"* — common in scheduled cron prompts whose authors don't necessarily know mongodb-prod is `alwaysLoad: true` — the tool falls through to a real `setMcpServers` round-trip.

That round-trip re-registers every dynamic server, which forces the SDK to re-establish each connection. In practice the production mongodb-prod MCP (a stdio-spawned process) routinely takes long enough on cold reconnect to trip the SDK's 30s `MCP server "<name>" connection timed out` ceiling. Worse, the second attempt typically returns *without* a per-server error in `McpSetServersResult.errors` — manager code records `outcome: "ok"`, the tool happily reports "Attached integration: mongodb-prod", and Claude then ToolSearches for `mcp__mongodb-prod__*` and finds nothing because the tool list never propagated. The user-visible artifact is a "⚠️ New Signups — MongoDB Unavailable" panel posted to `#visitors` on the 6-hour cron, observed in 87+ recent sessions.

The SDK does expose `Query.mcpServerStatus(): Promise<McpServerStatus[]>` with a per-server `status: 'connected' | 'failed' | 'pending' | 'needs-auth' | 'disabled'`. Clack does not currently wire it.

## Goals / Non-Goals

**Goals:**
- Make `attach_integration` idempotent against the session-start baseline, not just the dynamic attached set.
- Avoid the redundant `setMcpServers` re-registration that triggers the 30s reconnect timeout.
- Preserve a recovery path: if the always-on server failed to register at boot, `attach_integration` must still attempt a real attach.
- Stop returning "ok" when an attach silently failed to relist tools (covered as a side effect of the new short-circuit, since the most common false-success path was the redundant case).

**Non-Goals:**
- Improving the underlying mongodb-prod MCP cold-start latency. That is out of scope; we work around it.
- Changing the SDK's 30s connect timeout or the `setMcpServers` semantics.
- Tightening `manager.attach`'s success criterion for *non*-baseline servers (a separate, lower-frequency failure mode).
- Auto-rewriting user-supplied scheduled prompts that mention "attach mongodb-prod".

## Decisions

### Decision 1: Verify-then-skip (option 2), not blind-skip (option 1)

Two alternatives were considered:

- **(A) Blind skip:** if `name` is in `sessionStart`, return idempotent success. Simplest possible change.
- **(B) Verify-then-skip:** if in `sessionStart` AND SDK reports `connected`, return idempotent success. Otherwise fall through.

(B) chosen. (A) lies to Claude when an always-on server failed to register at boot — Claude would believe it has the tools and produce a "MongoDB Unavailable"-shaped report via a different path. (B) preserves graceful degradation: the boot-time failure becomes recoverable through `attach_integration`. Cost is one extra round-trip to `Query.mcpServerStatus()` per attach call, which is small (the SDK reports cached status, no MCP traffic).

### Decision 2: `mcpServerStatusFn` is optional on `bind(...)`

The manager's `bind(setMcpServers, mcpServerStatus?)` accepts the status fn as a second optional parameter. Tests and any non-production caller can omit it. When omitted, `isLiveInBaseline(...)` returns `false` for any name — the conservative default forces a real attach rather than relying on an unverifiable assumption that the baseline is healthy. This keeps the test surface unchanged and avoids regressing the existing behavior for callers that haven't been updated.

### Decision 3: Conservative status mapping (`connected` only)

`isLiveInBaseline` returns `true` only when `status === 'connected'`. `pending` is treated as not-live: a server still negotiating its tool list cannot be relied on to satisfy Claude's next ToolSearch. `failed`, `needs-auth`, `disabled`, and "name absent from the status array" all map to `false`. Probe errors are swallowed and mapped to `false` (logged at `warn`). This prefers a slightly slower path (an unnecessary real attach) over a false success.

### Decision 4: Short-circuit response format

The short-circuit returns plain success (not `isError`) with text:

> `Integration <name> is always-loaded as part of the session baseline — its tools are already available. No attach needed; proceed using the integration's tools directly.`

Different wording than the existing duplicate-attach path (`"Integration already attached: <name>. No additional action taken."`) so the SDK transcript distinguishes the two cases. Persistence still records `mcpAttachHistory: [{ outcome: "duplicate" }]` — the *effect* (no SDK call, no tool list change) is identical to the duplicate-attach branch, so the audit log uses the same outcome label.

### Decision 5: Wiring location

`mcpManager.bind(...)` is called once per turn from `clackSession`'s `onQuery` callback at `src/claude/index.ts:390`. The change passes `query.mcpServerStatus.bind(query)` alongside the existing `query.setMcpServers.bind(query)`. No new wiring sites.

## Risks / Trade-offs

- **Risk:** `Query.mcpServerStatus()` adds a round-trip on every `attach_integration` call. → **Mitigation:** The SDK call returns cached status synchronously inside the SDK process; latency is sub-millisecond in practice. We only call it when the name is in `sessionStart`, which is the minority of attach calls (most lazy integrations aren't in baseline).
- **Risk:** SDK changes the semantics of `status: 'pending'` in the future (e.g., to mean "tools listed but server still initializing"). → **Mitigation:** The conservative mapping (`connected` only) means a future change that relaxes "pending" would only cost us one redundant attach, not a wrong answer.
- **Risk:** A baseline server with `status: 'connected'` but a tool list that's silently empty would still be reported as "tools available". → **Mitigation:** Out of scope — that's a different failure mode (Decision in Non-Goals). The current behavior pre-change is no better; the SDK is the source of truth for "connected".
- **Trade-off:** The existing `duplicate-attach` path returns text mentioning "already attached", while the new path says "always-loaded". Two slightly different success messages to maintain. Acceptable: the distinction is informative for transcript readers and Claude can act on either correctly (both say "no attach needed").
