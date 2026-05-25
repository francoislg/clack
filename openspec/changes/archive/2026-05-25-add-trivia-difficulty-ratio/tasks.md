## 1. Types and defaults

- [x] 1.1 In `src/plugins/trivia/core/configTypes.ts`, remove `minimumThreshold` from the `DifficultyRanges` interface and from `DifficultyRangesInput`. Update the JSDoc on both types.
- [x] 1.2 In `src/plugins/trivia/core/configTypes.ts`, remove `minimumThreshold` from every entry of `DEFAULT_DIFFICULTY_RANGES` (`boolean`, `choice`, `freeform`).
- [x] 1.3 In `src/plugins/trivia/core/configTypes.ts`, add new exported types: `DifficultyBucketWeights = Record<"easy" | "medium" | "hard", number>` and `TriviaDifficultyRatioConfig = Partial<Record<"boolean" | "choice" | "freeform", DifficultyBucketWeights>>`. Add `DEFAULT_DIFFICULTY_RATIO: Record<"boolean" | "choice" | "freeform", DifficultyBucketWeights>` with `boolean: { easy: 3, medium: 6, hard: 1 }`, `choice: { easy: 3, medium: 6, hard: 1 }`, `freeform: { easy: 5, medium: 4, hard: 1 }` (freeform skewed easier — same reasoning as `DEFAULT_DIFFICULTY_RANGES.freeform`'s -2 shift).
- [x] 1.4 In `src/plugins/trivia/core/configTypes.ts`, add `difficultyRatio?: TriviaDifficultyRatioConfig` to `TriviaConfig` and to `TriviaGame`. Add JSDoc referencing the cascade.
- [x] 1.5 In `src/plugins/trivia/core/types.ts`, add `difficultyRatio?: TriviaDifficultyRatioConfig` to `SeasonEntry` and to the `FormatQuestion` slot type. Re-export `TriviaDifficultyRatioConfig` from `configTypes.js` if needed.

## 2. Validators

- [x] 2.1 In `src/plugins/trivia/core/configParsers/axes.ts`, remove the `minimumThreshold` branch and the `key !== "minimumThreshold"` clause from `validateDifficultyRangesMap`. Allowed-key error message becomes "allowed: easy, medium, hard".
- [x] 2.2 In `src/plugins/trivia/core/configParsers/axes.ts`, add `validateDifficultyBucketWeights(raw, fieldLabel)` — mirror of `validateQuestionTypeMap` but for keys `easy` / `medium` / `hard`. Non-negative integers, at least one strictly positive.
- [x] 2.3 In `src/plugins/trivia/core/configParsers/axes.ts`, add `validateTriviaDifficultyRatioMap(raw, fieldLabel)` — mirror of `validateTriviaDifficultyMap` but per-format wraps the bucket-weights validator (allowed format keys `boolean` / `choice` / `freeform`).
- [x] 2.4 In `src/plugins/trivia/core/configParsers/axes.ts`, add `difficultyRatio` to `TriviaAxisBag` and wire it into `parseTriviaAxisBag` via the existing `apply()` pattern.
- [x] 2.4b Define and export a shared `triviaDifficultyRatioZod` schema (in `src/plugins/trivia/core/configParsers/axes.ts` alongside the existing axis-bag plumbing, or in a co-located `zodSchemas.ts` if that file exists). Shape: `z.object({ boolean: bucketWeightsZod.optional(), choice: bucketWeightsZod.optional(), freeform: bucketWeightsZod.optional() })` with `bucketWeightsZod` = `z.object({ easy: z.number().int().nonnegative().optional(), medium: z.number().int().nonnegative().optional(), hard: z.number().int().nonnegative().optional() }).refine(m => Object.values(m).some(v => (v ?? 0) > 0), "at least one weight must be strictly positive")`. This zod schema is reused by `setWorkspaceConfig`, `upsertGame`, and `upsertSeason` (and the slot type inside `upsertSeason`).
- [x] 2.5 In `src/plugins/trivia/core/configParsers/axes.test.ts` (or create), add unit tests for `validateDifficultyBucketWeights` (positive cases + all-zero rejection + unknown-key rejection + non-object rejection) and `validateTriviaDifficultyRatioMap` (per-format keying + cascade through `parseTriviaAxisBag`).

## 3. Cascade resolver

- [x] 3.1 In `src/plugins/trivia/domain/difficulty.ts`, update `resolveDifficultyRanges` to drop the `minimumThreshold` merge field. Update its JSDoc.
- [x] 3.2 In `src/plugins/trivia/domain/difficulty.ts`, add `resolveDifficultyRatio(currentSeason, slotIndex, game, triviaConfig, format)` — whole-object replace cascade (slot → season → game → workspace → `DEFAULT_DIFFICULTY_RATIO[format]`). Mirror `resolveQuestionType`'s structure exactly. The fallback indexes the default by format so freeform gets its skewed-easier baseline. Add JSDoc explaining why this differs from `resolveDifficultyRanges`'s per-field merge.
- [x] 3.3 In `src/plugins/trivia/domain/difficulty.test.ts`, drop the existing `minimumThreshold` cascade test cases. Add tests for `resolveDifficultyRatio` covering each tier of the cascade and the all-tiers-absent default.

## 4. get_ideas tool

- [x] 4.1 In `src/plugins/trivia/tools/questions/getIdeas.ts`, delete the `pickSuggestedDifficulty()` helper.
- [x] 4.2 In `src/plugins/trivia/tools/questions/getIdeas.ts`, replace the `suggestedDifficulty` roll with `weightedPick(resolveDifficultyRatio(currentSeasonEntry, slotIndexForResolution, gameEntry, config, pickedAnswersFormat)) ?? "medium"` (note: the returned bucket key is lowercase `"easy"`/`"medium"`/`"hard"` — convert to the existing `"Easy"`/`"Medium"`/`"Hard"` capitalized form once at the assignment site).
- [x] 4.3 In `src/plugins/trivia/tools/questions/getIdeas.ts`, remove `minimumDifficultyThreshold` from the response `base` object. Update the `DESCRIPTION` docstring to drop the `minimumDifficultyThreshold` bullet and rewrite the `suggestedDifficulty` bullet to describe weighted-pick from cascade.
- [x] 4.4 In `src/plugins/trivia/tools/questions/getIdeas.test.ts`, drop tests that assert the 30/60/10 hardcoded distribution. Add coverage: (a) workspace `difficultyRatio` controls the roll, (b) slot-tier overrides workspace-tier, (c) default ratio fires when no tier is set, (d) response no longer carries `minimumDifficultyThreshold`.

## 5. Zod schemas for management tools

- [x] 5.1 In `src/plugins/trivia/tools/games/setWorkspaceConfig.ts`, drop the three `minimumThreshold` zod fields (lines 66, 80, 94 — one per format). Add a new `difficultyRatio` zod field with the same per-format inner structure.
- [x] 5.2 In `src/plugins/trivia/tools/games/setWorkspaceConfig.ts`, update the tool description to reference `difficultyRatio` and remove any `minimumThreshold` mentions.
- [x] 5.3 In `src/plugins/trivia/tools/games/upsertGame.ts`, drop the three `minimumThreshold` zod fields. Add `difficultyRatio` zod field. Update description.
- [x] 5.4 In `src/plugins/trivia/tools/seasons/upsertSeason.ts`, drop `minimumThreshold` from `difficultyRangesInputZod` (line ~70). Add a top-level `difficultyRatio: triviaDifficultyRatioZod.optional()` argument to the create + update branches alongside `answersFormat` / `questionType` / `contexts`. Update tool description.
- [x] 5.5 In `src/plugins/trivia/tools/seasons/upsertSeason.ts`, add slot-level `difficultyRatio` to the `format.questions[]` slot zod schema. Mirror the same shape as season-tier.
- [x] 5.6 In `src/plugins/trivia/tools/seasons/upsertSeason.ts`, add `hasDifficultyRatio: boolean` to the return shape (computed as `entry.difficultyRatio !== undefined`). Wire it into both the create and update return paths.

## 6. list_games and list_seasons surfaces

- [x] 6.1 In `src/plugins/trivia/tools/games/listGames.ts`, surface `workspaceDefaults.difficultyRatio` when `config.trivia.difficultyRatio !== undefined`. Update the tool description's return-shape comment if present.
- [x] 6.2 In `src/plugins/trivia/tools/seasons/listSeasons.ts`, surface `difficultyRatio` on each season entry AND on each slot inside `format.questions` when set. Update description.
- [x] 6.3 Update or add tests in `listGames.test.ts` / `listSeasons.test.ts` (whichever exist) covering the new field's presence/absence semantics.

## 7. Prompt rewrites

- [x] 7.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, rewrite step 6 of `QUESTION_FLOW_STEPS` (the fact-boolean flow) to encode the strict-membership + one-shot reframe + ≥2-off reject rules per design.md decision 3. Drop the `minimumDifficultyThreshold` reference. Drop the legacy "1–3 = obvious / 4–6 = balance / 7–10 = challenging" general-intuition bullet.
- [x] 7.2 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, rewrite step 5 of `CHOICE_FLOW_STEPS` (the fact-choice flow) the same way. Drop the `minimumDifficultyThreshold` reference.
- [x] 7.3 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, rewrite the difficulty gate step in `TOPICAL_BOOLEAN_FLOW_STEPS` (currently step 6, around line 164) AND in `TOPICAL_CHOICE_FLOW_STEPS` (currently step 6, around line 271 — confirmed present). Both reference `minimumDifficultyThreshold` and need the same strict-membership + reframe rewrite. Drop the `minimumDifficultyThreshold` mention from each flow's step-1 bullet list as well (lines 196 and 256).
- [x] 7.4 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, for both boolean flows (fact and topical), explicitly add a re-run polarity self-check step after the reframe. Reference step 3 (polarity self-check) by number.
- [x] 7.5 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, update the step 1 description in each flow to reference `suggestedDifficultyRange` only (drop `minimumDifficultyThreshold` from the bullet list).
- [x] 7.6 Rewrite the difficulty gate step in `FREEFORM_FACT_FLOW_STEPS` (currently step 7, around line 349) AND in `FREEFORM_TOPICAL_FLOW_STEPS` (similar step in that flow). Both reference `minimumDifficultyThreshold` (confirmed at lines 306, 349, 381 and surrounding gate steps) and need the same strict-membership + reframe rewrite. Drop the `minimumDifficultyThreshold` mention from each flow's step-1 bullet list (lines 306 and 381). Freeform flows do NOT need the polarity re-check step (that's boolean-specific).
- [x] 7.7 In `src/plugins/trivia/prompts/triviaCheckInstruction.ts`, update the `difficulty` axis description (line ~222) to reflect the new shape (no `minimumThreshold`) and add a paragraph describing the new `difficultyRatio` axis with its cascade and default.

## 8. Verification

- [x] 8.1 Run `npm run build` and resolve any TypeScript errors.
- [x] 8.2 Run `npm test` and resolve any test failures introduced by the changes (beyond the test updates already covered in earlier tasks).
- [x] 8.3 Run `npx oxlint src/plugins/trivia` and resolve any lint issues.
- [x] 8.4 Run `npx oxfmt --check src/plugins/trivia` and apply formatting fixes with `npx oxfmt src/plugins/trivia` if needed.
- [x] 8.5 Run `openspec validate add-trivia-difficulty-ratio --strict` and confirm it passes.
- [x] 8.6 Manually inspect the rendered `SEND_QUESTIONS_INSTRUCTIONS` and `PROCESS_REVEAL_INSTRUCTIONS` constants by reading `scheduledPrompts.ts` to confirm no stale references to `minimumDifficultyThreshold` or the legacy bucket-mapping table remain.
- [ ] 8.7 Update the deployment's on-disk `data/plugins/trivia/config.json` to remove any `difficulty.*.minimumThreshold` keys before deploy (manual step; no migration). Note: this only matters at the live deployment, not in the repo.
