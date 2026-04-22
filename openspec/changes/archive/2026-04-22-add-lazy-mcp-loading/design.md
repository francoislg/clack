# Design: Lazy MCP Loading

## Context

Today `src/claude/index.ts:369` passes every configured MCP server (`mcpServers` from `loadMcpServers()`) to the Claude Agent SDK on every query. With 9 MCP servers registered, the cache-creation baseline of a single turn is ~131K tokens — most of it MCP tool schemas. A 15-tool investigation therefore crosses the SDK's auto-compaction threshold at ~157K tokens, and the ensuing summary drops context that the rest of the session depends on.

The Claude Agent SDK (v0.2.7) exposes `query.setMcpServers(servers)` which can attach/detach MCP servers mid-session. `query.mcpServerStatus()` reports connection state. These are the primitives that make lazy loading feasible without a custom proxy.

## Goals

- Cut baseline token cost per turn by >50% in the common case.
- Keep full integration access available to Claude when it needs it, without operator intervention.
- Preserve the existing `data/mcp.json` shape (Claude SDK-compatible — keep it portable).
- Preserve the existing cascade resolver contract for baseline files.
- Observable: attach progress and failures are visible in-thread.

## Non-goals

- Changing how pre-analysis works. Pre-analysis remains scoped to the respond/skip/stop decision.
- Caching or bundling MCP tool schemas. Upstream problem.
- Multiplexed sub-MCP proxies. Too much complexity for marginal benefit.

## Design Decisions

### Registry location: `data/config.json`, not `data/mcp.json`

`data/mcp.json` is consumed by the Claude SDK directly — it has to stay in the SDK's shape. Adding Clack-specific fields (`alwaysLoad`, `description`) there would either fail the SDK's schema validation or force parallel schemas. The registry lives in `data/config.json` alongside other Clack-owned policy instead.

Every server name in `data/mcp.json` should have a matching entry in `config.mcpServers`. If an entry is missing (typical flow: operator edits `mcp.json` and forgets to update `config.json`), Clack logs a warning and synthesizes an in-memory registry entry with `alwaysLoad: true` and a placeholder description, so the server is still attached at session start and functionality is preserved. This graceful-degradation path was chosen over fail-fast because `mcp.json` edits are routine and a hard stop would be disruptive — the warning in the log plus the startup baseline smoke test (see below) together give operators clear feedback without blocking the bot.

The auto-injected `github` MCP is special-cased: if it's absent from `config.mcpServers` at load time, the system synthesizes a default entry (`alwaysLoad: true`, description `"GitHub MCP — PRs, issues, code search"`) so operators don't have to hand-register it. Operators can override by providing an explicit entry in `config.json`, which wins like any other.

### Topic name = registry entry name

Each registry entry (in `config.mcpServers`) has at most one matching topic folder (`{role}/topics/<name>/`). The registry entry may or may not correspond to an MCP server in `data/mcp.json` — both cases use the same `attach_integration(name)` flow:

