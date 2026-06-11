## Why

Prediction questions ask players to commit a pick before a real-world event whose outcome is still unknown. Today a player can keep changing their vote right up until the reveal — there is no moment where picks are frozen. A predictions game needs a "predictions locked in" checkpoint that closes voting at a set time (e.g. kickoff), well before results are known and revealed.

## What Changes

- Add an optional per-game `lockCron` to `TriviaGame`. When set, a third (or fourth, alongside `prepCron`) cron spec `<name>:lock` is emitted; when absent, nothing changes — no lock spec, no behavior difference.
- Add a `answerLocked?: boolean` flag to the `TriviaQuestion` record (graceful/optional — absent reads as unlocked). The flag is the single source of truth for whether a posted card still offers its answer buttons.
- The live-card rebuild (the path that repaints a posted question card from its stored `postedBlocks`) honors the flag: when `answerLocked === true` it strips the answer-actions block and appends a localized "🔒 locked in — waiting on results" notice instead of the buttons + live roster. Reversible: clearing the flag restores the buttons (they live inside `postedBlocks`).
- Add `lock_questions(game)` — fired by the lock cron. Locks every question in the game that is posted, not yet revealed, and not already locked: sets `answerLocked: true` and repaints each card. Idempotent, per-card isolated.
- Add `unlock_questions(game)` — admin escape hatch on the `trivia:management` on-demand server. Clears `answerLocked` and repaints, restoring the buttons.
- Add a `answerLocked` lockout to the vote/freeform click handlers (next to the existing post-reveal lockout) so an in-flight or stale-client click after lock is rejected with an ephemeral notice.
- `lockCron` is settable via `upsert_game` (omit-to-keep / null-to-clear) and surfaced by `list_games`.

## Capabilities

### New Capabilities
- `trivia-question-locking`: the `answerLocked` flag, the `lock_questions` / `unlock_questions` tools, the `lockCron`-driven lock schedule, and the click-handler lockout — the end-to-end "freeze voting on posted questions" feature.

### Modified Capabilities
- `trivia-question-posting`: the live-card rebuild that repaints a posted question card now honors `answerLocked` — stripping the answer-actions block and showing the lock notice instead of buttons + roster. Unlocked behavior is unchanged.
- `trivia-managed-schedules`: `buildGameSpecs` emits an additional channelless `<name>:lock` spec when a game sets `lockCron`. Games without `lockCron` produce the same specs as before.
- `trivia-games`: `TriviaGame` gains an optional structural `lockCron` field, settable via `upsert_game` and surfaced by `list_games`.

## Impact

- **New code:** `src/plugins/trivia/tools/lock/lockQuestions.ts` + `unlockQuestions.ts` (or co-located under `tools/`); a shared `stripAnswerButtons()` helper extracted from `revealCards/editCard.ts`; a flag-aware branch in the live-card rebuild (`freeform/roster.ts`); wiring in the tool server (`lock_questions` on the default server, `unlock_questions` on `trivia:management`).
- **Schema:** `TriviaQuestion` gains optional `answerLocked?: boolean` (graceful zod, no `.strict()`, absent = unlocked). `TriviaGame` gains optional `lockCron?: string` (validated as a cron expression at parse time like the other crons).
- **Touched flows:** `buildGameSpecs` (emit `:lock` spec), the click handlers in `answerTypes/clickHandlerInstaller.ts` + freeform's own registration (lockout), `upsert_game` / `list_games` (config surface).
- **Untouched:** the reveal flow (`editRevealIntoCard` already strips buttons regardless of `answerLocked`), question generation, scoring, and seasons are all unchanged. Type-agnostic: `lock_questions` locks whatever posted-unrevealed questions exist; a non-predictions game simply never sets `lockCron`.
- **Dependency:** motivated by and composes with `add-trivia-prediction-questions` (in-progress). The lock mechanism does not require prediction code to compile, but is only meaningful alongside it.
