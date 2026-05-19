## Context

The trivia plugin's data layer is workspace-global. `data/plugins/trivia/{questions,answers,cheats,seasons}.json` are flat files; every tool reads and writes them in their entirety. The plugin has no concept of "where" a question came from — the cron-scheduled posting writes to the same file no matter which channel hosts the schedule, reactions/DMs/mentions all share the same corpus, and duplicate detection runs against the whole pool.

This works fine for a single deployment running a single trivia game. It fails the moment the operator wants to **test a new feature without polluting production data**: a sandbox question for a draft prompt rewrite shows up in `find_previous_questions` against the live game, a season started in the sandbox blocks the live season's timeline, a leaderboard query mixes test answers with real ones.

The plugin's existing **seasons** feature (`trivia-seasons`) demonstrates that scoping-by-tag works: every record carries an optional `season: string` field, and tools filter on it. But seasons partition the timeline (mutually exclusive, one current at a time); they do not partition by *origin*.

This change adds a second scoping axis — **games** — that partitions by origin. Unlike seasons, multiple games coexist actively. Unlike seasons, games are exposed as explicit tool arguments rather than ambiently resolved from time.

## Goals / Non-Goals

**Goals:**

- Allow multiple independent trivia games to coexist in one workspace (e.g. `main` + `sandbox`).
- Structural isolation — a write to one game cannot accidentally leak into another's reads.
- Backward compatible: existing data ends up under a single `main` game with zero data loss.
- Keep tool surfaces clear: every per-game tool takes a `game: string` arg and validates it.
- Keep the plugin SDK unchanged. No new ambient-context primitive; channel context is not used.
- Soft-delete (disable) preserves history so disabled games' leaderboards remain inspectable.

**Non-Goals:**

- Cross-game queries in v1 (no "search all games" escape hatch on `find_previous_questions`, no merged leaderboard across games). If needed, this is a follow-up; the data structure supports it cheaply.
- Per-game categories. Categories stay global. Same rationale as the user's testing use case: the sandbox should be able to ask questions on any category the workspace already knows.
- Per-game users. `users.json` (including `cheatAttempts`) stays global — a cheater is a cheater regardless of game.
- Auto-creating games from unknown slugs. Slugs must be registered explicitly via `create_game` before any tool will accept them.
- Renaming a game. Slugs are immutable. To "rename", create a new game and disable the old.
- Hard-deleting games. Only `disable_game` / `enable_game`. Manual `rm -rf` is the escape hatch for an operator who really wants the bits gone.

## Decisions

### Decision 1: Per-game directory, not per-row tag

**Choice:** `data/plugins/trivia/games/<slug>/{questions,answers,cheats,seasons}.json` — a directory per game holding its own copies of the per-game files.

**Alternative considered:** flat files at the trivia root with a `game: string` field on every record (mirror the seasons-tagging pattern).

**Rationale:**

- **Isolation is structural rather than filter-based.** With per-row tags, every read needs a `where game = X` filter. Forgetting one filter at a single call site leaks data across games. With per-directory storage, the wrong-game read is physically impossible — you literally open a different file.
- **File sizes stay bounded per game.** The sandbox file stays tiny; the main file grows at the rate of the main game's activity, not the workspace total.
- **Copy and wipe are trivial.** `cp -r games/main games/staging` seeds a new game from real data for testing. `rm -rf games/sandbox` nukes test data without surgery on shared files.
- **Migration is trivial.** Move flat files into `games/main/`; done. No backfill pass over thousands of rows to stamp a `game` field.
- **Cross-game queries (the disadvantage)** are explicitly out of scope. If we ever want them, reading N small files and unioning is cheap — the data is already small per game.

### Decision 2: `game` is a required tool argument, not an ambient resolution

**Choice:** Every per-game tool takes `game: string` as a required Zod arg. Claude passes it explicitly on every call. The plugin SDK is unchanged.

**Alternative considered:** Extend `ClackSdk` with ambient channel context (`getCurrentChannel()`) and resolve channel → game via a `config.trivia.games: { channelId: slug }` mapping. Tools would read the slug from context rather than from args.

**Rationale:**

- The ambient approach requires plumbing channel context through the MCP tool-invocation pipeline. Real engineering effort.
- The explicit-arg approach lets us ship games today without an SDK change. If a future plugin needs ambient context, that's its own change.
- Conceptually, **games are decoupled from channels.** A game might be hosted in one channel today and migrated to another tomorrow; its identity is the slug, not the channel ID. Explicit args reflect this independence.
- Schedule prompts bake the slug into their text (`"game slug: main"`), so scheduled runs pass it transparently. Reactive sessions (DMs, mentions, reactions) have the admin name the game.

