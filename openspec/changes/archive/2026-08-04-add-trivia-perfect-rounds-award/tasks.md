## 1. Config types & validation

- [x] 1.1 Add optional `perfectRoundsAward?: { enabled: boolean }` to `TriviaConfig` and `TriviaGame` in `src/plugins/trivia/core/configTypes.ts`, and to `SeasonEntry` in `src/plugins/trivia/core/types.ts` (with a shared type alias + built-in default constant, mirroring `answeringType`).
- [x] 1.2 Add a shared zod schema + `validatePerfectRoundsAward(value, field)` helper (in `src/plugins/trivia/core/configParsers/axes.ts`, mirroring `validateAllTimeRowMode`) and wire it into the two graceful load-parsers: the workspace parser (`src/plugins/trivia/core/configBridge.ts`, mirror `trivia.answeringType`) and the game parser (`src/plugins/trivia/core/configParsers/games.ts`, mirror `tagPlayers`/`answeringType`). The season tier has NO load-parser (`loadSeasonsState` does a raw `JSON.parse`; season values are validated only on write via `upsert_season`), so no season parser change — the type on `SeasonEntry` is sufficient.
- [x] 1.3 Add parser unit tests (`src/plugins/trivia/core/configParsers/games.test.ts` for the game tier; the workspace tier via the configBridge integration test if a natural spot exists): valid value accepted, malformed value ignored without wiping sibling state.

## 2. Resolver

- [x] 2.1 Add `resolvePerfectRoundsAward(season, game, workspace)` in a new `src/plugins/trivia/domain/resolvePerfectRoundsAward.ts` (mirroring `resolveTagPlayers`) — cascade `season → game → workspace → { enabled: false }`, whole-value replace.
- [x] 2.2 Unit-test the resolver in `src/plugins/trivia/domain/resolvePerfectRoundsAward.test.ts`: season-over-game-over-workspace precedence, default off, each tier in isolation.

## 3. Season-wide aggregation

- [x] 3.1 In `src/plugins/trivia/tools/reveal/roundSummary.ts`, factor the per-batch clean-sweep check into a shared helper so `computeRoundSummary` and the new aggregation share one implementation (`≥ PERFECT_ROUND_MIN_QUESTIONS`, all-correct, per-(question,player) dedupe, `isTeamOwnerKey` excluded).
- [x] 3.2 Add `aggregateSeasonPerfectRounds(...)` (in `roundSummary.ts` beside the shared helper, or a sibling reveal module) that groups the season's revealed questions by `batchId` (undefined → singleton), tallies per player, and returns the max-count champion(s) as `{ userIds, count }` (or none when max is 0).
- [x] 3.3 Unit-test the aggregation in `src/plugins/trivia/tools/reveal/roundSummary.test.ts` (or a sibling test beside the aggregation): multi-fire tally, 2-question fire excluded, legacy `batchId`-less rows excluded, ties return all, `team:` rows excluded, empty when nobody swept.

## 4. Finale payload wiring

- [x] 4.1 Add `perfectRoundsChampion?: { userIds: string[]; count: number }` to `SeasonStatusOut` in `src/plugins/trivia/tools/reveal/types.ts`.
- [x] 4.2 In `src/plugins/trivia/tools/reveal/computeAnswers.ts` (season-finale branch), call the aggregation only when `isLastFireOfSeason && resolvePerfectRoundsAward(...).enabled`, and attach the field when `count ≥ 1`; omit otherwise.
- [x] 4.3 Unit-test in `src/plugins/trivia/tools/reveal/computeAnswers.test.ts`: field present with clear leader, present with ties, present when all tie, absent when disabled, absent on a non-finale fire, absent when max is 0.

## 5. Prompt rendering

- [x] 5.1 Add the bonus-medal line to the SEASON FINALE LAYOUT in `src/plugins/trivia/prompts/scheduledPrompts.ts` (read `perfectRoundsChampion`, render 🎖️, honor `tagPlayers` mention policy, list ties together, render nothing when absent; do not touch podium/table/scoring).
- [x] 5.2 Add a sentence to `FINALE_TONE_CONTENT` in `src/plugins/trivia/prompts/topicInstructions.ts` describing the bonus-medal tone (curtain-call flavor, distinct from the points MVP).
- [x] 5.3 Prompt-content tests assert the finale prompt references `perfectRoundsChampion` and the 🎖️ glyph, and that the instruction to render nothing-when-absent is present.

## 6. Admin surfacing & writes

- [x] 6.1 Surface `perfectRoundsAward` in `list_games` (`tools/games/listGames.ts`, per-game + workspace defaults) and `list_seasons` (`tools/seasons/listSeasons.ts`). Add it to `explain_cascade` (`tools/games/explainCascade.ts`) only if the other structural-specials appear there.
- [x] 6.2 Accept the knob with omit-to-keep / null-to-clear semantics in `set_workspace_config` (`tools/games/setWorkspaceConfig.ts`), `upsert_game` (`tools/games/upsertGame.ts`), and `upsert_season` (`tools/seasons/upsertSeason.ts`).
- [x] 6.3 Tests in the respective tool test files (`tools/games/listGames.test.ts`, `tools/games/upsertGame.test.ts`, `tools/games/setWorkspaceConfig.test.ts`, plus the season tool tests): set at each tier, clear via null, surfaced by `list_games`/`list_seasons`.

## 7. Validate

- [x] 7.1 `npx tsc --noEmit` clean; `npx oxlint` and `npx oxfmt --check` clean on touched files.
- [x] 7.2 `npm test` green (new + existing trivia suites).
- [x] 7.3 `openspec validate add-trivia-perfect-rounds-award --strict` passes.

## 8. Activate & deploy

- [ ] 8.1 Activate the feature by setting `perfectRoundsAward: { enabled: true }` at the intended tier in `data/config.json` (workspace default, or a specific game/season) — the knob defaults off, so nothing renders until this is set.
- [ ] 8.2 Deploy to the Clack GCE VM (`/deploy`), then confirm the setting is live and the finale renders the 🎖️ bonus medal on the next (or a forced) season-finale reveal.
