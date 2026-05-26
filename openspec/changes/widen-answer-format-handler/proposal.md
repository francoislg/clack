## Why

The `unify-trivia-button-answers` change introduced a per-format `AnswerTypeHandler` abstraction (`src/plugins/trivia/answerTypes/`) and routed the interaction half of the question lifecycle through it (`post_questions`, vote-handler click resolution, roster grouping, `process_reveal_answers`). The abstraction stops there. Five other consumers still branch on format strings, which means adding a future format (e.g. a fifth answer-shape) requires touching every one of these files instead of registering one handler.

In addition, `get_question_history` has a latent bug introduced when `"freeform"` was added: the tool branches `isChoice ? choiceShape : booleanShape`, so freeform questions are silently returned with `answersFormat: "boolean"` and `isTrue: false`. Two callers also destructure handler return values (the click-resolution `AnswerPayload` union and the historically-fixed `vote:` / `freeform-answer:` action_id shapes), which forces the caller to know every format's wire shape.

This change extends the handler interface to cover the remaining lifecycle points, fixes the freeform history bug, and makes the click-resolution payload and action_id ownership opaque to callers — so a new format can be added by writing one handler file and registering it.

## What Changes

- **Extend `AnswerTypeHandler`** with four new methods so the registry owns the full question lifecycle:
  - `getSavedQuestion(base, args, ctx)` — single combined method that validates per-format args AND composes the persistable `TriviaQuestion` in one step. Returns `{ ok: true, question }` or `{ ok: false, error }`. Replaces what would have been two methods (`validateSaveArgs` + `buildQuestionRecord`) — keeping them collapsed eliminates the "did I validate before composing?" trap and halves the type surface.
  - `rollGenerationSuggestions(deps)` — per-format roll metadata (`suggestedAnswer` for boolean, `suggestedChoiceCount` + `suggestedCorrectIndex` for choice, `suggestedFreeformAnswerShape` for freeform)
  - `buildHistoryResult(question, answers, users)` — per-format projection for `get_question_history`
  - `registerInteractions(sdk, deps)` — each handler registers its own action-id regex (`vote:*` for boolean/choice, `freeform-answer:*` for freeform); the caller no longer hardcodes the action_id shape
- **Add `toAnswerPatch(resolved)` to `ClickableAnswerHandler`** — converts a `ResolvedClick` into the `Partial<SubmittedAnswer>` to persist; replaces the caller's `"answer" in scored.payload` / `"answerIndex" in scored.payload` destructuring.
- **Make `ResolvedClick.payload` private.** The union type is now declared inside `types.ts` but no longer exported. `AnswerPayload` is removed from the public surface. Callers receive `ResolvedClick` and thread it back into `toAnswerPatch`.
- **Source `SaveQuestionArgs` from a shared Zod schema fragment** (`answerTypes/saveSchema.ts`) so the tool's input type and the handler's input type are the same `z.infer<>` — no `as` cast needed at the handler boundary.
- **Refactor `saveQuestion.ts`** to assemble `TriviaQuestionBase` (cross-format fields) then call `handler.getSavedQuestion(base, args, ctx)`. Cross-format checks (statement length / emojis / slot / category / context / fact-vs-topical) stay in the tool.
- **Refactor `getIdeas.ts`** to delegate per-format suggestion rolling. The `weightedPick(answersFormatWeights)` itself stays in the tool — only the post-pick suggestion attachment moves into the handler.
- **Fix `get_question_history`** for freeform: route the response shape through the handler. Freeform now returns `{ answersFormat: "freeform", expectedAnswer, acceptableAnswers?, gradingNotes?, responses: [{ userId, displayName, answerText, correct?, judgeReason? }] }` (matching the data shape that already exists on disk). Boolean/choice shapes are unchanged.
- **Push action-id ownership into the handler.** `registerInteractiveHandlers` becomes a thin registry loop that calls `handler.registerInteractions(sdk, deps)` on each registered handler. The vote-handler body lives in a shared `clickHandlerInstaller.ts` helper consumed by `boolean.ts` + `choice.ts`; the freeform modal-trigger flow lives in `freeform.ts`.
- **Split `answerTypes/_helpers.ts`** into four scoped modules along its natural concern seams: `revealMessage.ts` (Slack I/O), `cheaterFilter.ts` (cheat filtering), `reactorBuckets.ts` (reactor-side computations), `revealOutcome.ts` (output packager). The leading-underscore "internal helpers" name was already a signal this module was a junk drawer; splitting keeps future additions in their rightful module.