### Decision 3: Seasons go per-game

**Choice:** `seasons.json` lives at `games/<slug>/seasons.json`. Each game runs its own independent timeline. All season tools take `game: string`.

**Alternative considered:** Keep `seasons.json` global; games and seasons remain orthogonal axes (rows tagged with both).

**Rationale:**

- The whole point of `sandbox` is to test new features without affecting production. If seasons were global, starting a sandbox season would shift production's "current season" definition. Per-game seasons keep timelines independent.
- Season slug uniqueness now applies per-game (two games can both have `"season-2026-05"`).
- First-enable bootstrap moves from plugin-load to `create_game` time — each new game gets its own starter season when workspace seasons are enabled.
- The workspace-level `config.trivia.seasons.enabled` toggle keeps its global meaning. If seasons are off, no game has any season state.

### Decision 4: Soft-delete (frozen archive), not hard-delete

**Choice:** `disable_game(slug)` marks the registry entry `disabled: true` with a `disabledAt` timestamp. Writes refuse. Reads still work. `enable_game(slug)` reverses it. No `delete_game` tool.

**Alternative considered:** `delete_game(slug)` with a confirmation pattern (return record counts first, require a second call to commit) that hard-deletes the directory.

**Rationale:**

- Disabling preserves history — past leaderboards stay queryable, past questions stay searchable for context. That's the right default for "I'm done running this game" because the next admin will want to see what happened.
- Hard deletion is irreversible and easy to do by accident. An operator who really wants the bits gone can `rm -rf games/<slug>/` manually after disabling — that's a deliberate, non-discoverable path.
- Disabled games are excluded from `list_games` by default (`includeDisabled: false`), so they don't clutter the registry view, but they're never silently dropped.

### Decision 5: Slug format `^[a-z0-9-]+$`, 1–32 chars

**Choice:** Slugs validated against `^[a-z0-9-]+$` with length 1–32. Enforced at `create_game` time. Required to be unique in `games.json`.

**Rationale:**

- Filesystem-safe (becomes a directory name).
- No path-injection risk (no `..`, `/`, `\`, `:`).
- Human-readable.
- Mirrors the season slug convention (which is also kebab-case).
- 32-char cap leaves room for `staging-feature-foo-bar` without encouraging novelistic names.

### Decision 6: Blocking migration moves flat files into `games/main/`

**Choice:** A new boot migration runs on every startup. If it detects legacy flat files at `data/plugins/trivia/{questions,answers,cheats,seasons}.json`, it:

1. Creates `data/plugins/trivia/games/main/`.
2. Moves the four files into it.
3. Writes `data/plugins/trivia/games.json` with `[{ slug: "main", description: "Default game", createdAt: <now> }]`.

The migration is idempotent (no-op when the flat files are already gone or `games.json` already exists with `main`).

**Rationale:**

- Single-game deployments (which is every current deployment) end up in a sensible default state without operator action.
- Migration runs blocking-priority so the plugin never sees a half-migrated tree.
- Idempotency means re-running is safe; matches the existing migration system's contract.
- We don't auto-detect "which channel" the legacy data came from — we don't have that info (channel was never recorded). Operators who ran multi-channel trivia under the old flat-file model can disable `main`, create per-channel games, and accept that the historical data lives in `main` (the heir).

## Risks / Trade-offs

- **[Schedules need re-creation post-upgrade]** → existing cron prompts don't pass a `game` arg because they were created before the arg existed. The migration deliberately does not rewrite schedule prompts (we can't safely rewrite arbitrary natural-language prompts). Mitigation: the upgrade notes direct admins to delete and re-create their trivia schedules via `create_schedules_instructions`, which now asks "which game?" and bakes the slug into the prompt. Until they do, scheduled runs will fail at the first `game`-taking tool call with a clear error.
- **[Tooling surface area grows]** → every tool gains a required arg, and four new tools join the registry. Mitigation: the new tools are admin-gated except `list_games` (member), keeping the casual surface small. The arg addition is mechanical and well-typed; LSP / type errors catch any missed call site at build time.
- **[Cross-game queries become awkward]** → currently `find_previous_questions` searches across all seasons by default; in v1 it cannot search across all games. Mitigation: explicitly out of scope; admins can `list_games` and re-issue the search per game if they really need it. If real demand emerges, add an `includeAllGames: true` arg later — the data structure supports it cheaply.
- **[Disabled games still occupy disk]** → soft-delete preserves data forever. Mitigation: acceptable. The escape hatch (manual `rm -rf`) is documented.
- **[Slug collision between game and season]** → games and seasons both use kebab-case slugs. They live in different namespaces (`games.json` vs each game's `seasons.json`), so they don't collide, but operators could be confused. Mitigation: tool names disambiguate (`create_game` vs `upsert_season`); admin discovery copy explains the model.
- **[`users.json` global writes from per-game tools]** → `save_cheating` lives in a game's context but updates the global `users.json#cheatAttempts`. Two scopes touched per call. Mitigation: the scoped data accessor explicitly composes the per-game write with the global users update; tests cover that both side effects fire.
- **[Per-game seasons multiply state]** → if there are 5 active games and seasons are enabled, there are 5 independent timelines. Each game gets its own first-enable bootstrap (at `create_game` time). Mitigation: that's the desired model. Sandbox games can simply ignore seasons (`config.trivia.seasons.enabled` is workspace-global; admins can set it on without each game using it actively — a game's timeline can just have one long starter season).

