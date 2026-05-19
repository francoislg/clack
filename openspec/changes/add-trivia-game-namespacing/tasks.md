## 1. Types & registry primitives

- [ ] 1.1 Add `Game` and `GamesRegistry` types to `src/plugins/trivia/types.ts` — `Game = { slug, description?, createdAt, disabled, disabledAt? }`, `GamesRegistry = Game[]`. Update `TriviaDataLayer` to expose the new accessors documented in tasks 1.3–1.5.
- [ ] 1.2 Add a slug-validation helper (`src/plugins/trivia/gameSlug.ts`) with `isValidSlug(s): boolean` matching `^[a-z0-9-]+$` length 1–32, plus a `validateSlug(s): void` that throws structured errors with `code` (`"invalid_format"`, `"too_long"`). Unit-test format edge cases (uppercase, whitespace, empty, `..`, `/`, `\`, 32 vs 33 chars).
- [ ] 1.3 Add `loadGames` and `saveGames` to `createSdkDataLayer` in `src/plugins/trivia/data.ts` — read/write `games.json` at the trivia root.
- [ ] 1.4 Add registry resolver helpers in a new `src/plugins/trivia/gamesRegistry.ts` — `findGame(registry, slug)`, `requireGame(registry, slug)` (throws `unknown_game`), `requireWritableGame(registry, slug)` (throws `unknown_game` or `game_disabled`).
- [ ] 1.5 Add the `data.forGame(slug)` scoped accessor in `data.ts` returning `{ loadQuestions, saveQuestion, updateQuestion, loadAnswers, saveAnswer, loadCheats, saveCheat (composes global users update), loadSeasonsState, saveSeasonsState, getCurrentSeasonSlug }`. All I/O paths resolve to `data/plugins/trivia/games/<slug>/<file>.json`. Keep `loadCategories`/`saveCategories`/`loadUsers`/`saveUser` as global top-level accessors.
- [ ] 1.6 Add unit tests for `forGame(slug)` — writes go to the correct directory, reads see only that game's data, two games' writes don't cross-contaminate.

## 2. Boot migration

- [ ] 2.1 Scaffold a new blocking boot migration via `/create-migration` (call it `006-trivia-games-directory-layout` or whatever the next number is). Priority: `blocking`.
- [ ] 2.2 Implement the migration logic in the new file:
  - Check whether `data/plugins/trivia/games.json` exists; if yes, no-op return.
  - Otherwise create `data/plugins/trivia/games/main/` directory.
  - Move any existing `data/plugins/trivia/{questions,answers,cheats,seasons}.json` into `games/main/` (using fs.rename; do not transform content).
  - On fresh installs (no flat files), write empty `games/main/questions.json: []` and `games/main/answers.json: []`.
  - Write `data/plugins/trivia/games.json` with `[{ slug: "main", description: "Default game", createdAt: Date.now(), disabled: false }]`.
- [ ] 2.3 Add migration test cases (per `/create-migration` test runner): populated deployment (flat files present), fresh deployment (no flat files), already-migrated (idempotent re-run no-op), partial flat files (e.g. `questions.json` exists but `seasons.json` doesn't).
- [ ] 2.4 Register the migration in the migration runner (the `/create-migration` skill should handle this; verify it does).

## 3. New registry tool: list_games

- [ ] 3.1 Create `src/plugins/trivia/listGames.ts` exposing `createListGamesTool(data)`. Zod input: `{ includeDisabled?: boolean }` defaulting to `false`. Reads `games.json`, filters disabled when applicable, returns `{ games: [...], total: number }`.
- [ ] 3.2 Register `list_games` in `src/plugins/trivia/index.ts` at the `member` role with label `"Listing trivia games"`.
- [ ] 3.3 Add `listGames.test.ts` — empty registry, mixed enabled/disabled with default filter, mixed with `includeDisabled: true`, ordering preserved.

## 4. New registry tool: create_game

- [ ] 4.1 Create `src/plugins/trivia/createGame.ts` exposing `createCreateGameTool(data)`. Zod input: `{ slug: string, description?: string }`. Validates slug via the helper from task 1.2; rejects duplicates against the current registry; appends to `games.json`; creates `data/plugins/trivia/games/<slug>/` with empty seed files (`questions.json: []`, `answers.json: []`). When `trivia.seasons.enabled`, also seeds `seasons.json` with one starter entry (slug `season-YYYY-MM`, `startedAt: now`, `expectedEndAt: end-of-current-UTC-month`, `categories: copy of global categories.json`).
- [ ] 4.2 Register `create_game` in `index.ts` at the `admin` role with label `"Creating trivia game — {slug}"`.
- [ ] 4.3 Add `createGame.test.ts` — happy path with seasons disabled, happy path with seasons enabled (verifies seasons.json bootstrap), duplicate-slug rejection, invalid-slug rejection (uppercase, whitespace, too long, path-traversal chars), description-omitted path.

## 5. New registry tools: disable_game / enable_game

- [ ] 5.1 Create `src/plugins/trivia/disableGame.ts` exposing `createDisableGameTool(data)`. Zod input: `{ slug: string }`. Sets `disabled: true, disabledAt: now` on the registry entry; rejects unknown slugs and already-disabled games.
- [ ] 5.2 Create `src/plugins/trivia/enableGame.ts` exposing `createEnableGameTool(data)`. Zod input: `{ slug: string }`. Clears `disabled` (sets to `false`) and removes `disabledAt`; rejects unknown slugs and already-enabled games.
- [ ] 5.3 Register both tools in `index.ts` at the `admin` role with labels `"Disabling trivia game — {slug}"` / `"Enabling trivia game — {slug}"`.
- [ ] 5.4 Add `disableGame.test.ts` and `enableGame.test.ts` — happy path, unknown slug, already-disabled / already-enabled rejection, round-trip (disable then enable restores the entry without `disabledAt`).

## 6. Add required `game` arg to existing per-game tools

- [ ] 6.1 Extend `src/plugins/trivia/saveQuestion.ts` Zod input with `game: z.string()`. At call time, validate via `requireWritableGame(registry, slug)`. Route writes through `data.forGame(slug).saveQuestion(...)`. Category validation reads from the named game's current season's `categories` (when seasons enabled) or the global `categories.json`.
- [ ] 6.2 Extend `src/plugins/trivia/findPreviousQuestions.ts` similarly — `game: z.string()`, validate via `requireGame` (read-only, disabled games allowed), route reads through `data.forGame(slug).loadQuestions()`. Update season-filter logic to read the named game's `seasons.json` via `data.forGame(slug).loadSeasonsState()`.
- [ ] 6.3 Extend `src/plugins/trivia/getIdeas.ts` similarly — `game: z.string()`, validate via `requireGame`. Read recent-categories exclusion from the named game's `questions.json` only.
- [ ] 6.4 Extend `src/plugins/trivia/getQuestionHistory.ts` similarly — `game: z.string()`, validate via `requireGame`. Look up the question in the named game's `questions.json`; load cheats from the named game's `cheats.json`; load answers from the named game's `answers.json`; `displayName` from the global `users.json`.
- [ ] 6.5 Extend `src/plugins/trivia/submitAnswers.ts` similarly — `game: z.string()`, validate via `requireWritableGame`. Look up question in the named game; append answers to the named game's `answers.json`; auto-register user globally; stamp `postedAt`/`messageLink` on the question record in the named game; compute per-user stats over the named game's `answers.json` only.
- [ ] 6.6 Extend `src/plugins/trivia/retrieveScores.ts` similarly — `game: z.string()`, validate via `requireGame` (read-only). Group leaderboard from the named game's `answers.json` only. Resolve current/all season filter from the named game's `seasons.json`.
- [ ] 6.7 Extend `src/plugins/trivia/saveCheating.ts` similarly — `game: z.string()`, validate via `requireWritableGame`. Append the cheat to the named game's `cheats.json`; increment the global `users.json#cheatAttempts`.
- [ ] 6.8 Update each per-game tool's label template in `index.ts` to interpolate `{game}` so Slack task cards show which game is being touched (e.g. `"Saving trivia question — {game}/{category}"`).
- [ ] 6.9 Update each existing test file (`saveQuestion.test.ts`, `findPreviousQuestions.test.ts`, `getIdeas.test.ts`, `getQuestionHistory.test.ts`, `submitAnswers.test.ts`, `retrieveScores.test.ts`, `saveCheating.test.ts` if any) — every test now passes `game: "main"` (or a fixture slug), plus add cross-game isolation tests where relevant (write to `main`, assert not visible in `sandbox`).

## 7. Add required `game` arg to season tools

- [ ] 7.1 Extend `src/plugins/trivia/checkSeasonStatus.ts` Zod input with `game: z.string()`. Validate via `requireGame` (read-only). Resolve current/next from `data.forGame(slug).loadSeasonsState()`.
- [ ] 7.2 Extend `src/plugins/trivia/upsertSeason.ts` similarly — `game: z.string()`, validate via `requireWritableGame`. Operate on `data.forGame(slug).loadSeasonsState()` / `saveSeasonsState()`. No-overlap and slug-uniqueness invariants are enforced *per game* (same slug allowed across different games).
- [ ] 7.3 Extend `src/plugins/trivia/deleteSeason.ts` similarly — `game: z.string()`, `requireWritableGame`.
- [ ] 7.4 Extend `src/plugins/trivia/listSeasons.ts` similarly — `game: z.string()`, `requireGame`. Response includes `game` field.
- [ ] 7.5 Update the seasons-bootstrap path: remove the plugin-load-time bootstrap from `index.ts`. Bootstrap now fires inside `create_game` when `trivia.seasons.enabled` is true.
- [ ] 7.6 Update `findCurrentSeason` and its helpers in `data.ts` to take a `SeasonsState | null` argument (they already do); no signature change needed, but ensure all call sites are routed via `data.forGame(slug)`.
- [ ] 7.7 Update `seasons.test.ts` — every test passes `game: "main"`; add cross-game tests (same slug in two games is OK, no-overlap is per-game).

## 8. Scheduled-prompt rewrites

- [ ] 8.1 Update `src/plugins/trivia/sendQuestionsInstructions.ts` (and the underlying constants in `scheduledPrompts.ts`) to accept `game: z.string()` and produce a prompt that:
  - States the active game slug near the top.
  - Rewrites every tool-call step (`get_ideas`, `find_previous_questions`, `save_question`) to pass `game: "<slug>"` literally.
- [ ] 8.2 Update `src/plugins/trivia/processResponsesInstructions.ts` similarly — `game: z.string()`, rewrites every per-game tool call (`find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, `check_season_status`, `upsert_season`) to pass `game: "<slug>"`.
- [ ] 8.3 Update `src/plugins/trivia/createSchedulesInstructions.ts` so its returned recipe asks the admin for a game slug, calls `list_games` to surface options (excluding disabled games), validates the slug, and bakes the slug into both schedule prompts as `"Game slug: <slug>. Call <tool>(game: \"<slug>\") and follow the returned instructions exactly."`.
- [ ] 8.4 Update `scheduledPrompts.test.ts` — every test passes `game: "main"`; add a test that asserts the slug appears in every tool-call step of both returned prompts; add a test for the create-schedules recipe that asserts it asks for a game slug and excludes disabled games.

## 9. Plugin index wiring

- [ ] 9.1 In `src/plugins/trivia/index.ts`:
  - Remove the inline seasons bootstrap (now lives in `create_game`).
  - Register the four new registry tools (`list_games`, `create_game`, `disable_game`, `enable_game`).
  - Verify every existing per-game tool's `registerTool` call uses the updated label template.
  - When `trivia.seasons.enabled`, register the four season tools as before but with updated descriptions/labels reflecting the new `game` arg.
- [ ] 9.2 Update `triviaCheckInstruction.ts` (and its generated content) to mention `list_games` / `create_game` / `disable_game` / `enable_game` and the per-game scoping model. When seasons are enabled, reference `(game, slug)` signatures for the season tools.
- [ ] 9.3 Audit `src/plugins/trivia/seedCategories.ts` — categories stay global; no changes expected, but confirm.

## 10. Type-check, lint, and integration

- [ ] 10.1 Run `npx tsc` (or `npm run build`) to surface every call site where the `game` arg was forgotten. Fix each until the build is clean.
- [ ] 10.2 Run `npx oxlint src/plugins/trivia/ src/migrations/`. Fix any new lints introduced.
- [ ] 10.3 Run `npm test` and ensure every trivia test file passes. Add any missed coverage flagged in the spec deltas (cross-game isolation, disabled-game refusal, slug format edge cases, migration idempotency).
- [ ] 10.4 Run a smoke test by hand: start the bot locally on a copy of `data/`, verify the migration produces the expected directory structure, exercise the registry tools via a DM session (or unit-tested CLI harness), and exercise both query-mode and a scheduled run on the `main` game. Document any gotchas in the change's design.md "Risks" section (if any surface).

## 11. Operator-facing release notes

- [ ] 11.1 Write a short release note (in CHANGELOG or in `docs/upgrade/` if such a thing exists in this repo — otherwise leave in the PR description) summarizing:
  - The migration runs automatically; no operator action needed for data.
  - Existing trivia cron schedules **must be deleted and re-created** via `create_schedules_instructions`; legacy schedules will fail at the first per-game tool call after the upgrade because they don't pass `game`.
  - Admins gain `list_games` / `create_game` / `disable_game` / `enable_game` and should use them via the Home Tab or DM to create additional games (sandbox / staging).
  - No config changes required. `config.trivia.seasons.enabled` retains its meaning.
