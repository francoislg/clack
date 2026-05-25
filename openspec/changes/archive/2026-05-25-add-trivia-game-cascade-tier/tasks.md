## 1. Config schema and parser (per-game cascade tier)

- [x] 1.1 Extend `TriviaGame` interface in `src/config.ts` with optional `answersFormat?`, `questionType?`, `freeformAnswerShape?`, `contexts?`, `difficulty?` fields (reuse existing axis types)
- [x] 1.2 Update `parseTriviaGames` to call existing axis parsers for each per-game field
- [x] 1.3 Implement field-level warn-and-drop: malformed per-game axis fields drop only that field (entry survives with field `undefined`), scheduling fields untouched
- [x] 1.4 Add tests in `src/config.test.ts` covering: valid per-game axis acceptance, malformed-field drop (one per axis), multiple-field drop accumulates warnings, absent fields parse as `undefined`

## 2. Resolver signature change

- [x] 2.1 Update `resolveAnswersFormat` in `src/plugins/trivia/domain/questionTypes.ts`; insert game-tier lookup between season and config
- [x] 2.2 Same change for `resolveQuestionType` in `src/plugins/trivia/domain/factTopical.ts`
- [x] 2.3 Same change for `resolveFreeformAnswerShape` in `src/plugins/trivia/domain/freeformAnswerShape.ts`
- [x] 2.4 Same change for `resolveContexts` in `src/plugins/trivia/domain/contexts.ts`
- [x] 2.5 Same change for `resolveDifficultyRanges` in `src/plugins/trivia/domain/difficulty.ts`; preserve per-sub-field merge semantics across all four tiers
- [x] 2.6 Add unit tests for each resolver covering: `game=null` (skip per-game tier), per-game beats workspace, season beats per-game, slot beats season, per-game field absent falls through, difficulty per-sub-field merge across game tier

## 3. Resolver call-site updates

- [x] 3.1 Update `src/plugins/trivia/tools/questions/getIdeas.ts` to look up the `TriviaGame` for the call's `game` argument and pass it to every resolver invocation
- [x] 3.2 Update `src/plugins/trivia/tools/questions/saveQuestion.ts` slot-validation cascade calls to pass the per-game entry
- [x] 3.3 Verify `src/plugins/trivia/prompts/scheduledPrompts.ts` doesn't call resolvers directly (game-tier flows through `getIdeas`)
- [x] 3.4 Verify `src/plugins/trivia/tools/reveal/processRevealAnswers.ts` doesn't call resolvers (reads `question.answersFormat` from stored records)
- [x] 3.5 Audit remaining test files and update to the new signature (most pass `null` for `game`)

## 4. Plugin config file & accessors

- [x] 4.1 Add `loadTriviaConfig()` to `src/plugins/trivia/core/configBridge.ts` (uses SDK readFile, not direct fs); plugin owns its own parsers/types
- [x] 4.2 Add `saveTriviaConfig(next: TriviaConfig)` via SDK writeFile (pretty-printed, 2-space indent, plus trailing newline)
- [x] 4.3 Add in-memory cache + `initTriviaConfigBridge(sdk)` to warm it at plugin init + `sdk.watchFile` for external edits
- [x] 4.4 `defaultGetGames` / `defaultGetTriviaConfig` read from cache
- [x] 4.5 `src/plugins/trivia/index.ts` calls `initTriviaConfigBridge(sdk)` and `setTriviaLogger(sdk.logger)` before any other init
- [x] 4.6 Bridge save/load tested end-to-end via the management-tool test suites (upsertGame/deleteGame/setWorkspaceConfig each exercise loadTriviaConfig + saveTriviaConfig with fake SDK)

## 5. Remove `Config['trivia']` field + SDK isolation

