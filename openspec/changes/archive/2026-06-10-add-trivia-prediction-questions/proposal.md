## Why

Trivia can only pose questions whose answer is already known and baked onto the record at `save_question` time. That rules out an entire class of engaging games — **predictions about future real-world events** ("Who wins tomorrow's match: A / B / Draw?"), where the outcome is unknowable until after players have committed their pick. Predictions reuse ~90% of trivia's machinery (cron pairs, button picks, reveal scoring, seasons leaderboard) — the only thing missing is a question whose answer is **deferred** and settled at reveal time.

## What Changes

- Add a third `questionType` value, **`prediction`** (mutually exclusive with `fact` and `topical`). A prediction WebSearches an *upcoming* event at generation time and is saved with **no answer key**. It composes with **every** `answersFormat` (`boolean` / `choice` / `freeform`) — for freeform the static `freeformAnswerShape` is set at save and the canonical answer spec is prepared at settle.
- **Deferred answer key.** When `questionType === "prediction"`, `save_question` persists the record without `isTrue` / `correctIndex` and stamps `resolved: false`. The per-format answer-key validation that normally runs at save time is **moved in time** to settle time — it reuses the same `AnswerTypeHandler` key-validation, not a duplicate.
- **New settle step at reveal.** A new admin-gated tool **`settle_question(questionId, outcome)`** stamps the now-known result onto a prediction record (validating `outcome` through the answer handler), sets `resolved: true`, and lets the existing reveal reprocess path re-derive each player's `correct` verdict. The reveal scheduled prompt gains a leading SETTLE step: Claude WebSearches the result for each prediction and calls `settle_question` before `process_reveal_answers`.
- **Save/settle split.** `save_question` composes only a question's STATIC fields; the answer key is composed by a single `settleOutcome` path — applied immediately at save for fact/topical, deferred for predictions. Non-prediction behavior is byte-for-byte unchanged.
- **General `invalidated` state.** `settle_question` also invalidates ANY question (`invalidate: true` + reason) — worth 0, renders "invalidated", clears existing verdicts. A prediction whose result is unknowable at reveal is invalidated; an admin can also invalidate a bad question before or after reveal. `compute_answers` refuses to score until every prediction in the batch is decided (answered or invalidated).
- **Config-forced, never surprise-rolled.** The global `questionType` default stays `{ fact: 1, topical: 0, prediction: 0 }` so existing games never emit a prediction. A prediction game opts in by setting its `questionType` weights to `{ prediction: 1 }` via the existing cascade.
- **Fixed count for v1.** Predictions ride the existing fixed `format.questions[]` slot machinery (e.g. 3 prediction slots). Data-driven "one question per match" (variable N) is explicitly a **follow-up change**, not this one.

## Capabilities

### New Capabilities
- `trivia-prediction-questions`: the `prediction` questionType (all answer formats; config-forced `0` default), the save-static / settle-answer split (one `settleOutcome` path), the `settle_question` tool (answer or invalidate), the general `invalidated` state, and click-verdict deferral.

### Modified Capabilities
- `trivia-scheduled-prompts`: the question-generation prompt gains a `prediction` path (WebSearch an upcoming event, save no answer); the reveal prompt gains a leading SETTLE step (WebSearch results → `settle_question` answer/invalidate) and renders `invalidatedQuestions`. Existing fact/topical paths are unchanged (additive).
- `trivia-reveal-processor`: the reveal processor gates on undecided predictions (`resolved: false`), renders invalidated questions at 0 points, and repaints invalidated cards. Behavior for resolved questions is unchanged (additive).

## Impact

- **New code:** `src/plugins/trivia/tools/reveal/settleQuestion.ts` (new tool) + wiring in the tool server; a `prediction` branch in the question/reveal prompt building blocks (`prompts/scheduledPrompts.ts`); answer-handler key-validation factored so it runs at settle time.
- **Schema:** `TriviaQuestion` gains `resolved?: boolean`, `resolvedOutcome?`, `resolvedAt?`, and the general `invalidated?: boolean` + `invalidatedReason?: string` (all graceful/optional — absent reads as a legacy answered question). `questionType` union/validator + `TriviaQuestionTypeWeights` gain `"prediction"` (default weight `0`).
- **Touched flows:** `save_question` (compose static; settle answer), `settle_question` (new), `compute_answers` (decision gate + invalidated render), `update_answers_block` (invalidated card), the answer-format handlers (`composeStatic` / `settleOutcome` / `settleInputFromSaveArgs` / `hasAnswerKey`; `resolveClick` defers the verdict when keyless), and the scheduled prompts.
- **Config:** opt-in per game via existing `questionType` cascade weights; zero behavior change for games that don't set them.
- **Out of scope:** dynamic per-match question count, an auto catch-up cron for late results, a dedicated predictions leaderboard surface (seasons already aggregates points).