- **MCP-backed topic** (e.g. `metabase`): the registry entry matches a `data/mcp.json` server. `attach_integration("metabase")` calls `setMcpServers` to attach the server AND loads `{role}/topics/metabase/*.md` instructions.
- **Instructions-only topic** (e.g. `scheduling` for Clack's internal scheduled-messages feature): the registry entry has no matching `data/mcp.json` server. `attach_integration("scheduling")` skips the `setMcpServers` call entirely and just loads the instructions. Useful for bundling topical instructions that belong with a Clack-internal feature rather than an external MCP.

### Topic instructions ride the tool result, not the system prompt

When Claude calls `attach_integration("metabase")`:
1. `query.setMcpServers(currentAttached ∪ { metabase: mcpConfigs.metabase })` — new tools arrive.
2. `resolveInstructions(roleChain, new Set(["metabase"]))` — concatenates `{role}/topics/metabase/*.md` across the cascade.
3. The concatenated instructions become the **tool's text result**.

This matters because the Claude Agent SDK has no API to mutate the system prompt mid-session — the prompt Claude received at session start is the prompt for the entire session, including resumed turns. The only remaining mechanism that's (a) visible to Claude, (b) persisted across resumes by the SDK, and (c) updatable mid-session is the conversation history itself. Putting topic instructions in a `tool_result` inserts them into that history, where they survive resume and don't require a prompt reload.

### Baseline configs exclude topic folders

`src/cascadingConfigResolver.ts`'s `scanMdFiles()` already uses `entry.isFile()`, so subdirectories are naturally skipped. The topic walk is an additional, opt-in pass controlled by the `activeTopics: Set<string>` parameter. When absent/empty, behavior is identical to today.

### Session resume: always re-attach

`setMcpServers` docs ("only affects servers added dynamically via this method or the SDK") are ambiguous about resume persistence. Rather than experimenting to find out, Clack will always call `setMcpServers(alwaysOn ∪ session.attachedIntegrations)` before the first turn of a resumed session. Idempotent if the SDK persists across resume; correct if it doesn't.

### Startup baseline smoke test

Lazy loading's whole point is a smaller baseline. Without continuous measurement, that baseline silently re-inflates the next time someone adds an always-on server or moves a file back to the baseline cascade by accident. To keep the guardrail visible:

- At startup, after config is loaded but before Slack event handlers register, Clack fires off one minimal query per role tier (`user`, `dev`, `admin`) with the exact system prompt, MCP set, and cascade that role would normally receive.
- Queries use `maxTurns: 1` and a short wall-clock timeout so a slow MCP spawn can't stall boot.
- Each query's first-turn `cache_creation_input_tokens` is logged at `info` level in a single structured line (e.g. `baseline.tokens role=user tokens=18452`), making it easy to grep/chart.
- Fire-and-forget: smoke test failures log a warning but never block startup — the bot must always come up even if a credential is busted or an MCP is down.
- Bonus: unmapped-mcp.json warnings and smoke-test token numbers appear in the same boot log, so operators see the cost of any auto-loaded server alongside the drift warning.

### Attach failures

`setMcpServers` returns `{ added, removed, errors }` where `errors: Record<string, string>`. The tool:
- On success: returns a `tool_result` with `isError: false` containing `"Attached ${name}. New tools: ..."` followed by the topic instructions.
- On failure (name present in `errors`): returns a `tool_result` with `isError: true` and the connection error text, so Claude sees the failure in its conversation history and can fall back (try a different approach, respond without the integration, or ask the user to reconnect). The failed integration is NOT recorded in `session.attachedIntegrations`.
- Records a thinking-indicator update on each transition (`"Attaching metabase…"` → `"Attached metabase"` / `"Failed to attach metabase: <error>"`) so the user sees the attach progress and any failure in-thread.

## Open questions resolved

- **Resume behavior**: re-attach always (defensive).
- **Attach latency**: not actively mitigated; the thinking indicator makes it visible.
- **Failure surfacing**: thinking indicator + structured tool error.

## Risks and mitigations

- **Baseline too thin.** If Claude doesn't realize a topic is available, it may try to answer from code alone and miss obvious wins. Mitigation: the catalog block is in the system prompt on every turn, framed directively — each line reads like `- <name> — <description>. Call attach_integration("<name>") to load.` so it's obvious to Claude that this is a first-step action, not a passive reference.
- **Registry drift.** `data/mcp.json` and `config.mcpServers` can drift out of sync (operator adds to one, forgets the other). Mitigation: startup validation fails fast with a clear error if any server in `mcp.json` is missing from the registry.
- **Stale attached integrations on resume.** If an integration is removed from the registry between turns, resume will fail otherwise. Mitigation: re-attach logic ignores unknown entries, logs each at warn level so operators can notice and clean up, and strips them from `session.attachedIntegrations` on the next write.
- **Plugin-provided virtual defaults.** Clack plugins (see `src/plugins.ts`) can register in-memory "virtual default" instruction files keyed by role+filename without writing to disk. Topic subfolders should support the same mechanism — plugins register virtual defaults keyed as `topics/<name>/<file>.md`. The resolver walks virtual defaults through the same cascade (default → virtual → custom, per role) as it does for disk files.
