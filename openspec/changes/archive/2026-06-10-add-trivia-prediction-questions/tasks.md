## 1. Schema & questionType value

- [x] 1.1 Add `"prediction"` to the `questionType` union/validator/keys and `TriviaQuestionTypeWeights`; default `{ fact: 1, topical: 0, prediction: 0 }`.
- [x] 1.2 Add optional `resolved?`, `resolvedOutcome?`, `resolvedAt?`, `invalidated?`, `invalidatedReason?` to `TriviaQuestion` (graceful — absent reads as a legacy answered question).

## 2. Save-static / settle-answer split (answer-format handlers)

- [x] 2.1 Split each `AnswerTypeHandler` into `composeStatic` (static fields, no key), `settleInputFromSaveArgs` (extract answer fields), and `settleOutcome` (the single answer-key composer). Add `hasAnswerKey`. `resolveClick` returns an undefined verdict when the key is absent.
- [x] 2.2 The questionType handler owns the compose strategy via `composeSavedQuestion` (`composeWithKey` = static + immediate settle for fact/topical; `composeDeferred` = static only for prediction). `save_question` never branches on the type. Freeform is supported.

## 3. `settle_question` tool

- [x] 3.1 `tools/reveal/settleQuestion.ts` — admin; EXACTLY ONE of `outcome` (answer a pending prediction via `settleOutcome`) or `invalidate` + `invalidatedReason` (mark any question invalidated + clear its verdicts). Registered + reveal `requiredTools`.

## 4. Reveal processor & cards

- [x] 4.1 `compute_answers` gate (default mode): refuse with `UNDECIDED_PREDICTIONS` when any prediction is `resolved: false`. Drop the transient `skipPredictions` arg.
- [x] 4.2 `compute_answers` renders `invalidated` questions in `invalidatedQuestions` (0 points, `processedAt` stamped, absent from `reveals`); settled predictions derive the verdict on pending rows.
- [x] 4.3 `update_answers_block` repaints invalidated cards (`editInvalidatedIntoCard`); `reveal.invalidated` i18n string (en + fr).

## 5. Scheduled prompts

- [x] 5.1 PREDICTION MODIFIER in `scheduledPrompts.ts` (WebSearch upcoming event → draft → `save_question` with `sourceUrl`, no key); dispatch matrix + `get_ideas` description updated.
- [x] 5.2 Reveal prompt leading SETTLE step (settle answer / invalidate per `UNDECIDED_PREDICTIONS`) + `invalidatedQuestions` rendering.

## 6. Tests & verification

- [x] 6.1 `save_question.prediction` tests (defer key per format incl. freeform; reject answered-with-key; reject no sourceUrl).
- [x] 6.2 `settle_question` tests (answer + invalidate, validation, verdict clearing, mutual exclusion).
- [x] 6.3 `compute_answers` prediction/invalidation tests (gate, settled-derive, invalidated render); existing handler tests migrated to `composeWithKey`.
- [x] 6.4 `npx tsc`, `npx oxlint`, `npx oxfmt --check`, full `npm test` (5682 passing) all green.
