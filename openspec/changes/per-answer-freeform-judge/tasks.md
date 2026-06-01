## 1. Per-answer judge core (`src/plugins/trivia/freeform/judge.ts`)

- [x] 1.1 Replace `JudgeSubmission` (keyed) with `{ userId, answerText }`; `JudgeVerdict` becomes `{ correct, reason? }` (no `key`)
- [x] 1.2 `buildSingleJudgePrompt(question, answerText)` — shared core + `freeformAnswerShape`-selected rule block + strict-JSON output contract
- [x] 1.3 `parseSingleVerdict(text)` — strict parse to `{ correct: boolean, reason? }`, throws otherwise
- [x] 1.4 `judgeAnswer(askClaude, question, answerText, opts)` — re-ask up to `JUDGE_MAX_ATTEMPTS`; throw only after the budget is spent
- [x] 1.5 `judgeSubmissions(...)` — bounded-concurrency fan-out; a throwing submission yields `verdict: null`

## 2. Reveal wiring (`src/plugins/trivia/answerTypes/freeform.ts`)

- [x] 2.1 `processReveal` builds keyless submissions and calls `judgeSubmissions`
- [x] 2.2 Apply each verdict via `updateAnswer`; assemble voter buckets from resolved verdicts
- [x] 2.3 Leave `verdict: null` rows pending; when any exist, return `{ ok: false, error }` and DO NOT stamp `processedAt`
- [x] 2.4 Drop the `buildJudgePrompt` / `parseJudgeResponse` imports

## 3. Doc-string cleanup

- [x] 3.1 `core/types.ts` — remove `judge-error` from the `judgeReason` label list
- [x] 3.2 `tools/questions/getQuestionHistory.ts` — same
- [x] 3.3 `trivia-reveal-processor` spec delta — REMOVE "Freeform Reveal Invokes Inline Batch Judge" + ADD "Freeform Reveal Invokes Per-Answer Judge"; MODIFY `process_reveal_answers MCP tool` to reword the two "inline batch judge as before/as today" phrases

## 4. Tests

- [x] 4.1 `freeform/judge.test.ts` — per-answer prompt shape selection (date / named-entity), strict parse, retry-then-throw, concurrency fan-out, failure→null
- [x] 4.2 `answerTypes/freeform.test.ts` — per-answer judging, date-boundary acceptance (`1995 ∈ [1995, 2005]`), pending-on-failure (no `processedAt`, row stays undefined)
- [x] 4.3 Full trivia suite green; `tsc`, oxlint, oxfmt clean

## 5. Ship

- [ ] 5.1 Commit (when explicitly asked)
- [ ] 5.2 Deploy to the GCE VM
- [ ] 5.3 Archive this change alongside the code (sync spec deltas into `trivia-freeform-questions`)

## 6. Deferred (not in this change)

- [ ] 6.1 Deterministic numeric pre-check for `date` / `countable` that bypasses the LLM when a structured tolerance window is available — its own proposal (depends on persisting `tolerance: { lo, hi }` at `save_question` time vs. parsing `gradingNotes`)
