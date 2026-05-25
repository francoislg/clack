## Context

The trivia plugin currently reads its configuration from `data/config.json`'s `trivia` block, parsed by `src/config.ts`. Per-game state, per-season state, and gameplay data already live under `data/plugins/trivia/...`. The only thing still in the bot-wide config file is the trivia *settings* — games registry, workspace-tier axes, choices, offDays, seasons enable-flag.

Two things are awkward today:

1. **No per-game tier on the axis cascade.** Resolvers walk `slot → season → workspace → built-in default`. Multiple parallel games can't carry their own defaults.
2. **No MCP surface for managing trivia configuration.** Admins hand-edit `data/config.json` to add/remove games or tweak workspace axes. This is the only piece of trivia state that *isn't* managed via MCP tools — every other trivia data file (questions, seasons, categories, users) has its own tool family.

The change relocates the trivia config to a plugin-owned file (`data/plugins/trivia/config.json`), adds an `upsert_game` / `delete_game` / `set_workspace_config` tool family gated to the admin role via the new `trivia_management` integration, and inserts the per-game tier into every cascading axis.

Work already completed (sections 1-3 of the original tasks list): the per-game tier is wired into `TriviaGame`, `parseTriviaGames`, and all five resolvers (`questionTypes`, `factTopical`, `freeformAnswerShape`, `contexts`, `difficulty`), with their tests updated.

## Goals / Non-Goals

**Goals:**

- Move the entire `TriviaConfig` block (games, seasons, axes, choices, offDays) out of `data/config.json` and into `data/plugins/trivia/config.json` via a blocking boot migration.
- Add `slot → season → game → workspace → built-in default` for every cascading axis (`answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`).
- Provide three admin-gated MCP tools (`upsert_game`, `delete_game`, `set_workspace_config`) that mutate the plugin config file directly with strong validation.
- Register a `trivia_management` integration with a topic instruction documenting the three tools and the cascade.
- Preserve current trivia behavior end-to-end — the relocation is invisible to gameplay; the cascade extension is invisible unless an admin opts in.

**Non-Goals:**