## Migration Plan

1. **Add the migration file** scaffold via `/create-migration`. Priority: `blocking`. Logic:
   - Read `data/plugins/trivia/games.json`. If it exists, exit no-op.
   - If `data/plugins/trivia/{questions,answers,cheats,seasons}.json` exist, create `data/plugins/trivia/games/main/`, move them in.
   - Write `data/plugins/trivia/games.json` with `[{ slug: "main", description: "Default game", createdAt: <now>, disabled: false }]`.
   - On fresh installs (no flat files), still write `games.json` with an empty array (or with `main` pre-seeded, depending on the operator's preference — proposal opts for pre-seeded `main` for ergonomic parity).
2. **Update the data layer** (`src/plugins/trivia/data.ts`):
   - Add `loadGames`, `saveGames`, `findGame`, `requireWritableGame(slug)` accessors at the top level.
   - Add `data.forGame(slug)` returning scoped accessors for `loadQuestions`, `saveQuestion`, `updateQuestion`, `loadAnswers`, `saveAnswer`, `loadCheats`, `saveCheat` (composed with global users update), `loadSeasonsState`, `saveSeasonsState`, `getCurrentSeasonSlug`.
   - Keep top-level `loadCategories`/`saveCategories`/`loadUsers`/`saveUser` as global.
3. **Update every existing tool file** (`saveQuestion.ts`, `findPreviousQuestions.ts`, `getIdeas.ts`, `submitAnswers.ts`, `retrieveScores.ts`, `saveCheating.ts`, `getQuestionHistory.ts`, and the four season tools) to add `game: z.string()` to the Zod input schema, resolve it via `data.forGame(slug)`, and route through the scoped accessor.
4. **Add the new registry tool files**: `listGames.ts`, `createGame.ts`, `disableGame.ts`, `enableGame.ts`, plus a small `gamesRegistry.ts` helper.
5. **Register the new tools** in `src/plugins/trivia/index.ts` and update the seasons-bootstrap logic to fire at `create_game` time per game rather than at plugin-load time once.
6. **Rewrite scheduled prompts** in `src/plugins/trivia/scheduledPrompts.ts` to ask for a game slug in `create_schedules_instructions`, validate it against the registry, and bake it into both schedule prompt strings (and into every tool-call step within those prompts).
7. **Update `triviaCheckInstruction`** to mention `list_games` / `create_game` / `disable_game` / `enable_game` and the per-game scoping model.
8. **Operator runbook (in upgrade notes)**: after deploying, run the migration boot, verify `games.json` lists `main`, then delete and re-create any existing trivia schedules so their prompts include the game slug.

**Rollback strategy:** the migration is non-destructive in spirit — files are moved, not transformed. A manual rollback is: stop the bot, move `games/main/{questions,answers,cheats,seasons}.json` back to the trivia root, delete `games.json` and `games/`, then redeploy the prior version. Documented but not automated.

## Open Questions

- Should `list_games` include question/answer counts per game? Useful for the admin Home Tab. Easy to add but adds I/O — every `list_games` call would open each game's `questions.json` and `answers.json`. **Default for v1: no counts.** Add later if the Home Tab grows a games view.
- Should `create_game` accept an optional `cloneFrom: <slug>` arg to seed the new game with data copied from an existing game? Strong use case for testing ("clone `main` into `staging-feature-X`"). **Default for v1: no.** Operators can `cp -r` manually. Revisit if the testing workflow demands it.
- Should there be a deployment-level "default game" that reactive (non-scheduled) sessions use when the user doesn't specify? Risks accidental writes to the wrong game. **Default for v1: no default — Claude refuses or asks.**
