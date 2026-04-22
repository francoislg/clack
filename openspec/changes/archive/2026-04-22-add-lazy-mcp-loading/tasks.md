## 1. Startup baseline smoke test — SHIP FIRST

This ships ahead of the rest of the change so we capture concrete baseline-token numbers for the **current, pre-lazy-loading** bot. Once captured, the subsequent lazy-loading tasks have a real before-number to measure against. The smoke test code is written to be MCP-set-agnostic — it just measures whatever the current `loadMcpServers()` and `promptBuilder` produce for each role, so nothing about it needs to change when lazy loading lands; it'll automatically reflect the post-change smaller baseline.

- [x] 1.1 New file `src/startupBaselineSmoke.ts`: export `runBaselineSmoke(config)` that, for each role in `["user", "dev", "admin"]`, calls `buildSystemPrompt({ role, changesWorkflowEnabled: true })` for the cascade output, then calls `clackQuery` (the helper used in real sessions — `src/claude/query.ts`) with `maxTurns: 1`, prompt `"ping"`, and a wall-clock timeout (default 60s) via `AbortController`. (Implementation opted for `buildSystemPrompt` as a DI'd dependency rather than building a synthetic `SessionContext` — simpler and closer to the production path.)
- [x] 1.2 Uses whatever `mcpServers` the current session-start code path uses (today: all of them via `loadMcpServers()`; after §9 lands: only always-on). Thin wrapper around the real code paths — no branching
- [x] 1.3 Captures `cache_creation_input_tokens` from the first `assistant` message via `extractCacheCreationTokens`; logs `baseline.tokens role=<role> tokens=<n>` at `info` using the existing logger. Same structured format across all three roles
- [x] 1.4 Each role's call is wrapped in try/catch; timeout/failure logs `baseline.tokens.failed role=<role> error=<msg>` at `warn` and continues with the next role. The smoke test does not throw or block startup
- [x] 1.5 Wired into `src/index.ts` between Step 3.5 and Step 4 (`createSlackApp()`) as `void runBaselineSmoke(config).catch(...)` — fire-and-forget, after config load and worktree setup, before Slack app creation
- [x] 1.6 Unit tests in `src/startupBaselineSmoke.test.ts`: succeeds per role (one log per role), failing role continues others, loadMcpServers reject is caught (zero queries attempted), different systemPrompt per role verified via dep stub, timeout aborts and logs failure for each role. `npm test` + `npx tsc` green
- [x] 1.7 **Baseline captured** (pre-lazy-loading, measured against the current bot with all 9 MCP servers always-attached). `cache_creation_input_tokens` alone was misleading due to serial-query cache hits, so the smoke test sums `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` for the true prompt size. Numbers are monotonic in the role chain (admin > dev > user), reflecting the cumulative cascade.
  - **user tokens**: 95,673
  - **dev tokens**: 96,602 (+929 over user — dev cascade additions)
  - **admin tokens**: 97,171 (+569 over dev — admin cascade additions)
  - **Target post-change**: >50% drop, driven primarily by shrinking the ~80–90K of MCP tool schemas currently baked into every turn.

## 2. Registry schema in `data/config.json`

- [x] 2.1 `McpServerRegistryEntry` and `McpServerRegistry` types defined in `src/config.ts`; exported for consumers
- [x] 2.2 `parseMcpServerRegistry` parses and validates `config.mcpServers` in `loadConfig()` — object shape enforced, `alwaysLoad` must be boolean, `description` must be non-empty string; field is optional (undefined if absent)
- [x] 2.3 `resolveEffectiveRegistry` in `src/mcp.ts` merges `config.mcpServers` with the actual `mcp.json` server list; every unmapped name gets a synthetic `{ alwaysLoad: true, description: UNMAPPED_REGISTRY_DESCRIPTION }` entry and is returned in the `unmapped` array so the caller can emit a warn. Startup never fails
- [x] 2.4 `DEFAULT_GITHUB_REGISTRY_ENTRY` (`{ alwaysLoad: true, description: "GitHub MCP — PRs, issues, code search" }`) is injected when GitHub is auto-injected and absent from the config registry; explicit operator overrides win
- [x] 2.5 Internal `clack` MCP is intentionally NOT part of the registry — it's handled as an always-on implicit server by the consumers (documented in `resolveEffectiveRegistry`'s JSDoc)
- [x] 2.6 Unit tests in `src/config.test.ts` (parser: valid registry, optional field, array rejection, missing alwaysLoad, empty description, non-object entry) and `src/mcp.test.ts` (resolveEffectiveRegistry: full mapping pass-through, synthetic entries for unmapped, github default injection, explicit github override wins, no github without auto-inject, undefined configRegistry, instructions-only entries preserved). `npm test` 2674 pass / 0 fail, `npx tsc` clean