- Lazy / conditional registration of the management tools (they're always admin-registered; `trivia_management` only gates the *instructions* via the existing `attach_integration` mechanism, not the tool catalog itself). True topic-gated tool registration is a future primitive.
- An MCP server for `trivia_management` distinct from the main Clack tool server. The tools are clack-internal; the integration name is just a label that catalogs them under `attach_integration`.
- Touching the gameplay data files under `data/plugins/trivia/games/...`. Only the configuration file moves.
- Schema validation beyond what the existing workspace-tier parsers already perform. New tools call the same `validate*Map` functions used at file-load time.

## Decisions

### Decision 1: Plugin config file location and shape

**Choice:** `data/plugins/trivia/config.json` holds the entire `TriviaConfig` object as its top-level JSON value (NOT wrapped under a `trivia` key — the file *is* the trivia config).

**Rationale:** Matches the existing per-plugin-file pattern (`data/plugins/trivia/categories.json`, `users.json`, etc. are flat top-level data). Keeps the file path self-describing without one level of indirection.

**Alternatives considered:**
- `data/plugins/trivia/config/config.json` (nested directory). Rejected — needless directory for one file.
- Keep wrapper key (`{ "trivia": {...} }`). Rejected — redundant given filename.

### Decision 2: `Config['trivia']` removal vs. compatibility shim

**Choice:** Remove `trivia?: TriviaConfig` from `src/config.ts`'s `Config` interface entirely. All current `getConfig().trivia.*` reads are routed through new plugin-scoped accessors (`getTriviaConfig()`, `getTriviaGames()`) exported from `src/plugins/trivia/core/configBridge.ts`.

**Rationale:** A compatibility shim that reads the plugin file inside `loadConfig()` would tie the main loader to the plugin file's existence, blur ownership, and slow boot. Explicitly migrating call sites enforces the new boundary cleanly. The number of call sites is bounded (resolvers, tool injection, scheduled prompts) and `configBridge.ts` already exists as the injection point.

**Alternatives considered:**
- Lazy-populate `Config['trivia']` on first read. Rejected — same ownership-blur problem.
- Keep `Config['trivia']` typed but have `loadConfig()` synchronously read the plugin file. Rejected — boot-order coupling and forces the main loader to know about plugin file layout.

### Decision 3: Boot migration shape

**Choice:** New blocking migration `022-trivia-config-to-plugin.ts` performs (in order):
1. Read `data/config.json`. If `trivia` field is absent, exit (no-op).
2. Read `data/plugins/trivia/config.json` if it exists. If a non-empty object, the migration logs that both sources are populated and EXITS WITHOUT WRITING (operator must reconcile manually — fail-safe).
3. Otherwise, write `data/config.json`'s `trivia` block to `data/plugins/trivia/config.json` (creating the directory if needed).
4. Remove the `trivia` field from `data/config.json` and rewrite that file.
5. Log a single-line confirmation.

**Rationale:** Idempotent (step 1 short-circuits on second run); fail-safe against double-source (step 2); atomic-per-file (step 3 commits before step 4). Step 4 is the "point of no return" — if step 3 fails, `data/config.json` is untouched. If step 4 fails after step 3 succeeded, the plugin file is the new source of truth and a subsequent boot's step 2 will short-circuit; the operator clears the stale `trivia` field from `data/config.json` by hand. (This is an acceptable edge case for a migration that should succeed atomically in practice.)

**Alternatives considered:**
- Move-then-verify-then-delete pattern with a temp marker file. Rejected — added complexity for marginal safety.
- Always copy, never delete. Rejected — two sources of truth indefinitely.

### Decision 4: Three tools, not seven, not one

**Choice:** `upsert_game(name, scheduling fields..., per-game axis fields...)`, `delete_game(name)`, `set_workspace_config({ ...workspace fields... })`.

**Rationale:** Three tools fit the natural concept partition (one game, one game, one workspace). Each tool has a tight, typed schema that helps Claude discover the right arguments. A single generic JSON-path setter would maximize flexibility but minimize accuracy — Claude's pick rate on typed schemas is meaningfully better. Seven tools (one per workspace field) is over-decomposed: `set_workspace_config` already cleanly accepts any subset.

**Alternatives considered:**
- 7 narrower tools (per-axis setters). Rejected — more catalog noise without clearer ergonomics.
- 1 generic setter. Rejected — worst accuracy.

### Decision 5: `upsert_game` handles both create and update

**Choice:** `upsert_game` checks whether the named game exists in the registry. If absent, creates it (requires all scheduling fields). If present, updates it (scheduling fields are omit-to-keep; per-game axis fields use omit-to-keep, explicit `null` to clear).

**Rationale:** Mirrors `upsert_season`'s shape, which is already the established pattern in this codebase. A single create-or-update tool means Claude doesn't have to introspect the registry before each call. The branch is at the tool's implementation layer, not its surface.

### Decision 6: `set_workspace_config` is partial-update with `null`-to-clear

**Choice:** All fields on `set_workspace_config` are optional. Omitting a field means "leave unchanged." Explicit `null` for any cascading axis or for `choices`/`offDays`/`seasons` means "clear/remove the field." Validates each provided value with the same `validate*Map` / `parseTrivia*` functions used at file-load time.

**Rationale:** Identical semantics to `upsert_season`'s `null`-to-clear convention. Single tool call can update any subset of workspace fields atomically. The plugin's tool loads the current config file, applies the patch, validates, and writes back.

### Decision 7: Validation reuses existing parsers

**Choice:** `upsert_game` / `set_workspace_config` validate per axis using `validateAnswersFormatMap`, `validateQuestionTypeMap`, `validateFreeformAnswerShapeMap`, `validateContextsList`, `validateTriviaDifficultyMap`, `parseTriviaChoicesConfig`, `parseOffDays`. Validation errors map to `errorResult(...)` with the validator's own message — Claude gets a precise rejection.

**Rationale:** Single source of validation logic. Already proven at file-load time. Avoids parallel schema drift between the loader and the tools.

### Decision 8: Integration registration

**Choice:** `data/config.json` `mcpServers.trivia_management = { alwaysLoad: false, description: "Manage trivia games (add/remove/configure) and workspace-tier defaults. Admin only." }`. The instruction file is registered eagerly via `sdk.addInstruction("admin", "trivia-management", ...)` for now — every admin session gets it.

**Rationale:** The catalog entry makes `attach_integration("trivia_management")` valid. Eager instruction registration is the smallest-change route until `add-plugin-topic-instructions` lands; after that, this can switch to `sdk.addTopicInstruction("admin", "trivia_management", "tools.md", ...)` for true lazy loading.

**Implication:** Admins technically see the tools in the catalog before any `attach_integration` call. The topic-loaded instruction would *teach* Claude when to use them, but in practice an admin asking about games can use them immediately. We accept this trade-off because the user explicitly chose "instruction-gated only" over actual conditional registration.

### Decision 9: Removing a game preserves its data directory

**Choice:** `delete_game(name)` removes the entry from `config.games[]`. The plugin reconciles cron jobs on next load. The data directory at `data/plugins/trivia/games/<name>/` is left in place.

**Rationale:** Matches the existing "disabled game = frozen archive" semantics. Operators delete the directory by hand when they're certain. The tool documents this in its description.

## Risks / Trade-offs

- [Boot-order coupling] → The plugin config file must be present and readable before any trivia tool runs. Mitigation: the plugin's `load()` reads the file at plugin init; if missing, treat as empty (no games, no overrides) — same semantics as today when `data/config.json` has no `trivia` field.
- [Migration concurrency] → Two clack instances starting simultaneously could both run migration 022. Mitigation: the existing migration runner serializes migrations behind `data/state/migration-version.json`; same protection as every other boot migration.
- [Documentation drift across specs] → Cascade phrasing appears across multiple trivia specs (`trivia-seasons`, `trivia-choice-questions`, etc.). Mitigation: delta specs update each one to the four-tier phrasing.
- [Always-registered tools "leak" before attach] → Admins see the management tools in their catalog without calling `attach_integration("trivia_management")`. Mitigation: documented as a known limitation; the topic-loaded instructions are the discovery surface and the parallel change can flip to true lazy loading later.
- [Validation duplication risk in new tools] → If the tools re-implement validation rather than calling the existing parsers, drift is inevitable. Mitigation: Decision 7 mandates parser reuse.

## Migration Plan

1. Land the change. Boot migration `022-trivia-config-to-plugin.ts` runs on first start. Behavior:
   - Fresh deployment (no `data/config.json.trivia`): no-op.
   - Existing deployment with `data/config.json.trivia` populated: copy to `data/plugins/trivia/config.json`, remove from `data/config.json`.
   - Deployment that already has `data/plugins/trivia/config.json` AND a remaining `data/config.json.trivia` block: log and exit without writing; operator decides which to keep.
2. Plugin reads from the new file going forward. `getConfig().trivia` no longer exists — call sites use `getTriviaConfig()` from `configBridge.ts`.
3. Rollback: revert deploy. Pre-revert deployments will have:
   - `data/plugins/trivia/config.json` populated (orphan from the perspective of pre-change code — silently ignored).
   - `data/config.json.trivia` removed (the trivia plugin will load with empty config on the pre-change code path, breaking trivia until operator manually restores).
   - Rollback should be paired with a manual restore of `data/config.json.trivia` from backup, or a rerun of the migration in reverse.

## Open Questions

- After landing, should we leave the workspace-tier `parseTrivia*` exports in `src/config.ts`, or move them into the trivia plugin module to fully consolidate trivia parsing? Leaning **leave them in `src/config.ts`** for this change to minimize churn; relocation can happen later. Spec deltas refer to function names, not file paths.
- Should `delete_game` confirm-on-disabled (require the game be `enabled: false` first) or allow direct deletion of an enabled game? Leaning **allow direct deletion** — the tool already requires admin and the cron jobs reconcile on next load. The tool description warns about active games.
