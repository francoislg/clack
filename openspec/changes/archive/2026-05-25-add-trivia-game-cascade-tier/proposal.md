## Why

Two problems compound:

1. **No per-game tier on the cascading axis configuration.** Today's cascade is `slot → season → workspace → built-in default`. A deployment running multiple parallel games (e.g. `engineering`, `marketing`) can't say "engineering rolls boolean+choice but marketing rolls boolean only" without either editing the workspace default (affects every game) or abusing seasons (which are meant for themed time windows). A real per-game tier closes this gap.

2. **`TriviaConfig` is wedged into `data/config.json` with no MCP surface to manage it.** Adding, editing, or removing games today requires hand-editing `data/config.json` — admins can't ask Claude to "add a trivia game in #engineering" and have it work. The same is true for every workspace-tier axis. The trivia plugin owns rich state (`data/plugins/trivia/...`) but its *configuration* lives in the bot's main config file, which is awkward for plugin authors and forces every config change through manual JSON editing.

This change fixes both: it relocates `TriviaConfig` to a plugin-owned file (`data/plugins/trivia/config.json`), introduces a `trivia_management` integration with admin-gated MCP tools that mutate that file safely, and adds the per-game tier as a first-class concept on the new schema.

## What Changes

- **NEW (relocation)** — Move the entire `TriviaConfig` block (games, seasons, axes, choices, offDays) out of `data/config.json` and into `data/plugins/trivia/config.json`. The main bot config no longer carries a `trivia` field. A blocking boot migration (`022-trivia-config-to-plugin.ts`) performs a one-shot copy + delete on existing deployments.
- **NEW (cascade tier)** — Extend `TriviaGame` with five optional axis fields (`answersFormat?`, `questionType?`, `freeformAnswerShape?`, `contexts?`, `difficulty?`). Cascade becomes `slot → season → game → workspace → built-in default` for every cascading axis. Resolver signatures change from `resolve*(season, slot, config)` to `resolve*(season, slot, game, config)`.
- **NEW (management tools)** — Three admin-gated MCP tools register on the internal Clack tool server:
  - `upsert_game(name, channel?, questionCron?, revealCron?, timezone?, enabled?, answersFormat?, questionType?, freeformAnswerShape?, contexts?, difficulty?)` — create OR update a game. Create requires all scheduling fields; update applies omit-to-keep semantics and accepts `null` to clear per-axis overrides.
  - `delete_game(name)` — remove the entry; the plugin reconciles cron jobs (and the per-game data directory is preserved on disk for archival).
  - `set_workspace_config({ answersFormat?, questionType?, freeformAnswerShape?, contexts?, difficulty?, choices?, offDays?, seasons? })` — update any subset of workspace-tier fields. Explicit `null` clears the field. Validates each field with the same parsers used by the file loader.
- **NEW (integration)** — Register `trivia_management` in `config.mcpServers` (`alwaysLoad: false`, description scoped to "manage trivia games and workspace-tier configuration"). The topic ships a virtual-default instruction file via `sdk.addInstruction("admin", "trivia-management", ...)` that documents the three tools and the cascade. Tools are physically always-registered for admins; the topic instructions teach Claude when to invoke them.
- **MODIFIED** — `list_games` response gains a per-entry `axisOverrides` block mirroring how `workspaceDefaults` surfaces the workspace tier.
- **MODIFIED** — `TRIVIA_GAMES_ADMIN_INSTRUCTION` is shortened: it now points at the `trivia_management` integration for lifecycle/axis tasks and stops describing JSON editing as the primary workflow.
- **BREAKING (for raw config consumers)** — `Config['trivia']` field is removed from `src/config.ts`. Internal callers migrate to the plugin's accessor (`getTriviaConfig()` from `configBridge.ts`), which reads from the new plugin file. No user-visible breaking change.

## Capabilities

### New Capabilities

