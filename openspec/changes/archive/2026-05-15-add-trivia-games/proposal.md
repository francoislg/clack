## Why

The `plugin-managed-schedules` change introduced an SDK API (`reconcileCronJobs`) that lets a plugin declare and own its scheduled jobs from its own config. Trivia is the first consumer, and it has a clear repeating-need: most deployments run one or more trivia games on a fixed cadence (a "question" post in the morning, an "answer reveal" in the afternoon). Today that requires running an admin wizard (`create_schedules_instructions`) and creating two cron jobs per game by hand, then keeping them in sync forever. Adding `config.trivia.games[]` makes the games declarative — list them in the config, edit when you want to change them, and the trivia plugin reconciles its cron jobs on every reload.

This change also removes the now-redundant indirection in trivia's prompt flow: the dispatcher cron prompts (`"Call send_questions_instructions and follow"`) and the corresponding instruction tools (`send_questions_instructions`, `process_responses_instructions`, `create_schedules_instructions`) are no longer needed. The substantive prompts can be embedded directly into the cron job's `prompt` at reconcile time.

## What Changes

- **NEW: `config.trivia.games: TriviaGame[]`** — `{ name, channel, questionCron, revealCron, timezone }` per game. The trivia plugin reads this on every init and calls `sdk.reconcileCronJobs("trivia", specs)` with one spec per schedule (two per game).
- **CHANGED: Trivia plugin init.** `triviaPlugin` in `src/plugins/trivia/index.ts` builds specs from `config.trivia.games[]` and invokes `reconcileCronJobs`. Specs key on `<name>:question` / `<name>:reveal` so adding/removing/editing a game in config is reflected on the next reload.
- **CHANGED: Embedded prompts.** Each spec's `prompt` is the full substantive instructions text from `scheduledPrompts.ts` (`SEND_QUESTIONS_INSTRUCTIONS` for the question schedule; `getProcessResponsesInstructions(seasonsEnabled)` for the reveal schedule). No more thin-dispatcher pattern.
- **CHANGED: `requiredTools`.** Each spec's `requiredTools` is derived in the plugin: question spec requires `mcp__trivia__get_ideas`, `mcp__trivia__find_previous_questions`, `mcp__trivia__save_question`; reveal spec requires `mcp__clack__fetch_channel_messages`, `mcp__trivia__find_previous_questions`, `mcp__trivia__get_question_history`, `mcp__trivia__submit_answers`, `mcp__trivia__retrieve_scores`. When `trivia.seasons.enabled === true`, the reveal spec additionally requires `mcp__trivia__check_season_status`.
- **MIGRATION: legacy trivia cron jobs.** A blocking migration converts any pre-existing cron jobs with `plugin === "trivia"` (or whose `prompt` matches the legacy dispatcher patterns) into entries in `config.trivia.games[]`, then deletes them from `cron-jobs.json`. The next plugin init reconciles them as fresh plugin-managed jobs with embedded prompts. Unpaired or unrecognizable legacy jobs are left in place with a warning.
- **CHANGED: Default-configuration instruction text.** Any reference in `data/default_configuration/` to `send_questions_instructions` / `process_responses_instructions` / `create_schedules_instructions` is rewritten or removed. The setup recipe section that taught Claude how to run the wizard is replaced with a one-paragraph note saying "edit `config.trivia.games[]`."

## Capabilities

### New Capabilities

- `trivia-managed-schedules`: the `config.trivia.games[]` schema, the plugin init's reconcile call, the question/reveal spec builders (with `requiredTools` derivation from the seasons gate), and the reveal-before-question warning.

### Modified Capabilities

- `trivia-scheduled-prompts`: removes the three instruction tools (`send_questions_instructions`, `process_responses_instructions`, `create_schedules_instructions`) and replaces the admin-wizard recipe with config-driven self-management. The legacy-cron migration is part of this capability.

## Impact

- **Code:** `src/config.ts` (`TriviaGame` type + parsing for `trivia.games[]`), `src/plugins/trivia/index.ts` (reconcile call, derive specs from config, drop the seasons-bootstrap helper if any logic relocates), `src/plugins/trivia/scheduledPrompts.ts` (export helpers consumed by the reconcile builder), new `src/migrations/019-trivia-games-migration.ts` (blocking migration), `data/default_configuration/` instruction files referencing the deleted tools.
- **Tests:** `src/config.test.ts` (new shape: valid + invalid), trivia init test that exercises the reconcile call, migration tests (clean pair migrates, unpaired left alone, idempotency), spec-builder unit tests (shape + requiredTools derivation + reveal-before-question warning).
- **Data:** the legacy migration mutates `data/config.json` (appends `trivia.games[]`) and `data/state/cron-jobs.json` (deletes the converted jobs). Snapshot the originals before deploying.
- **External:** removes three MCP tools (`mcp__trivia__send_questions_instructions`, `mcp__trivia__process_responses_instructions`, `mcp__trivia__create_schedules_instructions`) — **BREAKING** for any external caller, but the legacy migration is invisible to operators.
- **Dependencies:** none new.
- **Depends on:** the `plugin-managed-schedules` change (already archived) for `sdk.reconcileCronJobs` and `CronJob.pluginManaged`/`specKey`.