## 3. `loadMcpServers` split into always-on vs by-name

- [x] 3.1 `loadAlwaysOnMcpServers(registry, deps)` in `src/mcp.ts` filters `loadMcpServers()` output to entries with `registry[name]?.alwaysLoad === true`; returns `undefined` when none qualify
- [x] 3.2 `loadMcpServer(name, deps)` returns a single `McpServerConfig`. Reuses `loadStaticMcpConfig` for `mcp.json` entries; for `name === "github"` without a manual entry, calls the newly-factored `buildGithubMcpEntry` helper so each call refreshes the GitHub App token
- [x] 3.3 `loadMcpServers()` kept and refactored to reuse `buildGithubMcpEntry`; existing behavior and tests unchanged
- [x] 3.4 Unit tests in `src/mcp.test.ts`: `loadMcpServer` (by-name lookup, missing name returns undefined, missing mcp.json returns undefined, github auto-inject mints a fresh token, manual github entry skips token mint); `loadAlwaysOnMcpServers` (filters to alwaysLoad=true, includes auto-injected github when tagged, returns undefined when nothing qualifies, untagged servers in mcp.json are excluded). 2683 pass / 0 fail

## 4. Cascading config resolver: topic subfolders

- [x] 4.1 `resolveInstructions` now takes `(roleChain, activeTopics?, virtualDefaults?)` — `activeTopics` inserted as the new second argument (optional, defaults to empty set); `virtualDefaults` moved to the third position. All two existing callers (`src/instructions.ts` and the cascading-config test file) updated to pass `undefined` for the new slot
- [x] 4.2 Private `resolveTopicFiles` helper walks `{role}/topics/{topic}/*.md` across the role chain with the same per-file default → virtual → custom cascade as baseline. Empty-file suppression inherited
- [x] 4.3 Virtual-default keys starting with `topics/<topic>/` are routed to topic resolution and excluded from the baseline discovery set. Plugins can now contribute topic content
- [x] 4.4 Topic files within a single topic share one `=== TOPIC: <name> ===\n\n` header and are concatenated alphabetically; topic sections appear after baseline, ordered alphabetically by topic name
- [x] 4.5 11 new unit tests covering baseline-excludes-topics, activation, override, additive file, role-chain cascade, empty-file suppression, multi-topic ordering, missing topic, plugin virtual topic default, virtual default NOT in baseline, disk custom over virtual
- [x] 4.6 New `listRoleTopicDirFiles(virtualDefaults?)` returns `{role, topic, files}[]` for Home Tab consumption; parallel `readRoleTopicFile(role, topic, filename)` returns `{default_content, custom_content}` mirroring `readRoleFile`. Home Tab UI wiring is deferred to §11.2

## 5. Integrations catalog in the system prompt

