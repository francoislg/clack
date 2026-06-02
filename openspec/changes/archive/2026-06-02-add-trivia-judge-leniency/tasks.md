> Implementation reference: the `add-trivia-attribute` skill (flat-object, stamp-on-record variant — skip the weighted-roll `get_ideas` layer, keep `save_question` stamping).

## 1. Types & Default

- [x] 1.1 Add `export type JudgeLeniency = "strict" | "strict-with-typos" | "lenient"` and `export const DEFAULT_JUDGE_LENIENCY: JudgeLeniency = "strict-with-typos"` to `core/configTypes.ts`
- [x] 1.2 Add optional `judgeLeniency?: JudgeLeniency` to all four tiers in `core/configTypes.ts`: `SeasonFormatSlot`, `SeasonEntry`, `TriviaGame`, `TriviaConfig`

## 2. Domain Resolver

- [x] 2.1 Create `domain/judgeLeniency.ts` with `resolveJudgeLeniency(currentSeason, slotIndex, game, workspace): JudgeLeniency` following the cascade pattern in `domain/hint.ts` (slot → season → game → workspace → `DEFAULT_JUDGE_LENIENCY`)
- [x] 2.2 Add `domain/judgeLeniency.test.ts`: slot precedence, season precedence, game→workspace→default cascade, null/no-format fall-through

## 3. Config Parser & Validator

- [x] 3.1 In `core/configParsers/axes.ts`: add `JUDGE_LENIENCY_KEYS` const, `validateJudgeLeniency(raw, fieldLabel)` (enum-membership check, mirrors validator style), and `triviaJudgeLeniencyZod = z.enum(JUDGE_LENIENCY_KEYS)`
- [x] 3.2 Do NOT add `judgeLeniency` to `TriviaAxisBag` / `parseTriviaAxisBag` — that loop is for weighted-roll axes (`answersFormat`, `questionType`, `promptMedium`, …). `judgeLeniency` is a flat axis like `hint`: handled directly by the management tools and a standalone resolver, not the bag. (Verified: `hint` is absent from `TriviaAxisBag`.)
- [x] 3.3 Add `core/configParsers/judgeLeniency.test.ts`: valid presets accepted, unknown value rejected with field-named error, non-string rejected

## 4. Judge Prompt Fragment Refactor

- [x] 4.1 In `freeform/judge.ts`: extract named fragment constants — `CASE_RULE`, `SUBSTITUTION_RULE` (20↔Vingt), `DECADE_RULE` (2020s↔2020), `PLURAL_RULE` (trailing s), `TYPO_RULE` (1–2 chars), `LOOSE_WRITING_RULE` (spacing/punct/accents/homophones), `KNOWS_IT_RULE` (intent over edit-distance, with the "could not plausibly mean a different valid answer" guard)
- [x] 4.2 Define `LENIENCY_PRESETS: Record<JudgeLeniency, string[]>` with `strict = [CASE, SUBSTITUTION, DECADE, PLURAL]`, `strictWithTypos = [...strict, TYPO, LOOSE_WRITING]`, `lenient = [KNOWS_IT]`
- [x] 4.3 Remove the inline typo-budget line from `NAMED_ENTITY_RULES` (it now lives in the fragments); keep synonyms + translation + too-broad in the shape block
- [x] 4.4 Change `buildSingleJudgePrompt(question, answerText, level: JudgeLeniency)` to assemble `[SHARED_RULES, LENIENCY_PRESETS[level], SHAPE_RULES[shape], OUTPUT_RULES]`
- [x] 4.5 Thread `level` through `judgeAnswer` and `judgeSubmissions` signatures (read from the stamped question, default `strict-with-typos`)
- [x] 4.6 Update `freeform/judge.test.ts`: assert `strict-with-typos` prompt still contains the typo + loose-writing tolerances (default-behavior preserved); assert `strict` omits them and `lenient` uses the knows-it fragment

## 5. Reveal Threading

- [x] 5.1 In `answerTypes/freeform.ts` / `tools/reveal/processRevealAnswers.ts`: pass each question's stamped `judgeLeniency` (default `strict-with-typos`) into `judgeSubmissions`/`judgeAnswer`
- [x] 5.2 Add/extend a reveal-processor test asserting two questions in one batch with different stamps get different presets

## 6. Stamp on Record (save_question)

- [x] 6.1 In `core/types.ts`: add optional `judgeLeniency?: JudgeLeniency` to `TriviaQuestion` with a JSDoc note (stamped at save; absence reads as `strict-with-typos`; read only by the freeform judge)
- [x] 6.2 In `tools/questions/saveQuestion.ts`: resolve `judgeLeniency` via `resolveJudgeLeniency(...)` at save time and stamp it on the saved record
- [x] 6.3 Add `tools/questions/saveQuestion.judgeLeniency.test.ts`: resolved preset is stamped; stamped value is independent of later config changes

## 7. Write Tools (MCP)

- [x] 7.1 `tools/games/upsertGame.ts`: accept `judgeLeniency: triviaJudgeLeniencyZod.nullable().optional().describe(...)`, validate, apply to game tier, clear on null
- [x] 7.2 `tools/seasons/upsertSeason.ts`: same on BOTH create and update branches, plus the per-slot tier inside `format.questions[]`
- [x] 7.3 `tools/games/setWorkspaceConfig.ts`: same on the workspace tier
- [x] 7.4 Add per-tool tests: `upsertGame.judgeLeniency.test.ts`, `upsertSeason.judgeLeniency.test.ts`, `setWorkspaceConfig.judgeLeniency.test.ts` (set / update / clear / invalid)

## 8. Read Tool (MCP)

- [x] 8.1 `tools/games/listGames.ts`: surface per-game `judgeLeniency` manually in the `AxisOverrides` block AND under `workspaceDefaults` (mirror how `hint` is surfaced at `listGames.ts:172`, since this is a flat axis not driven by the axis-bag loop)
- [x] 8.2 Add `listGames.judgeLeniency.test.ts`: game override surfaces; workspace default surfaces
- [x] 8.3 NOTE (out of scope, reported separately): `promptMedium` is a confirmed pre-existing bug — absent from `listGames` `AxisOverrides`/`workspaceDefaults`, `upsertGame`'s axis schema, and `setWorkspaceConfig`. Do NOT copy that gap; do NOT fix it in this change.

## 9. Audit Surface & Docs

- [x] 9.1 `tools/questions/findPreviousQuestions.ts`: surface stamped `judgeLeniency` in `toSearchResult` when present (it affects scoring, so it surfaces like `difficulty` — NOT like the internal-only `hint`, which is intentionally excluded) (+ test)
- [x] 9.2 `CLAUDE.md`: document the `judgeLeniency` axis in the trivia generation section — three presets, cascade, default `strict-with-typos`, stamp-on-record, reveal-only effect

## 10. Verification

- [x] 10.1 `npx tsc` — zero errors
- [x] 10.2 `npm test` — all suites pass
- [x] 10.3 Grep-completeness: compare `judgeLeniency` touch-point count against an existing axis (e.g. `hint`) across `src/plugins/trivia`; confirm all four tiers + both `list_games` surfaces + stamp + judge are present
- [x] 10.4 `openspec validate add-trivia-judge-leniency --strict`
