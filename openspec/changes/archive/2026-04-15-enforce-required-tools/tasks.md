## 1. Prerequisites

- [x] 1.1 Confirm the `plugin-architecture` change is archived (or sequence this change after it). This change builds on the plugin SDK and plugin loading behavior established there.

## 2. Plugin SDK: per-plugin MCP server

- [x] 2.1 Extend `PluginLoadResult` in `src/plugins/sdk.ts` with an `mcpServer: McpSdkServerConfigWithInstance` field.
- [x] 2.2 In `createClackSdk`'s `harvest()` (or equivalent finalization), build a `createSdkMcpServer({ name: pluginName, tools: [...] })` from the collected tools and return it as part of the load result.
- [x] 2.3 Add a reserved-name check: when a plugin attempts to load with name `clack`, log a warning and skip it (via the built-in registry / plugin loader path).
- [x] 2.4 Update plugin SDK tests in `src/plugins/sdk.test.ts` to assert that `harvest()` produces an `mcpServer` containing the registered tools under the plugin's name.

## 3. Tool call recording for plugin tools

- [x] 3.1 In `src/tools/server.ts` `buildQueryTools`, when consuming plugin tools, wrap each plugin tool's handler to record via the per-session `ToolCallRecorder` before returning (tool name = `mcp__<plugin>__<tool>`, args, result).
- [x] 3.2 Ensure the wrapper records an error outcome when the handler throws, then rethrows the exception.
- [x] 3.3 Add tests covering both paths: (a) successful handler invocation produces a recorder entry with the full `mcp__<plugin>__<tool>` name and forwards the original return value unchanged; (b) handler that throws produces a recorder entry with an error outcome and the exception is rethrown (not swallowed).

## 4. Tool server: return map of MCP servers

- [x] 4.1 Update `ClackToolsResult` in `src/tools/types.ts`: swap `mcpServer: McpSdkServerConfigWithInstance` for `mcpServers: Record<string, McpSdkServerConfigWithInstance>` in the query-mode branch (worker-mode branch keeps the single `mcpServer`). Update `buildQueryTools` to return the new shape, populating with `{ clack: coreServer, [pluginName]: pluginServer, ... }`.
- [x] 4.2 Keep `buildWorkerTools` unchanged (single `mcpServer`) — worker mode has no plugin tools.
- [x] 4.3 Remove the `coreToolNames.has(registered.name)` collision guard and its warning log — structurally unreachable now that plugins own their namespaces.
- [x] 4.4 Stop appending plugin tools onto the `clack` `tools[]` array. Instead, group per plugin and pass each group to its own `createSdkMcpServer`.

## 5. Agent SDK integration sites

- [x] 5.1 In `src/claude/index.ts` (around line 156), change `mcpServers: { clack: clackTools.mcpServer }` to `mcpServers: { ...clackTools.mcpServers }` (or equivalent spread over the returned record).
- [x] 5.2 Verify `src/changes/execution.ts` worker path still uses single `mcpServer` (no change expected) and that the query callers are all updated.
- [x] 5.3 Grep for `clackTools.mcpServer` and `.mcpServer` on query-tool results elsewhere in `src/` to catch any missed call-site.

## 6. Tool mapping loader: per-plugin key

- [x] 6.1 In `src/streaming/toolMappingLoader.ts`, remove the plugin-merge-into-`clack` loop (currently at lines 370-378).
- [x] 6.2 Replace it with a loop that creates one `ResolvedToolMapping` entry per plugin keyed by plugin name, populated from `plugin.toolMappings`.
- [x] 6.3 Ensure that if a file-based config at `data/configuration/tool_mapping/<plugin>.json` also exists, it takes precedence per the existing two-tier rules.
- [x] 6.4

## 7. Streaming labels and task cards