- [x] 5.1 New `src/claude/integrationsCatalog.ts` exports `buildIntegrationsCatalog(registry)` that filters out `alwaysLoad: true` entries and the internal `clack` entry; kept as its own module so future tool sites (e.g. `attach_integration` error result listing valid names) can reuse it
- [x] 5.2 Renders as one intro line + alphabetically-sorted bullet list `- <name> — <description>` + a trailing directive instructing Claude to call `attach_integration(...)` as a first step. Matches the design's catalog phrasing goal
- [x] 5.3 Injected in `src/claude/promptBuilder.ts` between the ATTACHED FILES block and `QUESTION:` (trigger-type-agnostic). Gated on `options.mcpRegistry` being provided — when absent (worker mode, or lazy-loading not yet wired at the call site), no catalog is emitted
- [x] 5.4 `buildIntegrationsCatalog` returns `""` when no entries qualify, and the prompt builder skips the section instead of emitting a blank line
- [x] 5.5 6 new unit tests in `src/claude/integrationsCatalog.test.ts`: alphabetical ordering, always-on exclusion, clack exclusion, empty-when-no-qualifiers, empty registry, directive phrasing. 2707 pass / 0 fail

## 6. `attach_integration` tool

- [x] 6.1 New file `src/tools/query/attachIntegration.ts`; registers a tool with input `{ name: string }` and reads `setMcpServers` from the `QueryHandle` at call time (not a bare `Query` handle — the handle holds `setMcpServers?: SetMcpServersFn` for easy testing)
- [x] 6.2 Input validation: `name` must exist in the registry (errors with the sorted list of known integrations if not); if already present in `handle.attachedServers`, returns an idempotent success (no SDK call, no re-injection of instructions)
- [x] 6.3 On call: (a) resolve topic instructions; (b) load the server config via `loadMcpServer(name)`; (c) for MCP-backed entries, call `setMcpServers({ ...handle.attachedServers, [name]: config })`; (d) inspect the returned `errors` map — if the name is in errors, return an error result with the connection error text and do NOT record the attach; (e) on success, update `handle.attachedServers`, append `name` to `session.attachedIntegrations`, and persist via `updateSession`
- [x] 6.4 On success (MCP-backed), returns `Attached integration: ${name}. New tools may now be available on the next turn.\n\n${instructions}` as the tool's text result
- [x] 6.5 Registry entries without a corresponding `data/mcp.json` server (instructions-only topics) skip the `setMcpServers` call but still resolve and inject instructions; return with clarifying prefix `This integration has no MCP server — instructions were loaded, no new tools arrive.`
- [ ] 6.6 Emit thinking-indicator events on start (`Attaching <name>…`), success (`Attached <name>`), and failure (`Failed to attach <name>: <error>`) — wire via existing stream event plumbing *(deferred — no stream-event plumbing exists in query-mode tool handlers today; current implementation returns the status via the tool text result which Claude can relay. Revisit if/when thinking-indicator events become a generalized capability.)*
- [x] 6.7 Unit tests in `src/tools/query/attachIntegration.test.ts`: successful attach, duplicate attach (idempotent), unknown name, instructions-only integration, setMcpServers reports error, setMcpServers throws, merges with previously-attached, persists attachedIntegrations (appends, not duplicates), persistence failure doesn't fail the tool, missing handle, missing setMcpServers binding, empty instructions fallback. 13 tests, 2719 pass / 0 fail, `npx tsc` clean. Also added `attach_integration` to `CLACK_CORE_TOOL_NAMES` so the tool-name validator recognizes it

## 7. Tool context wiring

- [x] 7.1 `QueryHandle` (not `Query` directly — carries only `setMcpServers?`, `attachedServers`, and `registry`) added to `src/tools/types.ts`; `queryHandle?: QueryHandle` threaded through `QueryToolContext`
- [x] 7.2 `buildQueryContext` in `src/tools/context.ts` accepts `queryHandle?` and forwards it onto the returned context
- [x] 7.3 `src/claude/index.ts` `buildQuerySetup`: builds the effective `McpServerRegistry` via `resolveEffectiveRegistry({ configRegistry, mcpServerNames, githubAutoInjected })`, constructs a fresh `QueryHandle` ({ attachedServers: {}, registry }), passes it to `buildQueryContext`. In `askClaude`, the `clackSession({ ..., onQuery: (q) => { queryHandle.setMcpServers = q.setMcpServers.bind(q); } })` callback populates the binding before the first SDK message yields. The integrations catalog is also piped into `buildPrompt(session, { ..., mcpRegistry: registry })`
- [x] 7.4 `attach_integration` is registered in `src/tools/server.ts` gated on `ctx.queryHandle` — available whenever lazy-loading is wired (query-mode), hidden in worker mode (no `queryHandle` on `WorkerToolContext`). Added to `CLACK_CORE_TOOL_NAMES` in §6.7.

