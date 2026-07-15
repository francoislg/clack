# Tasks — add-trivia-variable-points

## 1. Axis registration (types, registry, parser)

- [x] 1.1 Add `TriviaPointsConfig` (`{ max: number; guidance?: string }`) + `DEFAULT_TRIVIA_POINTS` (`{ max: 1 }`) to `core/configTypes.ts`; add `points?: TriviaPointsConfig` to `CascadeAxes` (`core/cascadeAxes.ts`), updating the membership count/comment
- [x] 1.2 Register the axis: `points: makeFirstWins("points", DEFAULT_TRIVIA_POINTS)` in `AXIS_REGISTRY` + entry in `AXIS_KEYS` (`domain/resolveCascade.ts`); extend `resolveCascade.test.ts` with points cascade cases (tier wins, whole-object replace, default fallthrough)
- [x] 1.3 Add `validateTriviaPoints` (max: required int 1–10; guidance: optional non-empty trimmed ≤500) + standalone `triviaPointsZod` export in `core/configParsers/axes.ts` — flat axis, NOT in `TriviaAxisBag` (nor in `axisFieldsZod`, which holds only bag axes — flat axes are named exports, per `triviaChoicesZod`); `pointsCheck` primitive in `axisCheckers.ts`; `configParsers/points.test.ts` covering valid values and each rejection
- [x] 1.4 Parity closed: parser accepts `points` at the game tier (`configParsers/games.ts`), slot tier (`configParsers/format.ts` — `RawSlot` + `validateSlotConfig` + `seasonFormatSlotZod`), and workspace tier (`core/configBridge.ts`); all three parity suites green

## 2. Management write/read surface

- [x] 2.1 `upsert_game`: accepts `points` (zod field + validator, omit-to-keep / null-to-clear, replace + guidance-is-the-switch semantics in the description); `hasPoints` in the result; shadowing detection covers it free (`WrittenField` = `keyof CascadeAxes`); tests added in `upsertGame.test.ts` (set, bare cap, update replaces wholesale, clear, invalid)
- [x] 2.2 `upsert_season`: accepted on create + update branches and both slot paths (`format` slots and `slotOverrides`); new `upsertSeason.points.test.ts` (7 tests)
- [x] 2.3 `set_workspace_config`: workspace tier accepted + cleared; tests added in `setWorkspaceConfig.test.ts`
- [x] 2.4 `list_games` + `explain_cascade` needed NO projection code — both iterate `AXIS_KEYS`; only the description's axis enumeration was extended. Coverage added in `listGames.test.ts` (game `axisOverrides` + `workspaceDefaults`, omitted when unset)

## 3. Generation: surface, pick, stamp

- [x] 3.1 `get_ideas`: resolves `points` per slot; surfaces `maxPoints` + `pointsGuidance` ONLY when resolved `max > 1` AND `guidance` is set; documented in the tool DESCRIPTION; `getIdeas.points.test.ts` (8 tests — cap+guidance, bare cap, guidance under max:1, legacy, game/season/gameSlot tiers, whole-object masking)
- [x] 3.2 Added `POINTS_GATE` to the SHARED GATES block in `prompts/scheduledPrompts.ts` (gate on `maxPoints`; follow `pointsGuidance`; DEFAULT TO 1 — cap is a ceiling not a target; never spend for unnamed reasons) + invoked from all 6 save sites (3 text-path save lists, 3 visual-path inline saves). Assertions in `promptContent.test.ts` across all 3 generation prompts
- [x] 3.3 `save_question`: optional integer `points` in `COMMON_SAVE_FIELDS` (format-agnostic → validated in the tool, no answer-type handler needed); server-side cascade re-resolution; rejects out-of-range and any `points` when resolved max is 1; normalizes 1 → absence; stamps on the record; `points?: number` + JSDoc on `TriviaQuestion`; `saveQuestion.points.test.ts` (8 tests)

## 4. Card display

- [x] 4.1 Added `points.worth` ("⭐ Worth {count} points" / "⭐ Vaut {count} points") to the plugin dictionary; i18n parity green
- [x] 4.2 New `renderPoints.ts` (`applyPointsRendering`) inserts the context block before the actions block iff the record's stamped `points > 1`, built from the record; wired into `post_questions` BEFORE hint rendering so an inline hint keeps its slot adjacent to the buttons. Extracted the layout primitives both renderers share into `cardLayout.ts` (`isActionsBlock` / `mrkdwnContext` / `insertBeforeActions`) and refactored `renderHint` onto them. Tests: `renderPoints.test.ts` (5) + 2 in `postQuestions.test.ts` (lands in `postedBlocks`, positioned above buttons, absent at 1 point). Roster survival needs no code — `editRosterIntoCard` always rebuilds from `postedBlocks`

## 5. Points-primary scoring