## Capabilities

### New Capabilities

(none — extends existing capabilities only)

### Modified Capabilities

- `trivia-question-posting`: `post_questions` is unchanged at the spec level; the implementation refactor moves action-id registration into the per-format handlers but the resulting Slack message shape is identical.
- `trivia-question-search`: `get_question_history` SHALL return a freeform-shaped response for freeform questions instead of silently returning the boolean fallback shape. The boolean/choice response shapes are unchanged.
- `trivia-scheduled-prompts`: no observable change. The prompt continues to receive the same per-format `suggested*` roll metadata from `get_ideas`; the refactor only changes how that metadata is assembled internally.

## Impact

- **Affected code**:
  - `src/plugins/trivia/answerTypes/types.ts` — interface extension; remove `AnswerPayload` export; make `ResolvedClick.payload` a file-internal union
  - `src/plugins/trivia/answerTypes/saveSchema.ts` (NEW) — shared Zod schema fragment + `SaveQuestionArgs` `z.infer<>`
  - `src/plugins/trivia/answerTypes/clickHandlerInstaller.ts` (NEW) — shared `^vote:...$` action registrar consumed by boolean and choice
  - `src/plugins/trivia/answerTypes/{revealMessage,cheaterFilter,reactorBuckets,revealOutcome}.ts` (NEW × 4) — `_helpers.ts` split into scoped modules
  - `src/plugins/trivia/answerTypes/_helpers.ts` (DELETED) — content moved to the four split modules
  - `src/plugins/trivia/answerTypes/boolean.ts`, `choice.ts`, `freeform.ts` — implement four new handler methods (plus `toAnswerPatch` on the two clickable formats); update imports for the helper split
  - `src/plugins/trivia/answerTypes/registry.ts` — add `getAllAnswerTypeHandlers()`; existing `getAnswerTypeHandler` unchanged
  - `src/plugins/trivia/tools/questions/saveQuestion.ts` — delegate per-format work to the handler (`getSavedQuestion`); the tool's schema sources fields from `SAVE_QUESTION_HANDLER_FIELDS`; trim by ~120 lines
  - `src/plugins/trivia/tools/questions/getIdeas.ts` — delegate per-format suggestion attachment to the handler
  - `src/plugins/trivia/tools/questions/getQuestionHistory.ts` — delegate response shape to the handler; fix the freeform fall-through bug
  - `src/plugins/trivia/freeform/handlers.ts` — `registerInteractiveHandlers` becomes a thin registry loop; vote-handler body lives in the new `clickHandlerInstaller.ts`; freeform modal-trigger logic moves into `freeform.ts`
  - `src/plugins/trivia/index.ts` — no signature change at the entry point
  - Tests across the trivia plugin — `boolean.test.ts`, `choice.test.ts`, `freeform.test.ts` gain coverage for the new methods; `getQuestionHistory.test.ts` gains a freeform regression test (the bug fix); existing tests unchanged. Total: 27 new tests, 668 tests passing
- **Affected data**: none — the on-disk shape of `questions.json`, `answers.json`, etc. is identical
- **External APIs**: none — Slack action-id wire format is preserved (`plugin:trivia:vote:<id>:<value>` and `plugin:trivia:freeform-answer:<id>` stay exactly as they are)
- **Bug fix**: pre-existing freeform-falls-through-to-boolean shape in `get_question_history` is corrected as part of this change
