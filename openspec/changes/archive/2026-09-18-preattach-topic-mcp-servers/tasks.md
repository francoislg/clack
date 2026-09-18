## 1. Session-start loading of external servers

- [x] 1.1 `src/claude/mcpServerManager.ts`: add `preAttachedTopics: readonly string[] = []` to `prepareMcpSession` (before `deps`); for each name in the effective registry and not already in `alwaysOnExternals` or `resumedAttached`, call `deps.loadMcpServer`; skip `undefined`, `logger.warn` + skip on throw; return the configs as `McpSessionSetup.preAttached` in list order
- [x] 1.2 `completeSessionStart`: merge `setup.preAttached` into the baseline after `alwaysOnExternals` and before the clack/plugin servers, so `hydrateSessionStart` sees it and `isInSessionStart(name)` is true
- [x] 1.3 `src/claude/index.ts` `buildQuerySetup`: pass `options?.preAttachedTopics` to `prepareMcpSession`
- [x] 1.4 Tests in `src/claude/mcpServerManager.test.ts` (`prepareMcpSession` / `completeSessionStart` with injected deps): registry server is loaded and lands in the session-start map; non-registry name skipped without calling `loadMcpServer`; `undefined` config skipped; throwing loader logs and skips; name already resumed or always-on is not loaded again; output order follows the topic list
- [x] 1.5 Test in `src/claude/querySetup.userId.test.ts`: `buildQuerySetup` forwards `options.preAttachedTopics` to `prepareMcpSession` (with the existing `job.attachedTopics` → `preAttachedTopics` coverage in `cronScheduler.test.ts` / `core.test.ts`, this closes the cron-fire path)

## 2. Plugin on-demand servers

- [x] 2.1 `src/tools/server.ts`: widen the on-demand gate to `spec.autoload || attachedSnapshot.includes(spec.fullName) || (ctx.preAttachedTopics ?? []).includes(spec.fullName)`
- [x] 2.2 Tests in `src/tools/server.test.ts` ("integration-gated plugin tools"): a pre-attached `trivia:foo` reveals `mcp__trivia_foo__tool_a` and not `tool_b`; role gate still applies

## 3. `attach_integration` short-circuit and recovery

- [x] 3.1 `src/tools/query/attachIntegration.ts`: in the pre-attached branch, short-circuit unless the name is an external server the session lacks (not in session start, or in session start but not `isLiveInBaseline`); result text states instructions and tools are already available
- [x] 3.2 Otherwise fall through to the real attach, reusing the config loaded by the check (one `loadMcpServer` call); on that path omit the topic instructions from the result for a pre-attached name; report a throwing load as a failed attach
- [x] 3.3 Tests in `src/tools/query/attachIntegration.test.ts`: loaded pre-attached server → no `setMcpServers`, new wording, no instructions; pre-attached name unknown to the registry → short-circuit (existing test keeps passing); pre-attached plugin on-demand server (no `mcp.json` entry) → short-circuit, no `setMcpServers`; pre-attached known server missing from session start, or present but not connected → real attach, tools-registered note, no instructions, one load; a throwing server-config load → failed attach recorded in history

## 4. Schedule tool descriptions and docs

- [x] 4.1 `createScheduledMessage.ts` / `updateScheduledMessage.ts`: extend the `attached_topics` description — a topic naming an integration pre-loads its MCP server on every fire; declare integrations the job always uses
- [x] 4.2 `CLAUDE.md` Instruction System → "Baseline vs topic files": state that a pre-attached topic naming an MCP server loads the server at session start
- [x] 4.3 `npx tsc --noEmit`, `npx oxlint` + `npx oxfmt` on touched files, `npm test`, `openspec validate preattach-topic-mcp-servers --strict`, `graphify update .`

## 5. Pre-deploy check

- [x] 5.1 On the VM, list cron jobs whose `attachedTopics` contain a registry server name (names + job ids only) and report them before deploy

  Result: none do, so no existing job starts loading a server on deploy.

Deploy, the auth monitor's `attached_topics` update, and the cost measurement follow the design's Migration Plan.
