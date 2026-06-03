## 1. Extend the AnswerTypeHandler interface

- [x] 1.1 In `src/plugins/trivia/answerTypes/types.ts`, add to `AnswerTypeHandler`:
  - `getSavedQuestion(base, args, ctx): { ok: true; question: TriviaQuestion } | { ok: false; error: string }` — collapsed validate-and-compose
  - `rollGenerationSuggestions(deps): Record<string, JsonValue>`
  - `buildHistoryResult(question, matching, users): JsonValue`
  - `registerInteractions(sdk, deps): void`
- [x] 1.2 In the same file, add `toAnswerPatch(resolved): Partial<SubmittedAnswer>` to `ClickableAnswerHandler`
- [x] 1.3 Remove the public `AnswerPayload` export; make the union a file-internal type (`ClickPayload`) used only inside `types.ts`. `ResolvedClick` stays exported but its `payload` field is now opaque to consumers.
- [x] 1.4 Add `src/plugins/trivia/answerTypes/saveSchema.ts` — Zod schema fragments (`SAVE_QUESTION_HANDLER_FIELDS`) and the inferred `SaveQuestionArgs` type. Eliminates the cast at the tool↔handler boundary.
- [x] 1.5 Add supporting types in `types.ts`: `SaveValidationContext`, `TriviaQuestionBase`, `SuggestionRollDeps`, `InteractionRegistrationDeps`, `GetSavedQuestionOutcome`.

## 2. Implement the new methods per handler

- [x] 2.1 `boolean.ts`: `getSavedQuestion` (validates AND composes; rejects every cross-format collision), `toAnswerPatch` (clears sibling fields), `rollGenerationSuggestions` (returns `{ suggestedAnswer: Math.random() < 0.5 }`), `buildHistoryResult` (existing boolean shape), `registerInteractions` (calls `installClickableVoteHandler` with `^vote:[^:]+:(true|false)$`).
- [x] 2.2 `choice.ts`: same set. `getSavedQuestion` includes all bounds/dedupe/correctIndex-range checks; `rollGenerationSuggestions` returns `{ suggestedChoiceCount, suggestedCorrectIndex }` rolled within active bounds; `registerInteractions` uses `^vote:[^:]+:[0-9]+$`.
- [x] 2.3 `freeform.ts`: same set. `getSavedQuestion` validates `expectedAnswer` ≤ 200 chars, `freeformAnswerShape` required, `acceptableAnswers` ≤ 200 chars each, `gradingNotes` ≤ 500 chars; `rollGenerationSuggestions` returns `{ suggestedFreeformAnswerShape }` rolled from the cascade; `buildHistoryResult` returns the NEW freeform shape (fixes the silent fall-through bug); `registerInteractions` registers `^freeform-answer:[^:]+$` AND the matching `^freeform-modal:[^:]+$` view-submit (moved from `freeform/handlers.ts`).
- [x] 2.4 Add `getAllAnswerTypeHandlers()` to `registry.ts` returning the three handlers in a stable iteration order.

## 3. Refactor saveQuestion.ts