- [x] 5.1 `computeLeaderboard` takes a required `questionPoints` map + new `buildQuestionPointsMap` helper (only >1 entered; everything else `?? 1`); pays each correct row into new `totalPoints`/`currentSeasonPoints`; comparators points-primary. Tests: existing 10 pass unchanged via an `ALL_ONE_POINT` map (the legacy-equivalence property), + 7 new (weighted payout, incorrect pays 0, pending excluded, points outrank counts, uniform ≡ legacy, season scoping, verdict-flip re-prices through the join)
- [x] 5.2 Both production callers wired (`computeAnswers.ts` — one hoisted map shared with the round summary, re-read post-stamp; `retrieveScores.ts` — reuses its existing `loadQuestions()` call)
- [x] 5.3 `roundSummary`: per-player `points`, sort + `roundMvp` by points, `perfectRound` still completeness-based; 17 existing tests pass unchanged + 6 new (incl. both split perfectRound/roundMvp directions)
- [x] 5.4 Reveal entries carry `points` iff stamped >1 (`ProcessRevealEntry`); 3 new `computeAnswers.test.ts` cases (entry + leaderboard + round summary)
- [x] 5.5 `pickSeasonMvp` picks by `currentSeasonPoints`, tiebreak `totalPoints`; mvp output gained `currentSeasonPoints` so the pick is explicable; 19 existing tests pass unchanged + 2 new
- [x] 5.6 Reveal prompt updated: payload docs (`leaderboard` incl. both point fields + "table renders POINTS", `roundSummary.perPlayer.points`, per-reveal `points` framed as pre-known stakes), all 4 score-cell rules (This Round / Current Season / All Time / seasons-off), both column-ordering rules, and the FINALE — whose `"pts" everywhere means currentSeasonCorrect (no separate scoring concept)` line was now false; podium + all-time table now rank by points

## 6. override_question tool

- [x] 6.1 Create `tools/questions/overrideQuestion.ts`: admin tool with zod schema exposing exactly `questionId` + optional `points` (int 1–10, absolute bound) + optional `difficulty` (int 1–10); reject empty patches and unknown questions; normalize `points: 1` to field removal; per-field original capture on first override (the `originalVerdict` pattern); persist via `scoped.updateQuestion`
- [x] 6.2 Worth-block surgery: on a points change for a posted question, insert/replace/remove the worth-block inside stored `postedBlocks` and return a `refreshHint` (reuse `core/refreshHint.ts`); difficulty-only overrides touch neither
- [x] 6.3 Registered admin-only in `index.ts` (always-on default server, beside `override_answer`) with an i18n label (`label.override_question`, en + fr). Documented as Case 4 in `TRIVIA_GAMES_ADMIN_INSTRUCTION`'s correction section, whose intro now dispatches on WHAT is wrong (verdict → `override_answer`, key → `settle_question`, cheat flag → `remove_cheat`, points/difficulty reclass → `override_question`) and notes Case 4 is the one that works pre-reveal. Covered by 8 new assertions in `triviaCheckInstruction.test.ts`
- [x] 6.4 Add `overrideQuestion.test.ts`: reclass points (join re-prices without touching answers), reclass difficulty (no card effect, `suggestedDifficulty` untouched), original captured once across two overrides, absence-as-original restore case, points:1 removes field + block, empty/out-of-range/unknown-id rejections, unposted-question path (no refreshHint)

## 7. Audit surfaces + docs

- [x] 7.1 `find_previous_questions`: `toSearchResult` surfaces stamped `points` and, via a small `originalsToJson` converter (mirroring `mediaToJson`), the captured `overriddenFrom`. Both use the file's standard `!== undefined` guard, so they are self-gating and an ordinary row is unchanged — no "targeted lookup" mode needed (the tool has no id-based arg). 4 new tests in `findPreviousQuestions.test.ts`
- [x] 7.2 Documented in `CLAUDE.md` beside the sibling axis paragraphs: the `points` axis (shape, cascade, guidance-is-the-switch, prompt-picked + save-stamped, worth block, points-primary scoring) and an `override_question` paragraph. The latter introduces the correction family (`override_answer` / `settle_question` / `remove_cheat`) inline, since CLAUDE.md documented none of those tools and back-filling all three is outside this change

## 8. Verification

- [x] 8.1 `npx tsc --noEmit` clean; `npm test` green (440 files / 7068 tests); `npx oxlint` + `npx oxfmt --check` clean on touched files
- [x] 8.2 Grep sweep done. Every surface is points-aware: cascade resolution, `get_ideas`, `save_question`, `computeLeaderboard`, the `roundSummary` + `leaderboard` payloads, `retrieve_scores`, `rollover` MVP, `find_previous_questions`, and the reveal-prompt directives. `retrieveScores.ts` / `postQuestions.ts` look absent from a case-sensitive `points` grep but are wired (`buildQuestionPointsMap`, `applyPointsRendering`). Every `totalCorrect`/`currentSeasonCorrect` read is INSIDE `computeLeaderboard` computing `accuracy` + the season fields — correct, since those keep their pre-feature meanings; no display surface reads correct-count where points should flow. `allTimeRow` gates WHETHER the all-time row renders, not its value → orthogonal
- [ ] 8.3 Manual config check against a live dev bot — NOT performed (no running instance in this session). The equivalent path is covered automatically end-to-end: `configParsers/points.test.ts` (workspace-tier parse + every rejection), `listGames.test.ts` (`workspaceDefaults` projection), `cascadeParity.crossTool.test.ts` (`explain_cascade` ≡ `get_ideas` ≡ `save_question`), and `getIdeas.points.test.ts` (`maxPoints`/`pointsGuidance` surfaced for cap+guidance, withheld for a bare cap). Worth a smoke test on the next deploy before an admin relies on it
