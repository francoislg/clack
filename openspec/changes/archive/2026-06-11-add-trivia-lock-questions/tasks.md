## 1. Schema & config

- [x] 1.1 Add optional `answerLocked?: boolean` to `TriviaQuestion` (`core/types.ts`). NOTE: the questions loader (`core/dataLayer.ts`) uses plain `JSON.parse` — there is no separate question zod schema — so the optional field round-trips automatically; absent reads as unlocked.
- [x] 1.2 Add optional `lockCron?: string` to `TriviaGame` (`core/configTypes.ts`). Extend the games config parser (`core/configParsers/games.ts`) to validate `lockCron` via `cron-parser`, dropping only the field with a logged warning on a malformed value (extracted a shared `parseLenientCron` helper used by both `prepCron` and `lockCron`) — never reject the whole game.

## 2. Shared button-strip helper

- [x] 2.1 Extracted the answer-actions block filter from `revealCards/editCard.ts` into a shared `stripAnswerButtons(blocks)` helper in `revealCards/answerActions.ts` (also exporting `ANSWER_ACTIONS_BLOCK_PREFIXES`). Re-pointed `editRevealIntoCard` at it — no behavior change to reveal.

## 3. Lock-aware live-card render

- [x] 3.1 Added a localized locked-notice context block builder (`buildLockedNotice` in `freeform/roster.ts`) keyed on `card.locked_notice`. Added the key + `error.answers_locked` to `i18n/strings.ts` en/fr (FR values distinct).
- [x] 3.2 Branched `freeform/roster.ts:editRosterIntoCard` on `question.answerLocked`: when `true`, composes `[...stripAnswerButtons(postedBlocks), lockNotice]` (no divider, no roster); else keeps `[...postedBlocks, divider, roster]`. Always sourced from `postedBlocks`.

## 4. lock_questions tool

- [x] 4.1 Created `src/plugins/trivia/tools/lock/lockQuestions.ts` + shared `applyLock.ts` (`transitionLock`). Selects `postedAt!==undefined && processedAt===undefined && answerLocked!==true`, stamps `answerLocked: true`, repaints via the lock-aware rebuild. Idempotent, per-card isolated, posts nothing.
- [x] 4.2 Registered `lock_questions` on the trivia default server (admin) with `label.lock_questions`.

## 5. unlock_questions admin tool

- [x] 5.1 Created `unlockQuestions.ts` — selects `answerLocked===true && processedAt===undefined`, clears the flag, repaints (buttons + roster return from `postedBlocks`). Idempotent, per-card isolated, refuses missing/disabled game.
- [x] 5.2 Registered `unlock_questions` on `trivia:management` (admin) with `label.unlock_questions`; documented it + the `lockCron` schedule in the management admin instruction.

## 6. Click & modal lockout

- [x] 6.1 Added an `answerLocked === true` lockout in `clickHandlerInstaller.ts` beside the `processedAt` check (factored a `notifyClosed` helper) — ephemeral `error.answers_locked`, no write.
- [x] 6.2 Added the `answerLocked` guard to freeform's modal: opens read-only (locked mode) and rejects submission with `error.answers_locked`.

## 7. Lock cron spec

- [x] 7.1 `buildGameSpecs` emits a `<name>:lock` spec when `game.lockCron` is set: channelless, `requiredTools: ["mcp__trivia__lock_questions"]`, `submitResponseMode: "skipped"`, `attachedTopics: ["trivia"]`, `skipDates` propagated. Added `LOCK_QUESTIONS_INSTRUCTIONS` to `scheduledPrompts.ts`. Nothing emitted when `lockCron` absent.
- [~] 7.2 SKIPPED (proposal marked optional). `warnIfLockBeforeQuestion` not added — lock-before-question is a valid config (lock can precede the next day's question fire), so the warning would be noisier than prep's. Flag for follow-up if desired.

## 8. upsert_game / list_games surface

- [x] 8.1 `upsert_game` accepts optional `lockCron` (cron-validated in the game timezone; omit-to-keep; `null`/empty-string clears). Persisted on the game entry.
- [x] 8.2 `list_games` surfaces `lockCron` + `nextLockFire` + `lockJobId` per-entry when set; omitted when unset.

## 9. Tests & verification

- [x] 9.1 NOTE: the questions loader (`dataLayer.ts`) uses plain `JSON.parse` — no zod schema — so `answerLocked` round-trips automatically (covered by the lock-tool tests asserting the persisted flag). Parser tests added in `games.test.ts` (valid/malformed/absent/wrong-type/empty `lockCron`, + isolation from `prepCron`).
- [x] 9.2 `roster.test.ts` — locked rebuild drops buttons + shows notice + omits roster; unlocked unchanged; unlock restores buttons.
- [x] 9.3 `lockQuestions.test.ts` / `unlockQuestions.test.ts` — lock targets only posted/unrevealed/unlocked, idempotent, per-card-failure isolated; unlock clears flag, skips revealed; unknown-game + Slack-unavailable errors.
- [x] 9.4 `clickHandlerInstaller.test.ts` — locked click acks + ephemeral, no write. Freeform modal: the locked-mode rendering is covered by `modal.test.ts` (`buildFreeformModal` locked view); the `registerView` submission guard mirrors the existing (interaction-untested) `processedAt` guard — no bespoke interaction harness added.
- [x] 9.5 `buildGameSpecs.test.ts` — emits `<name>:lock` (channelless, skipped, minimal `requiredTools`) when set, none when absent, `skipDates` propagate, prep+lock ordering. `upsertGame.test.ts` exercises `lockCron` via the shared args helper.
- [x] 9.6 i18n parity passes; `npx tsc --noEmit`, `npx oxlint src/plugins/trivia` (0/0), `npx oxfmt`, and full `npm test` (346 files, 5728 passed) all green.
