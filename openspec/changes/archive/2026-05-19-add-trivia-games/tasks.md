## 1. Foundation (already on disk)

- [x] 1.1 Add `TriviaGame` interface to `src/config.ts` — `{ name, channel, questionCron, revealCron, timezone }`
- [x] 1.2 Add `parseTriviaGames` to `src/config.ts` — validates each entry, drops invalid ones with logged warnings (covers non-object, missing/non-string name, duplicate name, invalid channel/cron/timezone)
- [x] 1.3 Wire `config.trivia.games[]` parsing into the top-level config loader
- [x] 1.4 Create `src/plugins/trivia/buildGameSpecs.ts` — produces `CronJobSpec[]` from `config.trivia.games[]`; emits warning when revealCron fires before questionCron
- [x] 1.5 Wire `sdk.reconcileCronJobs("trivia", specs)` into `triviaPlugin` (replaces the previous user-driven `create_schedules_instructions` setup recipe)
- [x] 1.6 Migration `019-trivia-games-migration` — detect dispatcher-style legacy trivia cron jobs, pair by channel, append `legacy-<channel>` entries to `config.trivia.games[]`, delete source jobs
- [x] 1.7 Migration 019 test cases
- [x] 1.8 Delete `createSchedulesInstructions.ts`, `processResponsesInstructions.ts`, `sendQuestionsInstructions.ts` (instruction tools superseded by `buildGameSpecs`)

## 2. Repair `index.ts` after deleted files

- [x] 2.1 Remove broken imports for the three deleted instruction-tool files from `src/plugins/trivia/index.ts`. Remove the corresponding `sdk.registerTool` calls. Verify `npx tsc` is clean for `index.ts`. _(Already done in the working tree.)_

## 3. Name format validation

- [ ] 3.1 Add `^[a-z0-9-]+$` length 1–32 validation to `parseTriviaGames` in `src/config.ts`. Existing rejections (duplicate, invalid channel/cron/timezone) preserved. Invalid format → drop entry + log warning identifying index and value.
- [ ] 3.2 Update or add `parseTriviaGames` tests in `src/config.test.ts` covering: valid kebab-case, uppercase rejected, whitespace rejected, length 0 / length 33 rejected, path-traversal `..`/`/`/`\\` rejected.

## 4. `enabled: false` flag

- [ ] 4.1 Extend `TriviaGame` interface in `src/config.ts` with optional `enabled?: boolean`.
- [ ] 4.2 Update `parseTriviaGames` to accept optional `enabled`; default to `true` when absent; drop entry with warning when `enabled` is present but non-boolean.
- [ ] 4.3 Update `buildGameSpecs` to skip entries with `enabled === false` (no cron specs reconciled for them).
- [ ] 4.4 Add tests: `enabled: false` entry produces zero specs from `buildGameSpecs`; `enabled` defaults to true; non-boolean `enabled` is rejected by parser.

## 5. Games-registry helper module

- [ ] 5.1 Create `src/plugins/trivia/gameName.ts` — exposes `isValidName(s): boolean`. (The format check is encoded in the parser; this helper is for runtime tool validation when a tool receives a `game` arg.)
- [ ] 5.2 Create `src/plugins/trivia/gamesRegistry.ts` — exposes `findGame(games, name): TriviaGame | null`, `requireGame(games, name): TriviaGame` (throws structured `unknown_game`), `requireWritableGame(games, name): TriviaGame` (throws `unknown_game` or `game_disabled`), `resolveGameFromChannel(games, channelId): string | null` (returns the `name` of the entry whose `channel` matches; ignores disabled entries).
- [ ] 5.3 Unit tests for `gamesRegistry.ts` — happy paths, unknown-game, disabled-game, channel-inference (configured / unconfigured / disabled).

## 6. Per-game data accessor

- [ ] 6.1 Add `forGame(name: string)` to `TriviaDataLayer` and `createSdkDataLayer` in `src/plugins/trivia/data.ts`. Returns scoped accessors: `loadQuestions`, `saveQuestion`, `updateQuestion`, `loadAnswers`, `saveAnswer`, `loadCheats`, `saveCheat` (composes with the global users update), `loadSeasonsState`, `saveSeasonsState`, `getCurrentSeasonSlug`. All I/O paths resolve to `data/plugins/trivia/games/<name>/<file>.json`.
- [ ] 6.2 Implement **lazy season-bootstrap** inside `forGame(name).loadSeasonsState()`: when `trivia.seasons.enabled` is `true` and `games/<name>/seasons.json` is missing, seed a starter season (slug `season-YYYY-MM`, `startedAt: now`, `expectedEndAt: end-of-current-UTC-month`, `categories: copy of global categories.json`) before returning.
- [ ] 6.3 Keep top-level `loadCategories`/`saveCategories`/`loadUsers`/`saveUser` as global (unchanged).
- [ ] 6.4 Unit tests for `forGame` — writes go to the correct directory; reads see only that game's data; cross-game writes don't contaminate; lazy season-bootstrap fires on first `loadSeasonsState`.

