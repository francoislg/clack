## 1. Split the slot tier in the cascade context

- [x] 1.1 In `core/cascadeAxes.ts`, replace `CascadeContext.slot` with `gameSlot: CascadeAxes | null` and `seasonSlot: CascadeAxes | null`; add both to `ConcreteTier`, `CascadeTier`, and the ladder entry types.
- [x] 1.2 Update `CASCADE_TIER_ORDER` to `["seasonSlot", "season", "gameSlot", "game", "workspace"]`.
- [x] 1.3 In `domain/cascadeContext.ts`, build `gameSlot` from `game.format?.questions[slotIndex] ?? null`; build `seasonSlot` by reading `season.slotOverrides?.[slotIndex]` if present, else `season.format?.questions[slotIndex]` if the season declares its own format, else `null` (mutual exclusivity of the two season mechanisms is enforced at parse time per 6.2, so the builder never sees both). Document the game-base/season-override model and the two season-slot sources in the file header.

## 2. Make resolveCascade honest and 6-tier

- [x] 2.1 Update `firstWins` / `tierObjects` in `domain/resolveCascade.ts` to walk the new 5 concrete tiers in order.
- [x] 2.2 Rewrite the custom resolvers (`difficulty`, `difficultyRatio`, `additionalInstructions`) to compute `value` from the context tier objects (`ctx.seasonSlot → ctx.season → ctx.gameSlot → ctx.game → ctx.config`) — the same tiers the ladder reports — so value ≡ ladder (Decision 5).
- [x] 2.3 Change the signatures of the legacy merge fns (`resolveDifficultyRanges`/`resolveDifficultyRatio`) from `(season, slotIndex, …)` to accept the already-resolved slot objects (`seasonSlot`, `gameSlot`) — per Decision 5(b), keep their per-field-merge/keyed-replace logic but make slot re-derivation structurally impossible. No body reads `season.format.questions[...]`.

## 3. Route get_ideas + the freeform handler through resolveCascade

- [x] 3.1 Collapse `SuggestionRollDeps` to `{ cascadeCtx }` in `answerTypes/types.ts`.
- [x] 3.2 `answerTypes/freeform.ts`: `rollGenerationSuggestions` returns `{}` (no shape roll); delete its `resolveFreeformAnswerShape` use.
- [x] 3.3 `answerTypes/choice.ts`: read choice bounds from `deps.cascadeCtx.config`. `answerTypes/boolean.ts`: unchanged behavior, new deps shape.
- [x] 3.4 `tools/questions/getIdeas.ts`: resolve `freeformAnswerShape` via `resolveCascade("freeformAnswerShape", cascadeCtx)` (rolled only when `pickedAnswersFormat === "freeform"`); pass `{ cascadeCtx }` to the handler.

## 4. Route save_question through resolveCascade

- [x] 4.1 In `tools/questions/saveQuestion.ts`, build `cascadeCtx` via `buildCascadeContext` and resolve `answersFormat`, `questionType`, `contexts`, `judgeLeniency` through `resolveCascade`; delete the legacy-resolver calls.
- [x] 4.2 Verify the freeform `judgeLeniency` stamping still resolves identically (now via the canonical path) and stamps only on non-default.

## 5. Route process_reveal_answers through resolveCascade

- [x] 5.1 In `tools/reveal/processRevealAnswers.ts`, build a `CascadeContext` from the first target's slot index and resolve `instructions` + `additionalInstructions` via `resolveCascade`; delete the legacy-resolver calls.

## 6. Season slotOverrides config

- [x] 6.1 Add `slotOverrides?: Record<number, PartialSlotAxes>` to the season type (`core/configTypes.ts` / season entry type).
- [x] 6.2 Parse + validate `slotOverrides` (reuse the slot-axis validators from `configParsers/format.ts`); reject when both `slotOverrides` and `format` are set on one season (Decision 3, v1 mutual exclusivity).
- [x] 6.3 `buildCascadeContext` reads `seasonSlot[i]` from `season.slotOverrides[i]` (and from `season.format.questions[i]` when the season declares its own format).
- [x] 6.4 Surface `slotOverrides` in `list_seasons` and accept it in `upsert_season`; admin instruction notes the "make question N do X this season" → keyed-delta mapping.

