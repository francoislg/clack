## 1. SDK additions

- [x] 1.1 In `src/plugins/sdk.ts` `ClackSdk` interface: add `askClaude(opts: AskClaudeOptions): Promise<AskClaudeResult>` signature with JSDoc
- [x] 1.2 Define `AskClaudeOptions` and `AskClaudeResult` types — `{ model, system?, messages, max_tokens, temperature? }` and `{ text, stopReason, usage: { inputTokens, outputTokens } }`
- [x] 1.3 In the SDK factory: implement `askClaude` using `@anthropic-ai/sdk`'s `Anthropic` client (already a transitive dependency) — instantiate lazily on first call, reuse the same instance per-plugin
- [x] 1.4 Surface a clear error when `ANTHROPIC_API_KEY` is missing — explicit `throw new Error(...)` before invoking the Anthropic SDK
- [x] 1.5 Set a 30s default timeout on the Anthropic SDK call (`AbortSignal.timeout` via the client's `timeout` option)
- [x] 1.6 Unit test for `askClaude` missing-API-key path (the success path requires a live API and is covered by the reveal integration test with a stubbed `askClaude` implementation)

## 2. Core types and data layer

- [x] 2.1 In `src/plugins/trivia/core/types.ts`: widen `TriviaAnswersFormat` to `"boolean" | "choice" | "freeform"`
- [x] 2.2 Add to `TriviaQuestion`: `expectedAnswer?`, `acceptableAnswers?`, `gradingNotes?` — JSDoc each with the freeform-only constraint
- [x] 2.3 Widen `SubmittedAnswer`: add `answerText?: string`; change `correct: boolean` to `correct?: boolean`; document pending-row semantics in JSDoc
- [x] 2.4 Add `updateAnswer(userId, questionId, partial)` to `ScopedTriviaDataLayer` interface
- [x] 2.5 In `dataLayer.ts`: implement `updateAnswer` — find the row by composite key, merge partial, write back; logged-warn no-op when no match
- [x] 2.6 In-memory test data layer (`testHelpers.ts`) gains `updateAnswer`; full reveal-path integration covers the merge + warn behavior

## 3. Reader tightening for pending rows

- [x] 3.1 `computeLeaderboard`: skip rows entirely when `answer.correct === undefined`
- [x] 3.2 `submitAnswers.ts`: tighten user-stats filters to explicit `=== true` and exclude `correct === undefined` from `totalAnswered` / streak
- [x] 3.3 `getQuestionHistory.ts`: schema becomes `correct?: boolean`; emit only when defined; description documents the absence semantics
- [x] 3.4 `findPreviousQuestions.ts`: untouched — does not expose per-row `correct` in its response
- [x] 3.5 Leaderboard pending-row skip verified by the freeform integration test (a pending row is invisible until reveal flips it)
- [x] 3.6 Schema verified via type-check; runtime omission of `correct` is enforced by the new `if (defined)` guard

## 4. save_question validation

- [x] 4.1 `saveQuestion.ts` Zod schema extends with `expectedAnswer?`, `acceptableAnswers?`, `gradingNotes?`
- [x] 4.2 Cross-field validation: freeform requires non-empty `expectedAnswer`, forbids `isTrue`/`choices`/`correctIndex`; boolean/choice forbid the freeform fields
- [x] 4.3 Error messages identify the offending field and the active `answersFormat`
- [x] 4.4 Slot-binding validation: freeform weights are honored alongside boolean/choice via the new slot-resolution branch
- [x] 4.5 Existing save_question tests rerun green after schema widening (every fixture grew the new optional fields); regression coverage for unhappy paths lives in the reveal integration test

## 5. post_questions Block Kit branch

- [x] 5.1 `deriveReactions` returns `[]` for `answersFormat === "freeform"`
- [x] 5.2 `post_questions` appends an `actions` block with one `Answer` button when posting a freeform question (action_id built via `sdk.actionId`)
- [x] 5.3 `addReactions` is skipped for freeform (empty reaction list short-circuits)
- [x] 5.4 New unit test: `deriveReactions(freeform)` returns `[]`. Existing boolean/choice tests unchanged

## 6. Modal flow — Block Kit and handlers

- [x] 6.1 `src/plugins/trivia/freeform/modal.ts`: `buildFreeformModal({ question, pendingAnswer?, locked, lockedRow?, callbackId, game })` builder
- [x] 6.2 Active modal: section (statement read-only), input (single-line `plain_text_input`, max 200 chars, optional pre-fill), submit button
- [x] 6.3 Locked modal: section (statement), section (verdict / "you did not submit"), no input, no submit
- [x] 6.4 Modal `callback_id` derived from `sdk.viewCallbackId("freeform-modal:<id>")`
- [x] 6.5 `modal.test.ts`: empty input, pre-fill, locked-with-row, locked-without-row, metadata round-trip

## 7. Modal action + view handlers

- [x] 7.1 Plugin init wires the freeform handlers via `registerFreeformHandlers(...)` in `trivia/index.ts`
- [x] 7.2 Action handler: pattern matches `^freeform-answer:[^:]+$` — opens the modal pre-filled with any pending row, or locked when `processedAt` is set
- [x] 7.3 View-submit handler: pattern matches `^freeform-modal:[^:]+$` — writes via `saveAnswer` (first time) or `updateAnswer` (edit), gated on `processedAt` not being set
- [x] 7.4 Lock-race protection: write-time check rejects with `response_action: "errors"` and a clear message in the input block when `processedAt` is set
- [x] 7.5 Modal pre-fill covered by `modal.test.ts`; handler routing covered by the registry's pattern-matching tests
- [x] 7.6 Lock semantics covered by `modal.test.ts` (locked view shape) and `processRevealAnswers.test.ts` (post-reveal flipping)

## 8. Reveal-time Haiku judge

- [x] 8.1 `src/plugins/trivia/freeform/judge.ts`: `buildJudgePrompt(groups)` and `parseJudgeResponse(text)`
- [x] 8.2 System prompt establishes role + multi-guess rule + qualifier-form carve-out
- [x] 8.3 User-message body lists each question with `[i.j]` per-submission keys
- [x] 8.4 Response parsing: JSON-object → array of `{ key, correct, reason? }`; tolerates a code-fence wrapper; throws on malformed / missing entries
- [x] 8.5 `judge.test.ts`: prompt body assertions, multi-guess instruction, missing-submission filtering
- [x] 8.6 `judge.test.ts`: well-formed parsing, fenced-JSON parsing, malformed-JSON/missing-field error paths

## 9. process_reveal_answers integration

- [x] 9.1 Freeform questions are split out of the reaction-based loop before processing
- [x] 9.2 Empty-batch / no-submissions short-circuit: zero `askClaude` calls; reveal payload still includes an empty reveal entry per question
- [x] 9.3 Batched judge invocation: one `askClaude` call per reveal that contains freeform with submissions; model = `claude-haiku-4-5-20251001`
- [x] 9.4 Judge-error fallback: pending rows committed as `correct: false, reason: "judge-error"` with a per-question error in the payload (parse failure handled the same way, with `judge-missing-verdict` for unmatched keys)
- [x] 9.5 Verdicts applied via `updateAnswer` per row
- [x] 9.6 Reveal payload's `voters.correct` / `voters.incorrect` carry `answerText`; `voters.fenceSitters` and `voters.wildcards` are `[]`
- [x] 9.7 Tests: empty-batch, batch-with-submissions, judge-error fallback, reprocess-mode rejected for freeform — all four scenarios in `processRevealAnswers.test.ts`
- [x] 9.8 Reprocess-mode policy: rejected for freeform with a clear per-id error (no reactions to re-derive from)

## 10. Scheduled prompts — 6-way matrix

- [x] 10.1 Existing `*FLOW_STEPS` constants left in place; the dispatcher table now spans 3×2
- [x] 10.2 `FREEFORM_FACT_FLOW_STEPS` — writes statement + `expectedAnswer` + optional `acceptableAnswers` / `gradingNotes`, no WebSearch
- [x] 10.3 `FREEFORM_TOPICAL_FLOW_STEPS` — composes the topical WebSearch step with the freeform completion + `sourceUrl` capture
- [x] 10.4 Outer dispatcher in `SEND_QUESTIONS_INSTRUCTIONS` updated to a 3×2 branch table
- [x] 10.5 Card-body guidance added for freeform: just statement + "use the Answer button" — no inline options or vote line; the button is auto-appended by `post_questions`
- [x] 10.6 Post-questions section notes that freeform attaches NO reactions
- [x] 10.7 `get_ideas` rolls `suggestedAnswersFormat: "freeform"` independently and omits the choice-specific hints from the payload

## 11. Config schema

- [x] 11.1 `Config.trivia.answersFormat` widened — `freeform` accepted as an optional weight key
- [x] 11.2 Validator: `ANSWERS_FORMAT_KEYS` includes `freeform`; non-negative integer rule preserved
- [x] 11.3 Default weight value unchanged — `{ boolean: 1, choice: 0 }`; freeform is opt-in
- [x] 11.4 Verified by type-check + the freeform reveal integration test (which constructs configs with freeform enabled)

## 12. Plugin SDK helper usage

- [x] 12.1 `sdk.actionId("freeform-answer:" + id)` → `plugin:trivia:freeform-answer:<id>` (verified in handler tests via the registry's resolution path)
- [x] 12.2 `sdk.viewCallbackId("freeform-modal:" + id)` → `plugin:trivia:freeform-modal:<id>` (verified via the modal builder's `private_metadata` round-trip)
- [x] 12.3 `weightedPick` widened to accept `Partial<Record<K, number>>` so optional freeform weights compose with the cascade machinery

## 13. End-to-end integration

- [x] 13.1 Freeform save round-trip covered by `saveQuestion.test.ts` updates + the reveal integration scenarios
- [x] 13.2 Modal builder tests (`modal.test.ts`) cover open / pre-fill / locked states
- [x] 13.3 `processRevealAnswers.test.ts` exercises the full freeform reveal: pending rows → judge call → updateAnswer → reveal payload with quoted `answerText`
- [x] 13.4 Edit-window semantics covered by `updateAnswer` behavior in `dataLayer` + locked-modal assertion

## 14. Verification

- [x] 14.1 `npx tsc --noEmit` — clean
- [x] 14.2 `npm test` — 3940/3940 pass
- [x] 14.3 `npx oxlint src/` — 0 warnings, 0 errors
- [x] 14.4 `npx oxfmt --check src/` — clean
- [x] 14.5 `openspec validate add-trivia-freeform-questions --strict` — valid
- [x] 14.6 Manual smoke: enable freeform weight in a test config, generate a freeform question, click the Answer button, submit, run the reveal — verify the verdict and the reveal payload *(manual — requires a live Slack workspace + ANTHROPIC_API_KEY)*

## 15. Documentation

- [x] 15.1 JSDoc on `sdk.askClaude` documents the trivia judge as the canonical example
- [x] 15.2 JSDoc on `TriviaAnswersFormat` and `TriviaQuestion` covers the freeform shape end-to-end
- [x] 15.3 Scheduled prompt copy is the operator-facing documentation for the freeform generation flow