## 8. Session state and resume

- [x] 8.1 `attachedIntegrations?: string[]` added to `SessionContext` in `src/sessions.ts` (optional; undefined/empty means no lazy integrations). Implicitly persisted — `stripRuntimeFields` only omits `activeChange` and `threadContext`
- [x] 8.2 Persistence round-trip is automatic via the existing Q&A session machinery; no changes to `persistence.ts`/`restore.ts` needed (those are the changes-workflow worker files, not Q&A)
- [x] 8.3 In `src/claude/index.ts`, `onQuery` now awaits `replayAttachedIntegrations(session, queryHandle)` which, for resumed sessions with non-empty `attachedIntegrations`, calls `handle.setMcpServers(configs)` before the first user turn. Achieved by widening `onQuery` in `src/claude/query.ts` to `(q) => void | Promise<void>` and awaiting it in `clackSession`'s generator
- [x] 8.4 Stale names (not present in `handle.registry`) are logged with a warn and persisted out via `updateSession` — the session proceeds with the cleaned list
- [x] 8.5 Unit tests in `src/claude/replayAttachedIntegrations.test.ts`: no-op (absent, empty, unbound handle), re-attaches known integrations via setMcpServers, drops stale & persists clean list, instructions-only skips setMcpServers, loadMcpServer failures tolerated, setMcpServers exceptions tolerated. 8 tests. 2728 pass / 0 fail, `npx tsc` clean

## 9. Swap the session-start MCP set

- [x] 9.1 `src/claude/index.ts` `buildQuerySetup` now calls `loadAlwaysOnMcpServers(registry)` instead of `loadMcpServers()`, so only servers tagged `alwaysLoad: true` attach at session start. Resumed sessions add `previouslyAttached` via `replayAttachedIntegrations` (§8.3) — applied through `setMcpServers`, not `options.mcpServers`. 2728 tests pass, `npx tsc` clean
- [ ] 9.2 Validate baseline token count — **manual verification pending operator test**. Run a representative query end-to-end with the changes applied, then re-run the startup baseline smoke or inspect `data/.claude/projects/<project>/<sdkSessionId>.jsonl`. Compare against §1.7 baseline (user: 95,673 / dev: 96,602 / admin: 97,171) — expect >50% drop. Record numbers here when measured.

## 10. Migration: split topical content between baseline and topics

The migration was redesigned mid-implementation. A naive "move file X to topics/Y" transform was replaced with a **two-migration split**: a static registry seeder (016) and a Claude-powered content splitter (017) that separates general "when-to-attach" triggers from environment-specific "how-to-use" details.

### Migration 016 — static, blocking: seed the registry

- [x] 10.1 `src/migrations/016-topic-subfolders.ts` — blocking, static transform. Reads `data/mcp.json` and seeds each server name into `config.mcpServers` with `{ alwaysLoad: false, description: "TODO: …" }` if absent. Preserves operator-set entries verbatim; drops entries with invalid `alwaysLoad`/`description` shapes. No file moves — content reorganization is migration 017's job
- [x] 10.2 Unit tests in `src/migrations/016-topic-subfolders.test.ts` — 10 tests covering metadata, seeding from empty, preserving operator entries, idempotency (no rewrite when complete), missing mcp.json tolerated, malformed inputs skipped, invalid-entry drop-and-reseed. 2728 pass / 0 fail, `npx tsc` clean

### Migration 017 — prompt-based, enhancement: classify and split instruction content

