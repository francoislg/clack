## Context

Clack already has (a) a per-session `ToolCallRecorder` that captures every core tool call with args and result, and (b) a plugin SDK (`src/plugins/sdk.ts`) that lets plugins register tools, which are then appended to a single `clack` MCP server by `buildQueryTools()` in `src/tools/server.ts`. `submit_response` is the final tool Claude must call to deliver its answer; it already validates staged intents, `post_to` dedup for scheduled runs, and skip-path constraints.

Scheduled runs (and potentially other triggers) need a guarantee that specific tools are called before `submit_response` is accepted. Concretely: a daily trivia cron job configured with `requiredTools: ["mcp__trivia__submit_answers"]` must not deliver a response unless `submit_answers` has been called.

Achieving that in a clean, unambiguous way requires plugin tools to live in their own MCP namespace rather than sharing `clack`. Otherwise `requiredTools` string matching is fragile and plugin-vs-plugin collisions (today silently unhandled) remain possible.

## Goals / Non-Goals

**Goals:**
- Enforce per-session required tool calls before `submit_response` delivers.
- Give each Clack plugin its own MCP server namespace so tool identities are stable, self-documenting, and collision-free.
- Keep plugin authors' experience unchanged — they still call `sdk.registerTool(...)`; scoping and recording happen transparently.
- Thread the `requiredTools` list through the existing `ProcessMessageParams` → `QueryToolContext` pipeline so every trigger type can supply it if desired.
- Populate `requiredTools` from cron job config as the motivating concrete use case.

**Non-Goals:**
- Adding `requiredTools` configuration surfaces for non-cron triggers (DMs, mentions, reactions, auto-respond). The plumbing accepts the field; only the cron path populates it in this change.
- Complex semantics: no AND/OR groups, no "at least N calls", no argument-matching. Just: "tool was called at least once" per tool name.
- External MCP servers (e.g., `github-mcp-server`). Required-tools matching targets only tools tracked by Clack's `ToolCallRecorder`.

## Decisions

### Decision: Each plugin gets its own `createSdkMcpServer` instance

**Alternatives considered:**
- _Name-prefix in single `clack` server_ (`trivia__submit_answers`): minimal change, but tool names become long, and the `mcp__clack__trivia__submit_answers` triple-prefix reads poorly. Also doesn't reflect the actual ownership model.
- _Dot-notation in single server_ (`trivia.submit_answers`): similar issues and depends on whether the Agent SDK permits `.` in tool names.
- _Structured config for requiredTools_ (`{ plugin, tool }` objects): solves nothing for Claude's view of tools and leaves plugin-vs-plugin collisions open.

**Chosen**: per-plugin MCP server. The Agent SDK already accepts `mcpServers: Record<string, McpServerConfig>` (see `src/claude/index.ts:156` and `src/changes/execution.ts:387`), so this is a supported pattern, not an invention. It also makes tool provenance visible in every place that sees a tool name: streaming labels, task cards, recorder history, required-tools config.

### Decision: `buildQueryTools` returns a map of servers, not a single instance

The return type of `buildQueryTools` changes from `{ mcpServer, ... }` to `{ mcpServers: Record<string, McpServerConfig>, ... }`. Call sites in `src/claude/index.ts` and `src/changes/execution.ts` that currently wrap the single server in `{ clack: ... }` will instead spread the returned record.

`buildWorkerTools` remains single-server — worker mode has no plugin tools and should stay simple.

### Decision: Recording plugin tool calls is done by wrapping at registration harvest time

Plugin tool handlers don't call `recorder.record()` today and we don't want to require every plugin author to do so. When `buildQueryTools` consumes plugin registrations, it wraps each tool's handler to:

1. Call the original handler
2. Record the call (tool name = `mcp__<plugin>__<tool>`, args, result) on the per-session recorder
3. Return the original result

The wrapping is a pure transform inside `buildQueryTools`. The plugin SDK's public surface (`sdk.registerTool`) does not change.

The recorded name is the full MCP-visible name (`mcp__<plugin>__<tool>`) so it matches exactly what Claude sees, what appears in streaming, and what `requiredTools` config declares — one identity everywhere.

### Decision: Plugin-declared defaults scoped by cron job's `plugin` link

**Problem:** Users should not have to memorize tool names like `mcp__trivia__submit_answers` to configure a useful cron job. The plugin knows its own tool names — the plugin should declare them.

**Alternatives considered:**
- _Plugin declares unconditional required tools for scheduled runs_: breaks when multiple plugins are loaded — every scheduled run would require every plugin's tools.
- _Cron `plugins: string[]` (multiple)_: more flexible, but every real use case is a single-plugin cron. Keep it simple: one plugin per cron.
- _Tag-based filtering_: `cron.tags: string[]` + `plugin.requireForTags(...)`. Too abstract for the current scale.
- _User-managed only (no plugin declaration)_: what we ended up shipping initially. Bad UX — tool names are opaque.