## 7. Delete legacy per-axis resolvers (explicit deliverable)

- [x] 7.1 Delete `resolveAnswersFormat`, `resolveQuestionType`, `resolveContexts`, `resolveFreeformAnswerShape`, `resolveInstructions`, `resolveAdditionalInstructions`, `resolvePromptMedium`, `resolveJudgeLeniency`, `resolveHintConfig` (and any now-orphaned helper); fold the slot-re-deriving bodies of `resolveDifficultyRanges`/`resolveDifficultyRatio` into the custom resolvers. Delete their tests or fold them into the resolveCascade tests. (`resolveHintConfig` in `domain/hint.ts` is already dead — `hint` resolves via `resolveCascade("hint", ctx)` in `getIdeas.ts`; remove it and migrate `hint.test.ts`/`resolveCascade.test.ts`'s oracle usage. Do NOT delete the non-cascade `resolveTheme`/`resolveAllTimeRow` or the retained `resolveEffectiveFormat` and the `difficultyMeetsThreshold`/`effectiveHintMode` helpers in `hint.ts`.)
- [x] 7.2 Add a structural guard (test or lint rule over `src/plugins/trivia/domain`) asserting none of the named legacy resolvers is exported/defined and no resolver re-derives a slot via `currentSeason.format.questions[...]` outside `buildCascadeContext`/`resolveEffectiveFormat`.

## 8. Tests — parity is the headline

- [x] 8.1 Cross-tool parity tests over a game that defines a `format` with per-slot overrides and NO active season (maps to the three spec parity scenarios):
  - [x] 8.1a Generation: `explain_cascade`'s `value` equals what `get_ideas` rolls from for `answersFormat`, `questionType`, `promptMedium`, `freeformAnswerShape`.
  - [x] 8.1b Validation: `explain_cascade`'s `value` equals what `save_question` validates against for `answersFormat`, `questionType`, `contexts`, `judgeLeniency`.
  - [x] 8.1c Reveal: `explain_cascade`'s `value` equals what `process_reveal_answers` resolves for `instructions`, `additionalInstructions`.
- [x] 8.2 `value ≡ ladder` test for each custom axis at a `(gameSlot, seasonSlot)` coordinate (winning tier reported matches the tier the value came from).
- [x] 8.3 `slotOverrides` tests: keyed merge over game slot by index, count unchanged, mutual-exclusivity rejection, slot-count-mismatch fall-through.
- [x] 8.4 Updated handler `rollGenerationSuggestions` tests (`{ cascadeCtx }` deps; freeform returns `{}`).
- [x] 8.5 Cascade characterization matrix updated to the game-base/season-override model (replaces the prior "outcomes preserved" matrix).

## 9. Spec + docs

- [x] 9.1 Update the CLAUDE.md "Trivia cascade registry" section to satisfy the "Project documentation describes the unified cascade" requirement: replace the current 4-tier `slot → season → game → workspace → built-in default` walk and the "slot tier reads from the EFFECTIVE format (`season.format ?? game.format`)" paragraph with the 6-tier `seasonSlot → season → gameSlot → game → workspace → built-in default` walk under the game-base/season-override model; document season `slotOverrides` (sparse, count-decoupled, mutually exclusive with `format`); state the single resolution path across all five consumers (`get_ideas`, `save_question`, `post_questions`, `process_reveal_answers`, `explain_cascade`).
- [x] 9.2 `npx tsc`, `npx oxlint`, `npx oxfmt --check`, full `npm test` green.
- [x] 9.3 `openspec validate unify-trivia-cascade-resolution --strict`.