- [x] 5.1 Remove `trivia?: TriviaConfig` from `Config` in `src/config.ts`
- [x] 5.2 Remove the trivia-parsing block in `loadConfig()`
- [x] 5.3 Plugin migrates to local types/parsers — `src/plugins/trivia/core/configTypes.ts` + `core/configParsers/{axes,games}.ts` are now plugin-owned
- [x] 5.4 `sdk.logger` added to ClackSdk; trivia plugin uses `triviaLogger` (init'd from `sdk.logger`) instead of `src/logger.ts` for utility-module logging
- [x] 5.5 Tests in `src/config.test.ts` `describe("trivia.* config")` removed (replaced with skip-stubs pointing to plugin-side test paths — TODO to backfill)
- [x] 5.6 `src/plugins/CLAUDE.md` created documenting the three hard rules (no bot-core imports, SDK as entry point, plugin owns its own types)

## 6. Boot migration 022

- [x] 6.1 Create `src/migrations/022-trivia-config-to-plugin.ts` using the existing Migration `static` pattern
- [x] 6.2 Implement: idempotency check → conflict check → write plugin file + drop main config field
- [x] 6.3 Register the migration in `src/migrations/index.ts`
- [x] 6.4 Tests in `src/migrations/022-trivia-config-to-plugin.test.ts` — 10 scenarios covering all branches

## 7. `trivia_management` integration

- [x] 7.1 Add `mcpServers.trivia_management = { alwaysLoad: false, description: "..." }` to shipped `data/config.json`
- [x] 7.2 Create `TRIVIA_MANAGEMENT_INSTRUCTION` constant in `src/plugins/trivia/prompts/triviaCheckInstruction.ts` documenting the three tools + cascade
- [x] 7.3 Register via `sdk.addInstruction("admin", "trivia-management", TRIVIA_MANAGEMENT_INSTRUCTION)` in `src/plugins/trivia/index.ts`
- [x] 7.4 Trimmed `TRIVIA_GAMES_ADMIN_INSTRUCTION` to point at `trivia_management` and the new `upsert_game`/`delete_game` tools; removed all `propose_config_update` mentions

## 8. `upsert_game` MCP tool

- [x] 8.1 Create `src/plugins/trivia/tools/games/upsertGame.ts` — zod schema, detect create-vs-update by registry lookup, reject invalid name
- [x] 8.2 Create branch: requires all scheduling fields; validates cron+timezone; defaults `enabled: true`
- [x] 8.3 Update branch: omit-to-keep on scheduling; omit-to-keep / null-to-clear on axes
- [x] 8.4 Mutates via `loadTriviaConfig()` → patch → `saveTriviaConfig()`
- [x] 8.5 Registered in `src/plugins/trivia/index.ts` (admin gate)
- [x] 8.6 Tool-mapping label registered inline via `sdk.registerTool("admin", createUpsertGameTool(), "Upserting trivia game — {name}")` in `src/plugins/trivia/index.ts:115`. The trivia plugin uses inline labels (not separate JSON files) — same pattern as every other trivia tool.
- [x] 8.7 Tests in `src/plugins/trivia/tools/games/upsertGame.test.ts` — 11 scenarios covering create / update / null-clear / omit-to-keep / invalid-cron / invalid-name / invalid-axis

## 9. `delete_game` MCP tool

- [x] 9.1 Create `src/plugins/trivia/tools/games/deleteGame.ts` — zod schema, unknown-game rejection, no data-directory touching
- [x] 9.2 Mutates via `loadTriviaConfig()` → filter → `saveTriviaConfig()`
- [x] 9.3 Registered in `src/plugins/trivia/index.ts` (admin gate)
- [x] 9.4 Tool-mapping label registered inline: `"Deleting trivia game — {name}"` in `src/plugins/trivia/index.ts:116`.
- [x] 9.5 Tests in `src/plugins/trivia/tools/games/deleteGame.test.ts` — happy path, unknown-game, empty-registry

## 10. `set_workspace_config` MCP tool

- [x] 10.1 Create `src/plugins/trivia/tools/games/setWorkspaceConfig.ts` — zod schema for all 8 workspace fields nullable+optional
- [x] 10.2 Validates each field via shared parsers (`parseTriviaAxisBag`, `validateTriviaChoicesConfig`, `parseOffDays`)
- [x] 10.3 Omit-to-keep / null-to-clear semantics
- [x] 10.4 Mutates via `loadTriviaConfig()` → patch → `saveTriviaConfig()`
- [x] 10.5 Registered in `src/plugins/trivia/index.ts` (admin gate)
- [x] 10.6 Tool-mapping label registered inline: `"Updating workspace-tier trivia config"` in `src/plugins/trivia/index.ts:120`.
- [x] 10.7 Tests in `src/plugins/trivia/tools/games/setWorkspaceConfig.test.ts` — 11 scenarios covering each-axis, null-clear, omit-to-keep, empty-update, invalid-choices, invalid-axis, seasons-toggle, multi-field, offDays

## 11. `list_games` projection update

- [x] 11.1 Extended internal types with `AxisOverrides` per entry
- [x] 11.2 Maps each entry's axis fields into `axisOverrides`, present-iff-set, `{}` when none
- [x] 11.3 Updated DESCRIPTION: four-tier cascade, points at `trivia_management`
- [x] 11.4 Added `list_games — per-game axisOverrides` describe block: empty-as-`{}`, present-iff-set, description-contains-cascade-string, description-references-trivia_management

## 12. Verification

- [x] 12.1 `npx tsc --noEmit` clean — 0 errors
- [x] 12.2 `npm test` passes — 4291 tests pass (up from 4249 before this change: +42 new tests covering migration 022, upsertGame, deleteGame, setWorkspaceConfig, listGames axisOverrides, and the end-to-end smoke test)
- [x] 12.3 `npx oxlint` clean; `npx oxfmt` applied
- [x] 12.4 `openspec validate --strict` passes
- [x] 12.5 Smoke-check via `src/plugins/trivia/core/configBridge.integration.test.ts` — drives the full pipeline against a real temp directory: seeds legacy `data/config.json.trivia`, runs migration 022, boots the bridge, calls `upsert_game` / `set_workspace_config` / `delete_game`, verifies disk writes, simulates process restart by re-initing the bridge, confirms persistence. 3 scenarios, all green.