- [x] 10.3 `src/migrations/017-split-topic-files.ts` — enhancement priority, prompt-based. Runs after boot via `src/migrations/engine.ts`. Claude receives every known user `.md` file (baseline and existing topics) plus `data/mcp.json`; classifies each *section* into Bucket A (routing/trigger → stays baseline) or Bucket B (tool names, signatures, env specifics → moves to `{role}/topics/<mcp>/`). Files not about any MCP server (personas, response-style, general policies) are left untouched. Re-run-safe via per-file content inspection
- [x] 10.4 Prompt explicitly walks Claude through the bucket rules with 3 worked examples per bucket, preserves operator tone (no paraphrasing), and requires an `attach_integration("<name>")` trigger line to appear in the baseline file after splitting
- [x] 10.5 Unit tests in `src/migrations/017-split-topic-files.test.ts` — prompt-shape assertions (metadata, file list coverage, bucket terminology, re-run guard). Prompt-based migrations are not end-to-end tested against live Claude here — the engine's general migration tests cover execution

## 11. Documentation and home tab

- [x] 11.1 `CLAUDE.md` "Instruction System" section updated with a new bullet explaining baseline vs topic files, the cascade behavior, and how the MCP registry governs which integrations lazy-load. The `cascading-config-resolver` spec delta in `openspec/changes/add-lazy-mcp-loading/specs/cascading-config-resolver/spec.md` already documents the topic folder contract at spec level; a post-archive sync to `openspec/specs/` is handled by the archive step
- [ ] 11.2 Home Tab instruction-file editor extension — **deferred**. The editor currently surfaces files via `listRoleDirFiles` (baseline-only). The new `listRoleTopicDirFiles`/`readRoleTopicFile` helpers from §4.6 give the Home Tab everything it needs; the remaining work is UI wiring (new section, grouping files by topic, plumbing the topic-scoped path through `propose_config_update`). Owner: follow-up change after verifying §12. Not blocking §9 rollout since baseline file editing still works
- [x] 11.3 `data/default_configuration/user/integrations.md` created — always-loaded (baseline, not a topic) — explains that the AVAILABLE INTEGRATIONS catalog is actionable and instructs Claude to call `attach_integration("<name>")` as a first step when the question matches a catalog entry. Includes three worked examples (Metabase dashboard, scheduling, Sentry errors), a "do not" list, AND an explicit fallback rule: *if you reach for a tool that isn't in your toolset, check the catalog and try attaching before telling the user "I can't do that"*. This catches cases where baseline files reference MCP tool names directly (expected, since operators authored instructions before lazy-loading existed), so we don't need to auto-rewrite every cross-reference in migration 017

## 12. End-to-end verification

- [x] 12.1 `npm test` and `npx tsc` green — 2735+ tests pass / 0 fail, no type errors. Test count varies between runs (~2720–2739) because of the test runner's parallel discovery; all configurations green
- [ ] 12.2 Smoke: question that obviously hits Metabase — confirm Claude calls `attach_integration("metabase")` before attempting a query *(operator verification — requires live Slack session)*
- [ ] 12.3 Smoke: question with no external integration needed — confirm no `attach_integration` calls and baseline token count stays below target *(operator verification)*
- [ ] 12.4 Thread continuation: question that attaches Metabase, follow-up in the same thread — confirm Metabase stays attached across the resume *(operator verification; covered by `replayAttachedIntegrations` unit tests at the isolated level)*
- [ ] 12.5 Failure simulation: temporarily break a Monday credential, ask a Monday question, confirm Claude reports gracefully *(operator verification; the tool's text result will relay the error back to Claude as a visible tool failure, which Claude is already instructed to handle in `tool-errors.md`)*
- [ ] 12.6 Operator UX check: add a new server to `data/mcp.json` without registering it in `config.json`, restart Clack, confirm startup succeeds with a `warn` log and the smoke test still reports baseline tokens per role *(covered by `resolveEffectiveRegistry` tests, plus startup `runBaselineSmoke` which doesn't depend on registry state; operator to confirm the warn log path end-to-end)*
- [ ] 12.7 Compare §1.7's "before" numbers against the post-change `baseline.tokens` readings — confirm the drop matches the >50% target and record both in the change folder *(operator verification — run Clack after this change and read the new per-role token totals)*
