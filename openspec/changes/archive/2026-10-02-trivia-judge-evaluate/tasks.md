## 1. `evaluate` preset value

- [x] 1.1 Add `"evaluate"` to `JudgeLeniency` / `JUDGE_LENIENCY_KEYS` in `core/configTypes.ts`; fix every exhaustive `Record<JudgeLeniency, …>` the compiler flags
- [x] 1.2 Update the `judgeLeniency` validator + zod in `core/configParsers/axes.ts` (error lists four presets); extend `core/configParsers/judgeLeniency.test.ts`
- [x] 1.3 Update the `judgeLeniency` argument descriptions in `upsert_game`, `upsert_season` (incl. slot and phase tiers — confirm the phase tier accepts it), `set_workspace_config`, and the `list_games` / `find_previous_questions` docs to name four presets and describe `evaluate`; extend their tests with an `evaluate` set/read case
- [x] 1.4 Confirm `save_question` stamps `evaluate` and `compute_answers` reprocess re-stamps it; add cases to `saveQuestion.judgeLeniency.test.ts` and `computeAnswers.test.ts`

## 2. Judge prompt and model

- [x] 2.1 In `freeform/judge.ts`, split `SHARED_RULES` into universal integrity rules and a per-preset judging-basis block; keep the assembled text for the three existing presets carrying the same rules
- [x] 2.2 Add the evaluate basis (reference solution, every-clue fit test, no-stretch and too-broad rejections, one-idea vs hedge clarification) and compose it with the knows-it fragment for `evaluate`
- [x] 2.3 Allow `reason: "alternate-solve"` on a correct verdict in the output rules for `evaluate`; keep `parseSingleVerdict` accepting it
- [x] 2.4 Add a Sonnet-tier judge model constant and select the model from the question's preset in `judgeAnswer`
- [x] 2.5 Extend `freeform/judge.test.ts`: prompt content per preset (evaluate basis present only under `evaluate`, materially-different rule absent under `evaluate`), model per preset, exact-match short-circuit under `evaluate`, `alternate-solve` parsing. Pin the three evaluate-basis scenarios as prompt assertions (the model is mocked): hole / "Credit/Loan" → the prompt carries the every-clue acceptance rule and the near-synonyms-are-one-answer clarification; coffin / "Life insurance" → the prompt carries the any-clue-fails rejection; "hole or debt" → the prompt keeps the multi-guess rejection for distinct ideas

## 3. One verdict per distinct answer

- [x] 3.1 Expose the answer-text normalization used by `isExactMatch` from `freeform/normalize.ts` as a grouping key
- [x] 3.2 Group submissions by that key in `judgeSubmissions`, judge one representative per group, fan the verdict (or `null`) out to every submission
- [x] 3.3 Tests in `freeform/judge.test.ts`: same-answer pair → one call and shared verdict; distinct answers → separate calls; exhausted retries → every row in the group `null`

## 4. `judgeInstructions` axis

- [x] 4.1 Add `judgeInstructions?: string` to `CascadeAxes` (`core/cascadeAxes.ts`) and the `AXIS_KEYS` tuple; register it in `AXIS_REGISTRY` (`domain/resolveCascade.ts`) with a cumulative resolver shared with `additionalInstructions` (no duplicated concat logic)
- [x] 4.2 Accept it in the config parsers for every tier (workspace in `configBridge.ts`, game in `configParsers/games.ts`, slot in `configParsers/format.ts`, phase in `configParsers/phases.ts`, season via the inline season-tier validation in `tools/seasons/upsertSeason.ts`) reusing the `additionalInstructions` normalizer and zod; `cascadeParity.test.ts` passes
- [x] 4.3 Add resolver tests in `domain/resolveCascade.test.ts`: absent, single tier, stacked tiers with labels and order
- [x] 4.4 Add the write surface to `upsert_game`, `upsert_season` (season, slot, and phase tiers), and `set_workspace_config` with omit-to-keep / null-to-clear; add a per-axis test file for each tool
- [x] 4.5 Confirm `list_games` and `explain_cascade` surface it (both are `AXIS_KEYS`-driven); add a test for each
- [x] 4.7 `tools/seasons/listSeasons.ts` hand-lists its fields: add `judgeInstructions` and `judgeLeniency` to `ListSeasonsSlotEntry`, `mapSlot()`, and the season-entry mapping (mirroring `additionalInstructions`); add tests
- [x] 4.6 Update the `additionalInstructions` argument descriptions in the three write tools to state it does not reach the freeform judge and point at `judgeInstructions`

## 5. Wire judge instructions into reveal

- [x] 5.1 Add an optional resolved judge-instructions field to `ProcessRevealDeps` (`answerTypes/types.ts`)
- [x] 5.2 In `tools/reveal/computeAnswers.ts`, build the per-question cascade context (the `buildCascadeContext(...)` call reprocess re-stamping already makes, from the question's own stamped season, slot index, and phase) in default mode as well as reprocess mode, resolve `judgeInstructions` from it, and pass it on that question's reveal deps — not from the batch-level context anchored on the first target
- [x] 5.3 Thread it from `freeformAnswerHandler.processReveal` through `judgeSubmissions` / `judgeAnswer` into `buildSingleJudgePrompt`: labeled heading in the user message, authority statement in the system prompt that depends on the preset
- [x] 5.4 Tests: `judge.test.ts` (instructions present/absent, authority wording per preset), `answerTypes/freeform.test.ts` (handler passes the deps value to the judge), `computeAnswers.test.ts` (resolution from the stamped season; reprocess uses the current value)

## 6. Alternate solves at reveal

- [x] 6.1 Flag correct freeform voters whose `judgeReason` is `alternate-solve` in the reveal projection (`buildFreeformVoters` / `projectReveal`) and document the flag in the `process_reveal_answers` payload description
- [x] 6.2 Add the "name accepted alternate answers" directive to the freeform reveal section of `prompts/scheduledPrompts.ts`
- [x] 6.4 Carry the flag into the teams projection (`tools/reveal/teamVoters.ts`: `alternateSolve` + `alternateAnswerTexts` on team entries), cover it in the reveal directive, and prove the `byTeam` slot path keeps `judgeReason`
- [x] 6.3 Tests: projection flags alternates and leaves on-key correct voters unflagged

## 7. Admin guidance and docs

- [x] 7.1 In `prompts/triviaCheckInstruction.ts`, add a judging-levers section to `TRIVIA_MANAGEMENT_INSTRUCTION`: `judgeLeniency` presets incl. `evaluate`, `judgeInstructions`, and the fact that `additionalInstructions` does not reach the judge. In its "Correcting an already-posted batch" section, state that `judgeInstructions` is not stamped (an edit reaches every not-yet-revealed question; only an already-revealed one needs a reprocess), unlike `revealResponses` / `judgeLeniency`
- [x] 7.2 Update `CLAUDE.md`: judge-leniency paragraph (four presets, evaluate basis, model, shared verdict, `alternate-solve`), a `judgeInstructions` paragraph, and the cascade-registry member count/list
- [x] 7.3 Update `.claude/skills/add-trivia-attribute/SKILL.md`: the `judgeLeniency` preset list, and its worked example so it describes `judgeLeniency` as a `CascadeAxes` / `AXIS_REGISTRY` member resolved through `resolveCascade` (no standalone `domain/judgeLeniency.ts`)

## 8. Verification

- [x] 8.1 `npx tsc --noEmit`, `npx oxlint` and `npx oxfmt --check` on changed files, `npm test`
- [x] 8.2 `openspec validate trivia-judge-evaluate --strict`
- [x] 8.3 `graphify update .`