- [x] 3.1 Source the schema fields from `SAVE_QUESTION_HANDLER_FIELDS` (spread into the tool's schema alongside `game`). The Zod-inferred args type is now identical to `SaveQuestionArgs`; no cast at the handler boundary.
- [x] 3.2 Delete the per-format validation block (was ~110 lines).
- [x] 3.3 Delete the per-format ternary record composition (was ~16 lines).
- [x] 3.4 Replace both with a single `handler.getSavedQuestion(base, args, { config })` call. The tool assembles `TriviaQuestionBase` (cross-format fields) and threads it through; the handler returns the complete `TriviaQuestion` or an error.
- [x] 3.5 The cross-format checks (statement length / emoji count / slot / category / context / fact-vs-topical / slot-axis weight) remain inline in the tool.

## 4. Refactor getIdeas.ts

- [x] 4.1 Delete the post-pick `if (pickedAnswersFormat === "choice") / "freeform"` conditional metadata blocks (was ~25 lines).
- [x] 4.2 Replace with `const handler = getAnswerTypeHandler(pickedAnswersFormat); return textResult({ ...base, ...handler.rollGenerationSuggestions(deps) });`
- [x] 4.3 Remove now-unused imports (`getActiveChoiceBounds`, `resolveFreeformAnswerShape`, `TriviaFreeformAnswerShape`, `randomIntInclusive`).

## 5. Fix getQuestionHistory.ts

- [x] 5.1 Delete the `isChoice ? choiceShape : booleanShape` branch and the `BooleanResponseEntry` / `ChoiceResponseEntry` interfaces.
- [x] 5.2 Replace with `const handler = getAnswerTypeHandler(question.answersFormat); const payload = handler.buildHistoryResult(question, matching, users); return textResult({ ...payload, questionType, cheaterUserIds, ...extras });`
- [x] 5.3 Update the tool description to document all three response shapes (boolean / choice / freeform) and the `judgeReason` field for freeform.
- [x] 5.4 Add a regression test asserting `get_question_history` on a freeform question returns the freeform shape — proves the bug fix at the integration boundary.

## 6. Refactor freeform/handlers.ts to a registry loop

- [x] 6.1 Add `src/plugins/trivia/answerTypes/clickHandlerInstaller.ts` with `installClickableVoteHandler(sdk, handler, deps, valuePattern)` owning the shared boolean/choice vote-handler body (parse, scope, lockout, cheater check, `resolveClick`, `toAnswerPatch`, persist, refresh).
- [x] 6.2 In `boolean.ts` and `choice.ts`, implement `registerInteractions` by calling `installClickableVoteHandler` with their format-scoped value pattern.
- [x] 6.3 In `freeform.ts`, implement `registerInteractions` by moving the modal-trigger body and the view-submit handler from the old `handlers.ts`.
- [x] 6.4 Rewrite `freeform/handlers.ts` to a 35-line registry loop: `for (const handler of getAllAnswerTypeHandlers()) handler.registerInteractions(deps.sdk, ...)`. All the per-format code is now in `answerTypes/`.
- [x] 6.5 Delete `extractVoteFromActionId`, `extractQuestionIdFromActionId`, `findGameForQuestion`, `registerVoteHandler`, `registerFreeformHandlers`, and the local `FreeformHandlerDeps` shadow type from `handlers.ts` — they're either moved into the handlers/installer or no longer needed.
- [x] 6.6 `index.ts`'s single call to `registerInteractiveHandlers` is unchanged.

## 7. Split _helpers.ts into scoped modules

- [x] 7.1 Add `src/plugins/trivia/answerTypes/revealMessage.ts` — Slack-side I/O (`parseMessageCoordinates`, `fetchQuestionReactions`).
- [x] 7.2 Add `src/plugins/trivia/answerTypes/cheaterFilter.ts` — cheat filtering (`loadQuestionCheaterIds`, `buildExcludeSet`, `isScoredAnswer`).
- [x] 7.3 Add `src/plugins/trivia/answerTypes/reactorBuckets.ts` — reactor-side computations (`buildReactorIndex`, `buildReactionsList`, `buildNoAnswerBucket`).
- [x] 7.4 Add `src/plugins/trivia/answerTypes/revealOutcome.ts` — output packager (`makeRevealOutcome`).
- [x] 7.5 Delete `src/plugins/trivia/answerTypes/_helpers.ts`. Update the three handler files to import from the four new scoped modules directly (no re-export façade — would violate the "never re-export for convenience" rule).

## 8. Spec deltas

- [x] 8.1 Write `openspec/changes/widen-answer-format-handler/specs/trivia-question-search/spec.md` modifying the `get_question_history` requirement: dispatch on `answersFormat`, freeform now returns its own shape with `expectedAnswer` / `acceptableAnswers?` / `gradingNotes?` / per-row `answerText` + optional `correct` + optional `judgeReason`. Includes scenarios for boolean/choice/freeform, pending freeform rows, mixed-state freeform rows, and the topical/context cross-format extras.
- [x] 8.2 No spec changes needed for `trivia-question-posting`, `trivia-choice-questions`, `trivia-freeform-questions`, or `trivia-scheduled-prompts` — the refactor preserves the observable behavior of each.
- [x] 8.3 Run `openspec validate widen-answer-format-handler --strict` — passes.

## 9. Per-handler new-method tests

- [x] 9.1 `boolean.test.ts` — 9 new tests covering `getSavedQuestion` (happy path, missing isTrue, choices/correctIndex/expectedAnswer cross-format collisions), `rollGenerationSuggestions` (returns boolean), `toAnswerPatch` (clears siblings), `buildHistoryResult` (responses with correct, pending without correct).
- [x] 9.2 `choice.test.ts` — same shape for choice. Includes bounds/dedupe/range-check coverage.
- [x] 9.3 `freeform.test.ts` — same shape for freeform. Includes optional-field composition and the freeform-history projection (the bug-fix path).
- [x] 9.4 `getQuestionHistory.test.ts` — added the regression test for the freeform fix. Covers correct/incorrect/pending rows in one assertion.

## 10. Verification

- [x] 10.1 `npx tsc --noEmit` is clean
- [x] 10.2 `npm test -- src/plugins/trivia` — 668 tests pass (27 new tests added)
- [x] 10.3 `npx oxlint src/plugins/trivia/` — 0 warnings, 0 errors
- [x] 10.4 `npx oxfmt src/plugins/trivia/` — applied
- [x] 10.5 Grep proves the gap is closed: `grep -rn 'answersFormat ===\|"answer" in scored.payload\|"answerIndex" in scored.payload' src/plugins/trivia/` returns hits ONLY in (a) `=== null` clear-axis checks in admin config-update tools (`upsert_season`, `upsertGame`, `setWorkspaceConfig` — these are about clearing a config FIELD, not branching on the format dimension), and (b) a docstring in `core/types.ts`. Zero hits in tools, handlers, or anywhere else that would need to change for a new format.