## 7. Data-move via migration 019 (merged)

- [x] 7.1 Extend the pre-existing `019-trivia-games-migration` to also move legacy flat data into a per-game directory. The data-move step runs AFTER the cron-jobs → `config.trivia.games[]` step so newly-created `legacy-<channel>` entries are eligible inheritance targets.
- [x] 7.2 Implement the inheritance order in the migration:
  - If flat files are absent OR per-game files already exist under `games/<fallback>/`, the data-move step is a no-op.
  - Otherwise the target is the first newly-created `legacy-<channel>` from step 1, else the first pre-existing `config.trivia.games[]` entry, else a fallback `initialgame` entry (`channel: "C000000000"`, `questionCron: "0 0 * * 0"`, `revealCron: "0 0 * * 0"`, `timezone: "UTC"`, `enabled: false`).
- [x] 7.3 Extend `019-trivia-games-migration.test.ts` with cases: fresh deployment writes nothing; flat data + dispatcher schedule lands in `legacy-<channel>`; flat data + pre-existing config game lands in first existing entry; flat data with no schedule + no config game creates the fallback `initialgame`; multi-channel dispatcher lands data in the first new entry; idempotency on the data-move step; dispatcher-only with no flat data writes no per-game files.
- [x] 7.4 No new migration registration needed — 019 is already in the runner.

## 8. `list_games` tool

- [ ] 8.1 Create `src/plugins/trivia/listGames.ts` exposing `createListGamesTool()`. Zod input: `{ includeDisabled?: boolean }` defaulting to `false`. Reads `config.trivia.games[]`, filters disabled when applicable, returns `{ games: [{ name, channel, timezone, enabled }], total }`.
- [ ] 8.2 Register `list_games` in `src/plugins/trivia/index.ts` at the `member` role with label `"Listing trivia games"`.
- [ ] 8.3 Tests — empty config, mixed enabled/disabled with default filter, with `includeDisabled: true`, order preserved.

## 9. Add required `game` arg to existing per-game tools

For each tool: extend the Zod input with `game: z.string()`; at call time, load `config.trivia.games[]`, validate via `requireGame` (read tools) or `requireWritableGame` (write tools); route per-game I/O through `data.forGame(name)`; update label template to interpolate `{game}`; update tests to pass `game: "main"` (or a fixture) plus add cross-game isolation regression coverage.

- [ ] 9.1 `src/plugins/trivia/saveQuestion.ts` — write tool. Category validation reads from the named game's current season's `categories` when seasons enabled (via `data.forGame(name).loadSeasonsState()`) or the global `categories.json`.
- [ ] 9.2 `src/plugins/trivia/findPreviousQuestions.ts` — read tool.
- [ ] 9.3 `src/plugins/trivia/getIdeas.ts` — read tool. Recent-categories exclusion from the named game's `questions.json` only.
- [ ] 9.4 `src/plugins/trivia/getQuestionHistory.ts` — read tool. Look up question/cheats/answers in the named game; `displayName` from global `users.json`.
- [ ] 9.5 `src/plugins/trivia/submitAnswers.ts` — write tool. Append answers to the named game; auto-register user globally; stamp `postedAt`/`messageLink` on the question record in the named game.
- [ ] 9.6 `src/plugins/trivia/retrieveScores.ts` — read tool. Leaderboard from the named game only.
- [ ] 9.7 `src/plugins/trivia/saveCheating.ts` — write tool. Append cheat to the named game; increment global `users.json#cheatAttempts`.
- [ ] 9.8 Update each existing test file to thread `game: "main"` (or fixture) through every call. Add cross-game isolation regression tests on at least `saveQuestion` and `submitAnswers`.

## 10. Add required `game` arg to season tools

- [ ] 10.1 `src/plugins/trivia/checkSeasonStatus.ts` — read tool.
- [ ] 10.2 `src/plugins/trivia/upsertSeason.ts` — write tool. Per-game invariants: slug uniqueness within the named game, no-overlap within the named game.
- [ ] 10.3 `src/plugins/trivia/deleteSeason.ts` — write tool.
- [ ] 10.4 `src/plugins/trivia/listSeasons.ts` — read tool. Response includes `game` field.
- [ ] 10.5 Remove the plugin-load seasons bootstrap from `index.ts` (lazy bootstrap in `data.forGame(name)` replaces it).
- [ ] 10.6 Update `seasons.test.ts` — every test passes `game: "main"`; add cross-game tests (same slug across games is OK; per-game no-overlap).

