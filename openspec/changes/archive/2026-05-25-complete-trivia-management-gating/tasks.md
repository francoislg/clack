## 1. SDK primitive — integration-gating options on `registerTool`

- [x] 1.1 In `src/plugins/sdk.ts`, add a `RegisterToolOptions` type (`{ integration?: string }`) near the `ToolMapping` declaration.
- [x] 1.2 Extend the `RegisteredTool` interface with an optional `integration?: string` field.
- [x] 1.3 Extend the `ClackSdk.registerTool` signature with an optional 4th `options?: RegisterToolOptions` parameter. JSDoc explains both modes and the requirement that `integration` matches a catalog entry (either `data/config.json` `mcpServers` or a plugin's `registerIntegration` declaration).
- [x] 1.4 Update the SDK factory `registerTool` implementation to accept the new options object and propagate `options?.integration` onto the `RegisteredTool` record.

## 2. SDK primitive tests

- [x] 2.1 In `src/plugins/sdk.test.ts`, add a unit test: calling `registerTool("admin", tool, mapping, { integration: "foo" })` records a `RegisteredTool` with `integration: "foo"` and `minRole: "admin"`.
- [x] 2.2 Add a unit test: calling `registerTool("admin", tool, mapping)` with no options records a `RegisteredTool` with `integration: undefined`.
- [x] 2.3 Add a unit test: both call shapes register the mapping into `toolMappings` identically.

## 3. Tool server integration filter

- [x] 3.1 In `src/tools/server.ts`, inside the plugin tool assembly loop, add a second filter after the `meetsMinimumRole` check: `if (registered.integration && !(ctx.session.attachedIntegrations ?? []).includes(registered.integration)) continue;`.
- [x] 3.2 (Decided no inline comment — the typed field name + the `attachedIntegrations` reference are self-evident.)
- [x] 3.3 No other changes to `server.ts`.

## 4. Tool server filter tests

- [x] 4.1 Add an integration test using a fixture plugin that registers three tools: `tool_a` with `{ integration: "foo" }`, `tool_b` with `{ integration: "bar" }`, and `tool_c` with no options. Assert: session with `attachedIntegrations: []` sees only `tool_c`; session with `["foo"]` sees `tool_a` and `tool_c`; session with `["foo", "bar"]` sees all three.
- [x] 4.2 Role-gate still applies: dev-role session with `attachedIntegrations: ["foo"]` sees zero of the three (all admin-only).
- [x] 4.3 Missing `attachedIntegrations` field treated as empty array.

## 5. `attach_integration` success message tweak

- [x] 5.1 In `src/tools/query/attachIntegration.ts:185-187`, update the `kindNote` ternary so the message for non-MCP integrations becomes "New tools may now be available on the next turn." when `resolveTopicFiles` returned non-empty content. Keep the existing "no MCP server — instructions were loaded, no new tools arrive." path only for the case where both are empty (which shouldn't happen for a valid registered topic, but is a defensive fallback).
- [x] 5.2 Add or update a unit test asserting the new message wording for the trivia:management topic (instructions resolve, no MCP server).
- [x] 5.3 Grep for the exact prior message string (`"no new tools arrive"`) across the repo to ensure no other test fixture or snapshot relies on it. Update any matches.

## 6. Trivia plugin — flip instruction registration

- [x] 6.1 Change `sdk.addInstruction("admin", "trivia-management", ...)` to `sdk.addTopicInstruction("admin", "trivia:management", "trivia-management", ...)`.
- [x] 6.2 Delete the stale comment block in `triviaCheckInstruction.ts:200-203` about "Registered eagerly… once add-plugin-topic-instructions lands."
- [x] 6.3 Rewrite the comment block above the management-tool registrations to describe the topic-gated reality.

## 7. Trivia plugin — add integration gating to the seven management tool registrations

- [x] 7.1 Append `{ integration: "trivia:management" }` to the `sdk.registerTool` call for `createUpsertGameTool()`.
- [x] 7.2 Same for `createDeleteGameTool`.
- [x] 7.3 Same for `createSetWorkspaceConfigTool`.
- [x] 7.4 Same for `createUpsertSeasonTool(data)`.
- [x] 7.5 Same for `createDeleteSeasonTool(data)`.
- [x] 7.6 Same for `createAddCategoriesTool(data)`.
- [x] 7.7 Same for `createRemoveCategoriesTool(data)`.
- [x] 7.8 Verified no other tool in `src/plugins/trivia/index.ts` got the integration field — runtime tools and read-only inspection tools remain on plain `registerTool` (no options).

## 8. Rewrite the management instruction body

- [x] 8.1 Rewrote `TRIVIA_MANAGEMENT_INSTRUCTION` — now enumerates all seven tools in four sub-sections (Lifecycle/games, Lifecycle/seasons, Categories, Workspace defaults).
- [x] 8.2 Added explicit "Dispatch heuristic" section at the top of the instruction.
- [x] 8.3 "When to use which" cheatsheet now includes season + categories examples alongside the original game/workspace ones.
- [x] 8.4 Cascade-tier cheatsheet rewritten — no longer says `upsert_season` is "NOT in this integration."

## 9. SDK primitive — `registerTopic`

- [x] 9.1 In `src/plugins/sdk.ts`, add `PluginIntegration` type `{ name: string; description: string; alwaysLoad: boolean }` near `RegisterToolOptions`. Add `registerIntegration(name, { description, alwaysLoad? })` to the `ClackSdk` interface.
- [x] 9.2 Implement `registerIntegration` in the SDK factory: push a `PluginIntegration` record onto a closure-scoped `integrations: PluginIntegration[]` array; surface it through `harvest()`.
- [x] 9.3 Extend `PluginLoadResult` with `integrations: PluginIntegration[]`. Updated `stubPlugin` fixture in `src/tools/server.test.ts` to include the field.
- [x] 9.4 SDK unit tests for `registerIntegration` (4 scenarios: default alwaysLoad, explicit alwaysLoad, duplicate-name append, empty by default).

## 10. MCP registry merge — plugin contributions

- [x] 10.1 `resolveEffectiveRegistry()` accepts a new optional `pluginIntegrations` input and merges entries into the registry. Collisions log a warning naming both sources; last-write-wins.
- [x] 10.2 Added test for plugin-only integration merge.
- [x] 10.3 Added test for collision warning path.
- [x] 10.4 Threaded `getLoadedPluginIntegrations()` (new helper in `src/plugins/state.ts`) through all four `resolveEffectiveRegistry` callers: `src/index.ts`, `src/claude/mcpServerManager.ts`, `src/slack/homeTab.ts`, `src/startupBaselineSmoke.ts`.

## 11. Trivia plugin — declare `trivia:management` integration

- [x] 11.1 `src/plugins/trivia/index.ts` calls `sdk.registerIntegration("trivia:management", { description: TRIVIA_MANAGEMENT_DESCRIPTION, alwaysLoad: false })` next to the existing `addTopicInstruction` call.
- [x] 11.2 Hoisted `TRIVIA_MANAGEMENT_DESCRIPTION` constant into `prompts/triviaCheckInstruction.ts`.
- [x] 11.3 New test file `prompts/triviaCheckInstruction.test.ts` asserts the description mentions all seven tool names + flags itself admin-only.
- [x] 11.4 Renamed the leftover `trivia_management` string in `src/plugins/trivia/tools/games/listGames.ts` (description text) to `trivia:management`. Updated the matching test in `listGames.test.ts`.

## 12. Delete the `data/config.json` entry

- [x] 12.1 Deleted `mcpServers.trivia_management` from `data/config.json` (cleaned up the trailing comma on `scheduling`).
- [x] 12.2 Booted via tests — registry-merge tests + listGames test + SDK tests all pass without the config entry; `attach_integration("trivia:management")` validates because the entry now comes from the plugin via the merged registry.

## 13. Trivia plugin integration test

- [x] 13.1 Added `src/plugins/trivia/integration.gating.test.ts` — loads the trivia plugin, asserts none of the seven management tools appear with `attachedIntegrations: []`.
- [x] 13.2 Same fixture asserts all seven appear with `attachedIntegrations: ["trivia:management"]`.
- [x] 13.3 Runtime + read-only tools (`list_games`, `list_seasons`, `find_previous_questions`, `retrieve_scores`, `get_ideas`, `save_question`, `post_questions`, `get_question_history`, `submit_answers`, `process_reveal_answers`, `check_season_status`, `save_cheating`) asserted present in both catalog snapshots.
- [x] 13.4 Test asserts `resolveEffectiveRegistry()` returns a `trivia:management` entry from the plugin contribution (end-to-end registerIntegration → resolver-merge pipeline).

## 14. Documentation pass

- [x] 14.1 `CLAUDE.md` (project root) "Internal MCP Tools" section now mentions plugin-gated tools and `sdk.registerIntegration`, with `trivia:management` as the live example.
- [x] 14.2 Grepped + updated: `src/plugins/trivia/tools/games/listGames.ts` instruction body uses `trivia:management`; `listGames.test.ts` regex matches the new name. Removed `data/config.json` entry. No stale `trivia_management` references remain in live code.
- [x] 14.3 `src/plugins/CLAUDE.md` has a new "Topics vs Integrations" section documenting the two concepts, the `<plugin>:<key>` convention, and the four SDK touch points.

## 15. Verification

- [x] 15.1 `npx tsc` passes for every file this PR changes (pre-existing `difficultyRatio`/`freeformAnswerShape` errors in unrelated in-progress trivia work are not introduced by this change).
- [x] 15.2 `npm test` passes: 4349/4349 tests across 846 suites.
- [x] 15.3 `npx oxlint` passes on all changed files (0 warnings, 0 errors).
- [x] 15.4 `npx oxfmt --check` passes (auto-fixed 4 files during verification: `data/config.json`, `src/plugins/sdk.ts`, `src/plugins/trivia/index.ts`, `src/tools/server.test.ts`).
- [x] 15.5 `openspec validate complete-trivia-management-gating --strict` reports valid.
- [ ] 15.6 Manual smoke test deferred to deploy verification.
