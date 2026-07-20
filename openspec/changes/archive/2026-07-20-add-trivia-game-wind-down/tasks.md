# Tasks: add-trivia-game-wind-down

## 1. Config field

- [x] 1.1 Add `disableAfterRound?: boolean` to `TriviaGame` in `src/plugins/trivia/core/configTypes.ts` (doc comment: game-tier lifecycle field, NOT a `CascadeAxes` member; STANDING flag — survives wind-down, so a later re-enabled game winds down again at its next round close)
- [x] 1.2 Accept the field in the game parser under `src/plugins/trivia/core/configParsers/` (graceful: optional boolean; malformed → drop-the-field-with-issue per sibling policy) + parser tests: absent field ≡ `false` (legacy byte-identical), malformed non-boolean drops the field with an issue
- [x] 1.3 Verify the cascade parity test does NOT pick it up (it must not — no `AXIS_REGISTRY` entry)

## 2. Rename `start_new_season` → `end_season`

- [x] 2.1 Rename `src/plugins/trivia/tools/seasons/startNewSeason.ts` → `endSeason.ts`; rename `createStartNewSeasonTool` → `createEndSeasonTool` and the tool name string; reframe DESCRIPTION around "close is the contract, succession is server-resolved policy" (queued promote / continuation / wind-down)
- [x] 2.2 Update registration + Slack task-card label in `src/plugins/trivia/index.ts`
- [x] 2.3 Rename `startNewSeason.test.ts` → `endSeason.test.ts` and update its references
- [x] 2.4 Update `PROCESS_REVEAL_INSTRUCTIONS` in `src/plugins/trivia/prompts/scheduledPrompts.ts`: step 3 tool name + all `start_new_season` mentions (incl. the `compute_answers` step's not-to-call list)
- [x] 2.5 Update `scheduledPrompts.test.ts` assertions (tool-chain ordering test, gating regexes ~6 sites) to `end_season`
- [x] 2.6 Sweep remaining references: `check_season_status` tool description, management/admin instruction text, `catchUp.ts` comments if any, `CLAUDE.md` trivia section, `grep -rn start_new_season src/ CLAUDE.md`
- [x] 2.7 Update `openspec/specs/trivia-reveal-processor/spec.md` Purpose prose (plain-text rename; no requirement change)

## 3. Wind-down branch in `end_season`

- [x] 3.1 In `end_season` ONLY (post_questions/compute_answers keep `requireWritableGame` per the Two-layer-enforcement requirement): replace `requireWritableGame` with `requireGame` + the branch-aware semantic guard on disabled games — disabled + `disableAfterRound: true` + (when a season timeline exists) latest season `endedAt` stamped → no-op success `{ seasonClosed: true, gameDisabled: true, alreadyWoundDown: true }`; disabled in any other state → structured "game is disabled" error. Idempotency itself lives in the shared executor (3b.1)
- [x] 3.2 Implement the successor-policy branch after the season close: `disableAfterRound === true` → skip continuation (bypass/param `applySeasonRollover`'s create step), persist `enabled: false` via the `persistGameWrite` path, return `gameDisabled: true`; ensure the seasons-state save happens BEFORE the config write (disable is the LAST mutation)
- [x] 3.3 Include the correction recipe (re-enable → fix → re-disable, manual re-disable is load-bearing) in the wind-down result message
- [x] 3.4 Confirm `force: true` flows through the wind-down branch (early close also disables); mention `gameDisabled` side effect in the `force` arg description
- [x] 3.5 Tests: wind-down on last fire (endedAt + no continuation + enabled:false + `gameDisabled`), normal rollover unaffected, `force` wind-down, replayed-finale no-op, stray-call-on-disabled error, crash-between-endedAt-and-disable convergence, teamsStamp still written on wind-down

## 3b. Seasonless branch

- [x] 3b.1 Extract the shared executor `windDownGame(game)` into `src/plugins/trivia/domain/windDown.ts` (guards, `enabled: false` persist via `persistGameWrite`, recipe message, `alreadyWoundDown` idempotency) — `end_season`'s season branch (task 3.2) delegates to it
- [x] 3b.2 Seasonless branch inside `end_season`: NO active season (seasons disabled workspace-wide OR the game's timeline is empty/in a gap) + `disableAfterRound: true` → guard on board cleared (zero unrevealed posted questions; `force` bypasses only this) → executor; without the flag, keep the existing "No current season to roll over" response byte-identical; tests for success / mid-board refusal / `force` board-bypass / no-flag passthrough / replay no-op, covering both seasonless conditions (workspace-disabled vs gap)
- [x] 3b.3 `compute_answers`: emit report-only `windDown: { eligible: true }` when no active season + flag set + zero unrevealed posted questions remain + tests: eligible when all three hold; absent while questions remain; absent without the flag; absent whenever a season is active (regardless of board state)
- [x] 3b.4 `PROCESS_REVEAL_INSTRUCTIONS`: widen the step-3 gate to `isLastFireOfSeason === true` OR `windDown.eligible === true` + prompt tests
- [x] 3b.5 Document in the flag's descriptions (`upsert_game`, management instruction): a recurring seasonless game with the flag winds down after its first board-clearing reveal; re-enabling later and clearing a new board is the next round and winds down again

## 4. Surfacing

- [x] 4.1 `upsert_game`: accept `disableAfterRound` (omit-to-keep / null-to-clear on UPDATE, verbatim on CREATE) + arg description + test
- [x] 4.2 `list_games`: surface `disableAfterRound` when set + test
- [x] 4.3 Management/admin instruction (`TRIVIA_GAMES_ADMIN_INSTRUCTION` / management topic): document the flag, the wind-down semantics, `force` interaction, and the correction recipe
- [x] 4.4 `FINALE_TONE_CONTENT` in `prompts/topicInstructions.ts`: add the series-wrap variant keyed off `gameDisabled` in the `end_season` result (no next-season preview, chapter closes for good); update prompt step 3 to direct Claude to read the result
- [x] 4.5 Prompt tests: series-wrap conditional present; reveal prompt does NOT reference `start_new_season`

## 5. Verification

- [x] 5.1 `npx tsc` clean
- [x] 5.2 `npm test` green (incl. trivia integration suites — reveal/format/gating; verify the straggler-fire property: a disabled game's `post_questions`/`compute_answers` still refuse via `requireWritableGame`)
- [x] 5.3 `npx oxlint` + `npx oxfmt --check` on touched files
- [x] 5.4 `grep -rn start_new_season src/` returns nothing
- [x] 5.5 Update `CLAUDE.md` seasons section (tool name + `disableAfterRound` mention); run `graphify update .`
