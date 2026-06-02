## 1. Make the round scoreboard mode-independent

- [x] 1.1 Rewrite `src/plugins/trivia/tools/reveal/roundSummary.ts` so `computeRoundSummary(revealedQuestionIds, scoredAnswers, displayNameFor)` derives the aggregate from scored answers (`{ questionId, userId, correct }[]`) instead of the redacted `voters`. Dedupe per (question, user); `correct`/`answered`/`roundMvp` + sort unchanged.
- [x] 1.2 In `processRevealAnswers.ts`, build `scoredRoundAnswers` from `refreshedAnswers` restricted to revealed question IDs, filtering each row with `isScoredAnswer(row, cheaterIds, botUserId)` (cheats grouped per question). Remove the `revealResponses`-based gate entirely.
- [x] 1.3 ALWAYS include `roundSummary` in the result (no presence gate). `perPlayer` is empty when nobody answered; `totalQuestions === reveals.length`.
- [x] 1.4 Make `ProcessRevealResult.roundSummary` a required field in `types.ts`; update the `RoundSummaryEntry` field docs to the scored-answer semantics.

## 2. Update the tool-facing payload doc string

- [x] 2.1 In `processRevealAnswers.ts`, rewrite the `roundSummary` line in `DESCRIPTION`: ALWAYS present, aggregate from scored answers, independent of `revealResponses`, cheaters excluded, empty `perPlayer` when nobody answered.

## 3. Update the reveal prompt contract

- [x] 3.1 In `scheduledPrompts.ts`, describe `roundSummary` as ALWAYS present and mode-independent; gate the "This Round" row and "Round Summary" block on `roundSummary.perPlayer` being non-empty.
- [x] 3.2 Remove every `revealResponses`-based gating clause for the scoreboard (the per-question `voters` display branches are untouched).
- [x] 3.3 Column-order fallback keys off `perPlayer` empty/non-empty (not roundSummary presence).

## 4. Tests

- [x] 4.1 `roundSummary.test.ts`: rewritten to the answers-based signature — aggregation, revealed-set filtering, dedupe, sort, MVP, mode-independence (no mode input).
- [x] 4.2 `processRevealAnswers.test.ts`: `roundSummary` present in every mode and aggregating across modes; present-with-empty-`perPlayer` when nobody answered; cheaters excluded from the scoreboard.
- [x] 4.3 `scheduledPrompts.test.ts`: assert the ALWAYS-present / mode-independent / `perPlayer`-gated wording; drop the old mode-list assertions.
- [x] 4.4 `tsc --noEmit` clean; oxlint 0/0; oxfmt clean; full trivia suite green (1158 tests).

## 5. Verify against specs

- [x] 5.1 `openspec validate decouple-round-summary-from-reveal-verbosity --strict` passes.
- [x] 5.2 Artifacts (proposal/design/specs) updated to the implemented full-decoupling design; delta and code agree.
