## 1. allTimeRow config axis

- [x] 1.1 Add `TriviaAllTimeRowMode` type, `ALL_TIME_ROW_KEYS`, and `DEFAULT_ALL_TIME_ROW = "end-of-season-only"` to `src/plugins/trivia/core/configTypes.ts`
- [x] 1.2 Add optional `allTimeRow?: TriviaAllTimeRowMode` to `TriviaGame` and `TriviaConfig` in `configTypes.ts`
- [x] 1.3 Add `triviaAllTimeRowZod` (`z.enum(ALL_TIME_ROW_KEYS)`) and `validateAllTimeRowMode(raw, label)` to `core/configParsers/axes.ts`
- [x] 1.4 Parse the workspace tier in `core/configBridge.ts` (mirror the `hint` call site)
- [x] 1.5 Parse the game tier in `core/configParsers/games.ts` (mirror the `hint` call site); reject-and-warn on invalid values during config-file load (parseTriviaGames), treating the field as absent — same as `revealResponses`/`liveAnswersVisible`
- [x] 1.6 Create `src/plugins/trivia/domain/allTimeRow.ts` with `resolveAllTimeRow(game, workspace)` and `shouldShowAllTimeRow(mode, isLastFireOfSeason)`

## 2. Management tools surfacing

- [x] 2.1 Add `allTimeRow` (`.nullable().optional()` + description) to `tools/games/upsertGame.ts`
- [x] 2.2 Add `allTimeRow` (`.nullable().optional()` + description) to `tools/games/setWorkspaceConfig.ts`
- [x] 2.3 Surface `allTimeRow` in `tools/games/listGames.ts`: per-game only when set (omit the field when absent — no default injection at read time); `workspaceDefaults.allTimeRow` only when `config.trivia.allTimeRow` is set

## 3. Reveal flow payload

- [x] 3.1 Add `showAllTimeRow?: boolean` to `ProcessRevealResult` in `tools/reveal/types.ts`
- [x] 3.2 In `tools/reveal/processRevealAnswers.ts`, resolve `allTimeRow` via `resolveAllTimeRow(gameEntry, triviaConfig)` after `seasonStatus` is computed, derive `showAllTimeRow` via `shouldShowAllTimeRow`, and include it in the payload when `seasonStatus` is present

## 4. Reveal prompt — table contract (scheduledPrompts.ts)

- [x] 4.1 Drop the `reveals.length > 1` gate on the `This Round` row; render it whenever `roundSummary` is present (single- and multi-question), positioned as the top data row
- [x] 4.2 Restate table construction as decide-column-order-once (by This Round, em-dash last; else by `currentSeasonCorrect`) + every row fills cells in that shared order; forbid per-row sorting; state the leftmost-column = round-leader consequence
- [x] 4.3 Replace the four fixed table shapes with the additive seasons-on model: `This Round? / Current Season (anchor) / All Time?`, with `All Time` gated on `hasPriorSeasons && showAllTimeRow`
- [x] 4.4 Relabel the single-season (`hasPriorSeasons === false`) anchor row as `Current Season` (replace the old unlabeled 2-row)
- [x] 4.5 Replace the "top-4 by array order" medal wording with the unified dense-rank-by-distinct-value rule (🥇🥈🥉🎀, ties share, 0/em-dash never medal), applied per row independently
- [x] 4.6 Update the worked JSON table examples to lead with This Round, reflect the new sort, show a tie sharing a medal, and show an All-Time-leader parked mid-table

## 5. Reveal prompt — season finale (scheduledPrompts.ts)

- [x] 5.1 Replace the old finale section with the finale layout: verdicts → Season Winners podium (top-3 distinct `currentSeasonCorrect`, ties share a place) → one-line participation tail (4th distinct value wears 🎀, zero-participation omitted) → gated All-Time table → closer
- [x] 5.2 Gate the finale All-Time table on `hasPriorSeasons && showAllTimeRow`; medaled, columns by `totalCorrect` desc
- [x] 5.3 Preserve the in-tool rollover wording (no `upsert_season` follow-up; no next-season slug preview)

## 6. Reveal prompt — "nobody got it" (scheduledPrompts.ts)

- [x] 6.1 Add the empty-`correct` branch: in `"yes"`/`"just-correctness"` modes, swap the INCORRECT name section for an expanded answer explanation
- [x] 6.2 In `"just-winners"` mode, pair the existing anonymous "everyone got fooled" line with the expanded answer detail; name no misser

## 7. Tests

- [x] 7.1 `domain/allTimeRow.test.ts` — resolver cascade + `shouldShowAllTimeRow` across the three modes × last-fire/not
- [x] 7.2 Config-parser tests for `validateAllTimeRowMode` (valid values, invalid rejected) at workspace + game tiers
- [x] 7.3 `processRevealAnswers.test.ts` — `showAllTimeRow` present/correct for `always`/`never`/`end-of-season-only` × `isLastFireOfSeason`, and gated on `seasonStatus` presence
- [x] 7.4 Update `scheduledPrompts.test.ts`: This Round gated on `roundSummary` (not length); top-of-table + single-shared-column-order + forbid per-row sort; dense-rank tie medals; additive rows + single-season relabel + `showAllTimeRow` gate; finale podium/participation/all-time layout; empty-`correct` detail branch
- [x] 7.5 Update `listGames` tests to cover `allTimeRow` surfacing (per-game + workspaceDefaults, present/absent)

## 8. Verification

- [x] 8.1 `npx tsc` clean
- [x] 8.2 `npm test` green
- [x] 8.3 `npx oxlint` + `npx oxfmt --check` on changed files
- [x] 8.4 `openspec validate redesign-trivia-reveal-leaderboard --strict`
- [x] 8.5 `graphify update .` to keep the tracked graph in sync