- [x] 7.1 Audit `src/streaming/` for hardcoded assumptions that plugin tools start with `mcp__clack__`. Update parsing/lookup paths to route by server prefix.
- [x] 7.2 Update `src/streaming/toolLabels.test.ts` fixtures that reference plugin tools to use `mcp__<plugin>__<tool>` form.
- [ ] 7.3 (manual — requires running bot) Smoke-test task-card rendering for a trivia plugin tool call in dev (via the trivia plugin's configured cron or manual invocation).

## 8. Required-tools threading

- [x] 8.1 Add optional `requiredTools?: string[]` to `ProcessMessageParams` in `src/slack/handlers/core.ts`.
- [x] 8.2 Thread it into `ProcessingContext` and `QueryToolContext` (same file / `src/tools/context.ts` / `src/tools/types.ts` as applicable).
- [x] 8.3 Extend `SubmitResponseDeps` in `src/tools/presentation/submitResponse.ts` with `requiredTools?: string[]`.
- [x] 8.4 In `buildQueryTools`, pass `ctx.requiredTools` into `createSubmitResponseTool({...})`.

## 9. submit_response gate

- [x] 9.1 At the top of the `submit_response` handler (before skip-path, before disengage validation) — the handler closes over `requiredTools` via `SubmitResponseDeps` from task 8.3 — compute `missing = (requiredTools ?? []).filter(name => !recorder.getHistory().some(e => e.tool === name))`.
- [x] 9.2 If `missing.length > 0`, return via `recordError(recorder, args, { error: "Cannot submit response yet. The following required tool(s) have not been called during this run: <missing names>. Call them before submitting." })` and do not call `deliver`.
- [x] 9.3 Early-return so that no further validation or delivery runs.
- [x] 9.4 Do not attempt to reconcile tool-name casing or whitespace — match is strict equality on full MCP name.

## 10. Required-tools diagnostic warning

- [x] 10.1 In `buildQueryTools`, after all tools are assembled, if `ctx.requiredTools` is set, compute the set of available tool names (`mcp__<server>__<tool>` for every tool across the clack server and every plugin server) and log a warning for any required-tool name not present in that set.
- [x] 10.2 Do NOT fail the run on mismatch — the gate will still block, and Claude's feedback will surface the issue.

## 11. Cron job model and execution

- [x] 11.1 Add optional `requiredTools?: string[]` to the `CronJob` TypeScript type (likely in `src/cronJobs.ts`).
- [x] 11.2 Ensure JSON serialization/deserialization includes the field when present. No migration needed (additive, backwards-compatible).
- [x] 11.3 In `src/cronScheduler.ts` `executeDynamicJob` (or equivalent), when invoking `processMessage`, pass `requiredTools: job.requiredTools`.
- [x] 11.4 Add tests for a cron job with `requiredTools`: verify the field is persisted, loaded, and forwarded to `processMessage`.

## 12. Tests

- [x] 12.1 `src/tools/server.test.ts`: test that `buildQueryTools` returns `mcpServers` with entries for `clack` and each loaded plugin.
- [x] 12.2 `src/tools/server.test.ts`: test that plugin tool handlers are wrapped and invoke the recorder with the full `mcp__<plugin>__<tool>` name, including the error-rethrow path.
- [x] 12.3 New submit_response tests for the required-tools gate: no required tools (pass-through), all required called (pass), missing required (error with exact names), partially missing (only missing listed), required tool called-but-errored (pass), gate blocks even with `skip_response: true`.
- [x] 12.4 (no existing tests asserted the collision warning — vacuously satisfied) Update any existing test that asserted the collision warning for plugin-vs-core tool names — the warning no longer fires.
- [x] 12.5 (trivia tests reference tools by bare name; the recorder identity doesn't cross-check in these tests) Update `src/plugins/trivia/trivia.test.ts` if it references tools by bare name — tests should now use the full `mcp__trivia__<tool>` form wherever the recorder or cross-session identity is checked.
- [x] 12.6 Test the required-tools diagnostic warning from task 10: assemble a query tool context whose `requiredTools` contains an entry not matching any available tool name, and assert that a warning is logged naming the unknown tool(s). The run still proceeds (no throw).
- [x] 12.7 (n/a — static cron jobs are not implemented in this repo; `CronJob` has no `staticMessage` field yet) Test that a static cron job (only `staticMessage`, no `prompt`) with a `requiredTools` field posts successfully and does not invoke the gate, since the static path bypasses `processMessage`.

## 13. Config and docs

- [x] 13.1 (n/a — cron jobs are runtime state in `data/state/cron-jobs.json`, not in `config.example.json`)
- [x] 13.2 (CLAUDE.md doesn't list cron-job fields — nothing to update) Update CLAUDE.md (or scheduling docs) if they list cron-job fields.
- [x] 13.3 (trivia uses bare tool names in instruction text — natural-language references are fine; Claude resolves them to the fully-qualified MCP tool at call time) Verify the trivia plugin's own instruction files (in `src/plugins/trivia/` or `data/default_configuration/.../trivia*`) reference tool names by their full `mcp__trivia__<tool>` form where needed.

## 14. Manual verification

- [x] 14.1 Run `npx tsc` to confirm no type errors.
- [x] 14.2 Run `npm test` to confirm all tests pass.
- [ ] 14.3 (manual — requires running bot) Start the bot locally and load the trivia plugin. Create a dynamic cron job (via the Home Tab, `create_scheduled_message` tool, or by editing `data/state/cron-jobs.json` directly) with `requiredTools: ["mcp__trivia__submit_answers"]` and a prompt that does not naturally invoke `submit_answers`. Trigger the job and confirm: (a) when Claude calls `submit_response` without first calling `submit_answers`, it receives the gate error identifying the missing tool and retries; (b) after calling `submit_answers`, delivery succeeds.
- [ ] 14.4 (manual — requires running bot) Verify the Home Tab and streaming UX display plugin tools under their own plugin name (not `clack`).

## 16. Plugin-declared scheduled defaults

- [x] 16.1 Extend `ClackSdk` in `src/plugins/sdk.ts` with `requireToolsForScheduled(tools: string[]): void` — appends bare tool names to a per-plugin list collected by the harvest.
- [x] 16.2 Extend `PluginLoadResult` with `scheduledRequiredTools: string[]` (bare names).
- [x] 16.3 Add optional `plugin?: string` field to `CronJob` in `src/cronJobs.ts`. Persist it through `createJob` / `updateJob`.
- [x] 16.4 In `src/cronScheduler.ts` `executeDynamicJob`, when building `requiredTools` for `processMessage`, compute the union of (a) `job.requiredTools ?? []` and (b) if `job.plugin` is set and the plugin is loaded, prefix the plugin's `scheduledRequiredTools` with `mcp__<plugin>__` and include them. Deduplicate. Log a warning if `job.plugin` is set but no plugin with that name is loaded.
- [x] 16.5 Expose `plugin` and `requiredTools` in `create_scheduled_message` and `update_scheduled_message` tool schemas (descriptions explain usage).
- [x] 16.6 Expose `plugin` in `list_scheduled_messages` output so users can see the plugin link.
- [x] 16.7 Update the trivia plugin to call `sdk.requireToolsForScheduled(["submit_answers"])`.
- [x] 16.8 Tests: plugin SDK records the declaration; cron union computation (explicit only, plugin only, both, neither, duplicates, unknown plugin warning); tool schema passes `plugin` through.

## 15. Validation

- [x] 15.1 Run `openspec validate enforce-required-tools --strict` and fix any reported issues.
