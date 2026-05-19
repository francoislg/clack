## 1. Config schema

- [x] 1.1 Add `TriviaGame` type and `games?: TriviaGame[]` field to `TriviaConfig` in `src/config.ts`
- [x] 1.2 Add a `parseTriviaGames(raw)` helper that validates each entry: non-empty `name` (unique within array), `channel` matches `^[CGD][A-Z0-9]+$`, both crons parseable via `cron-parser`, non-empty `timezone`. Invalid entries dropped with a warning. Duplicate `name` drops the second + warns.
- [x] 1.3 Wire `parseTriviaGames` into the existing `triviaConfig` builder in `loadConfig`
- [x] 1.4 Add tests to `src/config.test.ts`: absent games (parsed undefined), empty (`[]`), valid single-game, invalid cron rejected, invalid channel shape rejected, duplicate name rejected

## 2. Trivia plugin reconcile

- [x] 2.1 In `src/plugins/trivia/index.ts`, after the seasons-init block but before any `registerTool` calls, read `getConfig().trivia?.games ?? []` and build specs (two per game): `{ specKey: "<name>:question" }` and `{ specKey: "<name>:reveal" }`
- [x] 2.2 Question spec: `prompt = SEND_QUESTIONS_INSTRUCTIONS` from `scheduledPrompts.ts`, `cronExpression = game.questionCron`, `requiredTools = ["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions", "mcp__trivia__save_question"]`
- [x] 2.3 Reveal spec: `prompt = getProcessResponsesInstructions(seasonsEnabled)`, `cronExpression = game.revealCron`, `requiredTools` base list with `mcp__trivia__check_season_status` appended when `seasonsEnabled`
- [x] 2.4 Call `await sdk.reconcileCronJobs("trivia", specs)` with the full list (even when empty — to clean up prior plugin-managed jobs when games are removed from config)
- [x] 2.5 Emit a warning when `revealCron`'s next-fire time in `timezone` falls earlier on the same date than `questionCron`'s, for any matching day-of-week
- [x] 2.6 Tests: spec builder unit tests covering shape, seasons-on adds `check_season_status`, seasons-off omits it, multi-game produces 2N specs, inverted timing emits warning

## 3. Legacy migration

- [x] 3.1 Scaffold `src/migrations/019-trivia-games-migration.ts` (priority: `blocking`)
- [x] 3.2 Implement: load `data/state/cron-jobs.json` and `data/config.json`; find candidates (`plugin === "trivia"` AND prompt matches one of `/Call send_questions_instructions and follow/` or `/Call process_responses_instructions and follow/`); group by `channel`; for each complete pair (one question + one reveal), append a `TriviaGame` to `config.trivia.games[]` and remove both source jobs; persist both files atomically
- [x] 3.3 Idempotency: if no candidates exist (or all have been migrated), no writes
- [x] 3.4 Unpaired candidates: log a warning, leave the job in place
- [x] 3.5 Tests: clean pair migrates, both files updated, unpaired left alone with warning, customized inline-fat-prompt left alone, re-run is no-op

## 4. Default-configuration cleanup

- [x] 4.1 Search `data/default_configuration/` for references to `send_questions_instructions`, `process_responses_instructions`, `create_schedules_instructions`, and their `mcp__trivia__*` forms
- [x] 4.2 Rewrite or remove each reference; if the instruction was teaching Claude how to set up trivia, replace with a one-paragraph note pointing at `config.trivia.games[]` _(no references found — default config already clean)_

## 5. Verification

- [x] 5.1 `npx tsc --noEmit` clean
- [x] 5.2 `npx oxlint` clean on touched files
- [x] 5.3 `npx oxfmt` clean on touched files
- [x] 5.4 `npm test` green (3437 tests passing)
- [x] 5.5 Smoke test: add a single-game `trivia.games[]` entry to a test config, boot the bot, verify two `pluginManaged: true` cron jobs appear in `cron-jobs.json` with the expected fields and embedded prompts; remove the entry, verify both jobs are deleted on next reload
