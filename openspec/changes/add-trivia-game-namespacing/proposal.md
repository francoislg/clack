## Why

The trivia plugin's data is workspace-global today: every question, answer, cheat report, and season is mixed into the same flat files (`data/plugins/trivia/{questions,answers,cheats,seasons}.json`). That makes it impossible to test new trivia features (a different question-type mix, a fresh season, an experimental prompt rewrite) without polluting the main game's question history, leaderboard, and duplicate-detection corpus. Adding a "games" namespace — one per Slack channel that hosts a trivia run — gives admins a structurally isolated sandbox: a `sandbox` game can run alongside `main` with completely separate questions, answers, cheats, and season timelines, and you can copy one game's data into another or wipe a game without touching the rest.

## What Changes

- Introduce a **game registry** at `data/plugins/trivia/games.json` — an array of `{ slug, description?, createdAt, disabled?, disabledAt? }` records. Slugs satisfy `^[a-z0-9-]+$` (1–32 chars) and are unique.
- Move per-game data into `data/plugins/trivia/games/<slug>/{questions,answers,cheats,seasons}.json`. Categories (`categories.json`) and users (`users.json`) stay global at the trivia root.
- Every existing trivia tool gains a **required `game: string` argument** — `get_ideas`, `save_question`, `find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, `save_cheating`. Season tools (`check_season_status`, `upsert_season`, `delete_season`, `list_seasons`) likewise gain `game`. The slug is validated against `games.json` on every call; unknown or disabled-for-write slugs return a structured error.
- Add four new registry tools:
  - `list_games(includeDisabled?: boolean = false)` — member role; returns the registry. Disabled games are excluded by default.
  - `create_game(slug, description?)` — admin role; appends to `games.json`, creates `games/<slug>/` with empty data files, and (when `trivia.seasons.enabled`) seeds a starter season in `games/<slug>/seasons.json`.
  - `disable_game(slug)` — admin role; marks the entry `disabled: true` with a `disabledAt` timestamp. Writes refuse for this game; reads still work (frozen-archive semantics).
  - `enable_game(slug)` — admin role; clears the disabled flag.
- **Seasons become per-game.** `seasons.json` lives at `games/<slug>/seasons.json`. Each game runs its own independent timeline. The workspace-level `config.trivia.seasons.enabled` toggle still gates the feature, but when on, each game's seasons are managed separately. Slug uniqueness, no-overlap, and back-to-back invariants are enforced per-game.
- **Scheduled prompts learn about games.** `create_schedules_instructions` asks the admin "which game does this schedule belong to?" and bakes `"game slug: <slug>"` into both the question-posting and answer-reveal prompt templates. The dispatched schedules pass the slug to every trivia tool call.
- **Leaderboards are per-game.** `retrieve_scores` and the reveal-flow leaderboard ("Current Season + All Time") both operate within the game scope. "All Time" means all time within this game.
- **Duplicate detection is per-game.** `find_previous_questions` only searches the named game. The same question can exist independently in `main` and `sandbox`.
- **Cheats are per-game, but cheat tallies are global.** `save_cheating` writes a `CheatReport` into `games/<slug>/cheats.json`, but the `users.json#cheatAttempts` counter is cumulative across all games (a cheater is a cheater regardless of game).
- **Migration (blocking).** A new boot migration moves any pre-existing flat `questions.json`, `answers.json`, `cheats.json`, `seasons.json` into `games/main/`, and seeds `games.json` with a single entry `{ slug: "main", description: "Default game", createdAt: <now> }`. The migration is idempotent and is a no-op on fresh installs or already-migrated deployments.
- **Admin-discovery copy update.** `triviaCheckInstruction` mentions the games registry and the `list_games` / `create_game` tools so admins can discover the feature without reading docs.

## Capabilities

### New Capabilities

- `trivia-games`: the games registry (`games.json` schema, slug format), per-game directory layout (`games/<slug>/{questions,answers,cheats,seasons}.json`), `list_games` / `create_game` / `disable_game` / `enable_game` tools, soft-delete semantics (frozen reads + write refusal), the universal "every trivia tool requires a `game` slug; unknown slug → error; disabled slug → write-refuse" invariant, and the blocking flat-files-to-`games/main/` migration.