## 11. Add `game` arg to category-management tools

- [ ] 11.1 If `add_categories` / `remove_categories` interact with per-game season data, extend them to take `game: string` for the season-targeting path. (Categories themselves stay global; only the per-season override on a specific game's `seasons.json` needs the `game` arg.) Verify the existing tool implementations and update Zod accordingly.
- [ ] 11.2 Update the corresponding tests.

## 12. Scheduled-prompt rewrites

- [ ] 12.1 Update `src/plugins/trivia/scheduledPrompts.ts`:
  - Add a `Game: {game}` header line at the top of the question-posting prompt template.
  - Replace every tool-call step (`get_ideas`, `find_previous_questions`, `save_question`) with the form `get_ideas(game: "{game}")` etc.
  - Add a `Game: {game}` header line at the top of the reveal prompt template.
  - Replace every tool-call step (`find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, `check_season_status`, `upsert_season`) with `(game: "{game}")` form.
- [ ] 12.2 Update `src/plugins/trivia/buildGameSpecs.ts` to substitute `{game}` placeholders with each spec's `name` before assigning to `CronJobSpec.prompt`. Both `SEND_QUESTIONS_INSTRUCTIONS` (question spec) and `getProcessResponsesInstructions(seasonsEnabled)` (reveal spec) need substitution.
- [ ] 12.3 Update `scheduledPrompts.test.ts`, `scheduledPrompts.choice.test.ts`: assert that the substituted prompt contains `game: "<name>"` at every tool-call step, the `Game: <name>` header is present, and the substitution is per-game-isolated.

## 13. `triviaCheckInstruction` update

- [ ] 13.1 Update `src/plugins/trivia/triviaCheckInstruction.ts` so the rendered instruction:
  - Mentions `list_games` and the per-game scoping model.
  - Directs Claude that in reactive sessions, the game is resolved from the channel (via `resolveGameFromChannel` semantically — Claude checks `config.trivia.games[]` whose `channel` matches the session's channel).
  - States that the `game` slug is internal — Claude SHALL NOT surface it to end-users.
  - When `seasons.enabled` is `true`, references `upsert_season(game, ...)`, `delete_season(game, slug)`, `list_seasons(game)`, `add_categories({ game, target: "<slug>" })`, `remove_categories({ game, target: "<slug>" })`, and the independence-of-timelines rule.
- [ ] 13.2 Update the triviaCheck test (if any) to assert the new content; verify the resolved instruction does NOT mention games when `seasons.enabled` is false in the per-section toggles.

## 14. Plugin index wiring

- [ ] 14.1 In `src/plugins/trivia/index.ts`:
  - Register `list_games`.
  - Remove the plugin-load seasons bootstrap (now lazy per-game via `data.forGame(name)`).
  - Verify every per-game tool's `registerTool` call uses the updated label template (with `{game}`).
  - When `trivia.seasons.enabled`, register the four season tools as before but with updated descriptions/labels.
- [ ] 14.2 Verify `buildGameSpecs(games, seasonsEnabled)` is invoked once per plugin load and that `sdk.reconcileCronJobs("trivia", specs)` receives a spec list whose disabled games are filtered out.

## 15. Type-check, lint, tests

- [ ] 15.1 Run `npx tsc` and resolve every type error. Focus on call sites where `game` was forgotten.
- [ ] 15.2 Run `npx oxlint src/plugins/trivia/ src/migrations/`. Fix new lints.
- [ ] 15.3 Run `npm test` and ensure every trivia test file passes. Add any missed coverage (cross-game isolation, disabled-game refusal, lazy season-bootstrap, migration 019 data-move idempotency).

## 16. Operator-facing release notes

- [ ] 16.1 Write a short release note summarizing:
  - Migration 019 runs automatically. Single-channel deployments with an existing dispatcher schedule end up with a `legacy-<channel>` entry containing both the schedule (from step 1) and the legacy data (from step 2's inheritance).
  - Deployments with legacy flat data but no schedule get a fallback `initialgame` entry with placeholder crons + `enabled: false`. To resume scheduled trivia for the migrated game, edit `config.trivia.games[]`: replace `channel` with the real Slack channel ID, replace `questionCron` / `revealCron` / `timezone`, and set `enabled: true`.
  - Multi-channel deployments end up with one `legacy-<channel>` per dispatcher pair and all legacy data concentrated in the first entry; redistribute by moving files between `data/plugins/trivia/games/<name>/` directories if needed.
  - Admins create / disable additional games by editing `config.trivia.games[]` directly. The plugin reconciles cron jobs automatically.
  - Members can call `list_games` to introspect available games.
  - In reactive sessions (DM / mention), Claude uses channel→game inference to resolve which game's data to read/write; configured channels resolve transparently; unconfigured channels refuse with a clear error.