- `trivia-plugin-config-file`: The trivia plugin's own config file (`data/plugins/trivia/config.json`), its schema, its loader, and the boot migration that relocates existing data from `data/config.json`.
- `trivia-management-tools`: The `trivia_management` integration — three admin-gated MCP tools (`upsert_game`, `delete_game`, `set_workspace_config`) plus their topic instruction.
- `trivia-game-overrides`: Per-game tier of the cascading axis configuration — fields on `TriviaGame`, parser, resolvers, and `list_games` `axisOverrides` projection.

### Modified Capabilities

- `trivia-games`: `TriviaGame` shape grows the per-game axis fields. Game lifecycle (create / rename / delete / enable-toggle) now has a first-class MCP surface (`upsert_game` / `delete_game`) instead of being config-edited only. `list_games` response gains `axisOverrides` per entry.
- `trivia-seasons`: Cascade docs (`slot → season → workspace`) become `slot → season → game → workspace`. Same change in `save_question` slot validation.
- `trivia-question-contexts`: Cascade docs gain the per-game tier.
- `trivia-choice-questions`: Cascade docs for `answersFormat` gain the per-game tier.
- `trivia-topical-questions`: Cascade docs for `questionType` gain the per-game tier.
- `lazy-mcp-loading`: Adds `trivia_management` to the integration catalog as a non-always-load entry.
- `boot-migrations`: New migration `022-trivia-config-to-plugin.ts` registered in the boot runner.

## Impact

**Code:**
- `src/config.ts` — `Config['trivia']` removed; the workspace-level `parseTrivia*` family of functions move (or stay exported) but are called by the plugin loader, not the main loader.
- `src/plugins/trivia/core/configBridge.ts` — gains `loadTriviaConfig()` / `saveTriviaConfig()` reading/writing `data/plugins/trivia/config.json`. `defaultGetGames` / `defaultGetTriviaConfig` switch to reading from the new file.
- `src/plugins/trivia/index.ts` — loads `data/plugins/trivia/config.json` at plugin startup; passes the parsed `TriviaConfig` into tools via `getConfigFn` injection. Registers the `trivia_management` admin instruction.
- `src/plugins/trivia/domain/{questionTypes,factTopical,freeformAnswerShape,contexts,difficulty}.ts` — resolver signatures gain a `game` param (DONE in code).
- `src/plugins/trivia/tools/games/upsertGame.ts` — NEW.
- `src/plugins/trivia/tools/games/deleteGame.ts` — NEW.
- `src/plugins/trivia/tools/games/setWorkspaceConfig.ts` — NEW.
- `src/plugins/trivia/tools/games/listGames.ts` — extend with `axisOverrides`.
- `src/plugins/trivia/prompts/triviaCheckInstruction.ts` — rewrite the games-management section and add a `TRIVIA_MANAGEMENT_INSTRUCTION` for the new integration.
- `src/migrations/022-trivia-config-to-plugin.ts` — NEW.
- `data/config.json` — `mcpServers.trivia_management = { alwaysLoad: false, description: "..." }` registered.

**Call-site sweep:** every `getConfig().trivia` usage migrates to a plugin-scoped accessor. Includes the resolvers (already injected via the call sites that own the lookup), tool descriptions, scheduled prompts, season tools, etc. Audit ahead of implementation to confirm count.

**Migration safety:**
- The boot migration is idempotent: if `data/plugins/trivia/config.json` already exists, it's a no-op for the copy; if `data/config.json` no longer has a `trivia` field, the delete is a no-op.
- Existing per-game `TriviaGame` entries from `config.trivia.games[]` map 1:1 into the new file with no shape change at relocation time. The new per-game axis fields are added optionally and parse as absent for pre-migration data.
- No data files under `data/plugins/trivia/games/` are touched.

**No breaking change to user-visible trivia behavior.** The cascade extension is transparent unless an admin sets a per-game override. The relocation is a no-op for trivia gameplay — same parsers, same resolvers, same data files.

**Coordination with parallel changes:** `add-plugin-topic-instructions` enables proper topic-loaded instructions for plugins. For now this change registers the `trivia_management` instruction eagerly under the admin role (via existing `sdk.addInstruction`). The parallel change can later flip it to `sdk.addTopicInstruction` for true lazy loading without breaking the tools.