### Modified Capabilities

- `trivia-question-search`: `save_question`, `find_previous_questions`, and `get_question_history` gain required `game: string`. Each tool resolves the slug, then operates only on `games/<slug>/questions.json`. Duplicate-detection and history lookups are strictly per-game (no cross-game search in v1).
- `trivia-batch-answers`: `submit_answers` gains required `game: string`. Reads the target question from `games/<slug>/questions.json` and writes answer records to `games/<slug>/answers.json`. Per-user `totalCorrect`/`totalAnswered`/`currentStreak` are computed over the named game's answers only.
- `trivia-cheating-detection`: `save_cheating` gains required `game: string`. The `CheatReport` is appended to `games/<slug>/cheats.json`; the `users.json#cheatAttempts` increment is global (workspace-wide cumulative).
- `trivia-seasons`: `seasons.json` becomes per-game (`games/<slug>/seasons.json`). All season tools (`check_season_status`, `upsert_season`, `delete_season`, `list_seasons`) gain required `game: string` and operate within that game's timeline. First-enable bootstrap moves from "plugin load" to "`create_game` time" — each new game gets its own starter season when workspace seasons are enabled. The "current season + all time" leaderboard's "all time" axis is per-game.
- `trivia-scheduled-prompts`: `create_schedules_instructions` asks the admin which game the schedules belong to, validates the slug against the registry, and bakes the slug into both schedule prompts. The question-posting and answer-reveal flows both reference the slug on every tool call. `retrieve_scores` (if covered here) gains `game`.
- `trivia-categories`: unchanged in storage (categories remain global at `categories.json`), but the `add_categories` / `remove_categories` / `get_ideas` tools that already exist now read the active category list independently of any game scope. (No requirement changes — listed here only because the per-game model could plausibly affect category resolution, but it doesn't.)

## Impact

- **Code**: `src/plugins/trivia/` — `types.ts` (add `Game`, `GamesRegistry` types; rename data accessors), `data.ts` (introduce scoped `data.forGame(slug)` accessor returning `{ loadQuestions, saveQuestion, updateQuestion, loadAnswers, saveAnswer, loadCheats, saveCheat (composed with global users update), loadSeasonsState, saveSeasonsState }`; keep top-level `loadCategories`/`saveCategories`/`loadUsers`/`saveUser` as global), `index.ts` (register new game-registry tools, gate all per-game tools' invocation through registry-validation), plus per-tool changes to add the `game` arg and route through `data.forGame(slug)`. New files: `gamesRegistry.ts`, `createGame.ts`, `disableGame.ts`, `enableGame.ts`, `listGames.ts`. Updated: every existing `*.ts` tool file.
- **Migration**: new blocking migration in `src/migrations/` that detects legacy flat files, creates `games/main/`, moves the files, and seeds `games.json`. Scaffold via `/create-migration`.
- **Data files**: legacy flat files at `data/plugins/trivia/` are moved into `data/plugins/trivia/games/main/` by the migration. `data/plugins/trivia/games.json` is new. `categories.json` and `users.json` are unchanged in location and shape.
- **Config**: no new config keys. `config.trivia.seasons.enabled` retains its workspace-level meaning.
- **Tests**: registry CRUD (create, disable, enable, list with/without disabled), slug validation, per-game data isolation (writes to A don't appear in B's reads), disabled-game write refusal + read passthrough, season-per-game timeline (two games with overlapping season-slug names is permitted), `submit_answers` cross-game rejection (`game` arg's slug doesn't match the question's stored game — though since questions are filed under the game directory, this is essentially "questionId not found in that game"), migration idempotency.
- **Dependencies**: no new packages.
- **Backward compatibility**: post-migration, all historical data lives in the `main` game. Existing schedules continue working only after the admin re-runs `create_schedules_instructions` (or manually edits their prompts to include the slug); the migration **does not rewrite existing schedule prompts** — admins re-create schedules to pick up the slug-passing flow. Document this as a one-time post-upgrade step.
