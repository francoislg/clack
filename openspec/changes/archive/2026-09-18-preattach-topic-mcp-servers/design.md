## Context

Session-start MCP servers are assembled in two steps because of a construction-order cycle: `prepareMcpSession` (registry, always-on externals, resumed attachments, manager) runs first; `buildClackTools` then builds the clack + plugin servers from a tool context that holds the manager; `completeSessionStart` merges everything into `options.mcpServers` and hydrates the manager's baseline.

Two mechanisms already put a non-always-on server into that session-start map:

- **External servers** — `prepareMcpSession` loads every name in `session.attachedIntegrations` via `loadMcpServer` into `resumedAttached`.
- **Plugin on-demand servers** — `buildClackTools` includes a `sdk.registerMcpServer(..., { autoload: false })` server when `session.attachedIntegrations` contains its `fullName` (`src/tools/server.ts`, the `spec.autoload || attachedSnapshot.includes(...)` gate).

`preAttachedTopics` reaches both places already (`AskClaudeOptions.preAttachedTopics` in `buildQuerySetup`; `ctx.preAttachedTopics` in the tool context) but is only read for instructions and for the `attach_integration` short-circuit.

Constraint that motivates the change: the tool list is the first segment of the cached prompt. Any `setMcpServers` call after turn 1 rewrites the entire prefix at the cache-write rate ($3.75/MTok vs $0.30 read).

## Goals / Non-Goals

**Goals:**

- A pre-attached topic that names an MCP server (external or plugin on-demand) has its tools in the turn-1 tool list.
- A job firing repeatedly with the same `attachedTopics` presents a byte-identical tool list on every fire, so its prefix stays cache-warm between fires.
- `attach_integration` never leaves a pre-attached integration without its server.

**Non-Goals:**

- Changing which topics any trigger pre-attaches (interactive triggers, plugin specs, the `response-rendering` default).
- A new `CronJob` field or tool argument.
- Persisting pre-attached servers to `session.attachedIntegrations`.
- Role/access gating of integrations (`mcp-server-access-control` owns that).
- Rewriting the auth monitor's prompt or skill content (`auth-monitor-skill-slimdown`). The rollout only removes the prompt's attach step, which pre-attaching makes redundant.

## Decisions

### 1. Extend `attachedTopics` semantics instead of adding `attachedIntegrations` to `CronJob`

Topics and integrations are one namespace: `attach_integration("<name>")` activates the topic AND its server, and schedule-tool validation already accepts registry names as topic names. Making pre-attach mean the same thing as a mid-session attach removes the current half-state (instructions without tools, and a short-circuit that blocks getting them).

*Alternative — a separate `attachedIntegrations` field:* needs a zod field on a graceful state reader, two tool arguments, plugin `CronJobSpec` plumbing, redaction/projection updates, and leaves the trap in place for anyone who puts an integration name in `attachedTopics`. Rejected.

### 2. Load external servers in `prepareMcpSession`, in a separate `preAttached` map

`prepareMcpSession(session, config, preAttachedTopics, deps)` loads each pre-attached name that is in the effective registry and not already in `alwaysOnExternals` or `resumedAttached`, via `deps.loadMcpServer`. An `undefined` config (instructions-only entry, or a plugin on-demand server — those are not in `mcp.json`) is skipped silently; a thrown load error is logged with `logger.warn` and skipped. The result is returned as `McpSessionSetup.preAttached` and merged by `completeSessionStart` into the **baseline** (the map handed to `hydrateSessionStart`), not into `attached`.

Why baseline rather than `seedAttached`: the manager's `attached` set mirrors what the CLI's session state restores on resume and is what `attach_integration` persists. Pre-attached servers are passed fresh through `options.mcpServers` on every session build, exactly like always-on externals, so they belong with them. It also gives `isInSessionStart(name)` the right answer for the recovery path (Decision 4).

*Alternative — reuse `resumedAttached`:* conflates two lifecycles and would make the stale-cleanup branch consider pre-attached names. Rejected.

### 3. Plugin on-demand servers: widen the existing gate

`spec.autoload || attachedSnapshot.includes(spec.fullName) || ctx.preAttachedTopics?.includes(spec.fullName)`. One condition, same code path as resume, no manager involvement. This lets a plugin cron spec pre-load its own on-demand server (e.g. `trivia:management`) by naming it in `attachedTopics`.

### 4. `attach_integration` short-circuit: verify, then recover

The pre-attached check stays first (names need not be in the registry). Its text states that the instructions are in the system prompt and any tools the integration provides are already loaded. A pre-attached name falls through to the normal attach path only when it is an external server the session lacks: absent from the session-start baseline (its pre-load failed), or present but not reported `connected` by the SDK — the same `isLiveInBaseline` probe the always-on branch uses. The check loads that server's config once and hands it to the attach, so a side-effecting load (the GitHub entry mints an installation token) runs once. Instructions are not re-injected on that path for a pre-attached name (they are in the system prompt); the result carries only the "tools are now registered" note. A throwing config load is reported like any failed attach (warning, `failed` history entry, error result).

### 5. Deterministic ordering

`options.mcpServers` key order decides tool order in the prompt. External pre-attached servers are merged in `preAttachedTopics` order after always-on externals and before clack/plugin servers; plugin on-demand servers keep their place among the plugin servers (plugin load order, then registration order). The same job therefore produces the same tool list on every fire. `mergeBuiltinTopics` already yields a stable order.

### 6. No persistence of pre-attached servers on the session

A thread reply under a cron post is a new trigger whose `preAttachedTopics` are the built-ins only; the server is simply absent and a normal `attach_integration` brings it back and persists it. Persisting at session start would need a write on every cron fire and interacts badly with the `ctx.session` snapshot that `attach_integration` uses for its own persistence.

## Risks / Trade-offs

- [Pre-attached server is slow or down → every fire of the job pays the connect timeout] → the SDK connects `options.mcpServers` asynchronously, as it does for always-on externals; a failed load is skipped with a warning, and the run continues without the tools.
- [Turn-1 context grows by the server's tool schemas on runs that would not have needed it] → those tokens are cache reads on a warm prefix ($0.30/MTok); for a job that attaches on most runs, the break-even is far on the saving side. Operators opt in per job.
- [`ENABLE_TOOL_SEARCH=auto` flips to deferred loading when tool definitions cross the threshold] → the tool list is still identical fire to fire, so the cache behavior holds; only the mode of access (ToolSearch) changes. Measure on the monitor after rollout.
- [Cache-warm assumption (prefix survives 15 min) is observed on casual-talk, not guaranteed] → the change is still correct without it (removes the trap and the mid-run rewrite); the measurement task records the actual warm-run write size.
- [An existing job already lists a server name in `attachedTopics` and starts loading it] → that is the declared intent of the field; task 5.1 lists such jobs on the VM before deploy so there are no surprises.

## Migration Plan

1. Ship the code (no data migration; `attachedTopics` shape is unchanged).
2. Deploy; on the VM, ask Clack to set the auth monitor's `attached_topics` to `["response-rendering", "metabase"]`, remove the `attach_integration("metabase")` step from its prompt, and re-enable the job.
3. Measure 1 hour of fires with `scratchpad/compare.cjs`: turn-1 context, per-turn cache writes, cost per no-skill run vs the pre-change baseline.
4. Rollback = `update_scheduled_message` with the previous `attached_topics`; the code path is inert for jobs that name no server.

## Open Questions

- Should the AVAILABLE INTEGRATIONS catalog mark or omit pre-attached servers? Default: leave the catalog unchanged (stable prefix, and the short-circuit answers a redundant attach cheaply).