**Chosen**: plugin-declared defaults, activated by an explicit `cron.plugin` link.

- `sdk.requireToolsForScheduled(["submit_answers"])` — bare tool names stored on the plugin load result. At cron trigger time, bare names are prefixed to their full MCP form by the system (`mcp__<plugin>__<tool>`).
- `CronJob.plugin?: string` — points to a loaded plugin name. Only jobs with this field pick up the named plugin's defaults.
- `CronJob.requiredTools?: string[]` — still works; unioned with plugin defaults. Use to add, not to override.

Cross-plugin collision is impossible because plugin defaults are scoped to the job's `plugin` field. Trivia defaults do not leak into a weather cron.

### Decision: `requiredTools` are matched by exact name equality

A required tool is satisfied if the recorder contains at least one entry whose `tool` field equals the required name. No argument inspection, no success/failure distinction. This is deliberately minimal and matches the user's stated semantics ("must call this once is good for now").

If a required tool was called but errored, it still counts as called. The rationale: the user asked for this to be a simple gate; richer semantics (e.g., "must succeed") can be added later if needed without breaking the config shape.

### Decision: Error response from `submit_response` explains what to do

When the gate blocks delivery, `submit_response` returns (via `recordError`) a message like:

> `"Cannot submit response yet. The following required tool(s) have not been called during this run: mcp__trivia__submit_answers. Call them before submitting."`

Claude receives this as a tool error and (per existing behavior) will typically comply and call the missing tool, then retry `submit_response`. The message uses the exact tool name so Claude can route to it without ambiguity.

### Decision: `requiredTools` is session-scoped state, not a global config

Required tools are supplied per message via `ProcessMessageParams`. They flow to `SubmitResponseDeps` via the context pipeline. This keeps the feature composable across triggers and avoids entangling plugin definitions with what callers want to require in any given run.

### Decision: `tool-label-config` delta is scoped to the plugin-merge removal

The tool-mapping loader's existing file-based discovery (filename = server name) already supports per-plugin mapping files. The only required change is deleting the "force-merge plugin mappings into clack" loop at `src/streaming/toolMappingLoader.ts:370-378` and instead creating one `ResolvedToolMapping` entry per plugin keyed by the plugin's server name. No new mapping file format or loader logic.

## Risks / Trade-offs

- **Risk:** Breaking change to tool identities — `mcp__clack__submit_answers` becomes `mcp__trivia__submit_answers`. → **Mitigation:** Trivia is the only current plugin and is already in flux (the `trivia-plugin-redesign` change is active). Search-and-replace scope is contained. Any user-authored instruction text referencing the old identity will break until updated — documented in tasks as a verification step.

- **Risk:** `mcpServers` record has reserved key collision if a plugin names itself `clack`. → **Mitigation:** Validate plugin name against a reserved-word list at load time; log and skip on conflict, consistent with how unknown plugins are already handled in `getLoadedPlugins`.

- **Risk:** Wrapping plugin handlers with the recorder could mask exceptions if done poorly. → **Mitigation:** The wrapper invokes the original handler in a `try`/`catch`, records the error outcome on failure, and rethrows. Never swallow exceptions.

- **Risk:** A `requiredTools` name typo (e.g., user writes `submit_answers` instead of `mcp__trivia__submit_answers`) would permanently block delivery. → **Mitigation:** At `buildQueryTools` time, we know the full set of tool names available in the session. Log a warning if any `requiredTools` entry doesn't match a known tool name, so misconfigurations are diagnosable from logs. Do not fail the run on mismatch — the gate will still block, and Claude's error feedback will surface the mismatch operationally.

- **Trade-off:** "Called at least once" is blunt. A tool that is called but returns an error still satisfies the gate. This is deliberate (see Decisions). Richer semantics can be added later without changing the config shape.

## Migration Plan

No data migration needed. Changes:

1. **Config (additive)**: `CronJob` gains optional `requiredTools?: string[]`. Existing cron jobs continue to work with no change.
2. **Plugin tool names change**: existing references to `mcp__clack__<plugin-tool>` in instruction files, tests, and fixtures need updating. Search across `data/default_configuration/`, `src/plugins/trivia/`, and test fixtures.
3. **Rollout**: single-deploy. No staged rollout needed because the plugin system is new and has one user (trivia).
4. **Rollback**: revert the PR. Cron jobs written with `requiredTools` will lose their guarantee but continue running. Plugin tool names revert to the `clack` namespace.

## Open Questions

- **Do we want a verification step for `requiredTools` entries at cron-job-save time?** (e.g., reject a cron job whose `requiredTools` references tools not available to the role / not currently loaded). Leaning no for now — plugins can be hot-enabled/disabled and we don't want save-time coupling to runtime state. Warning-at-runtime is sufficient.
