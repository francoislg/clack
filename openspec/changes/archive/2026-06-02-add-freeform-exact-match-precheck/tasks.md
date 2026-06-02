## 1. Normalizer module

- [x] 1.1 Create `src/plugins/trivia/freeform/normalize.ts` with `normalizeAnswer(s: string): string` — `trim` → `toLowerCase` → collapse internal whitespace runs to a single space; NO punctuation removal, NO accent folding
- [x] 1.2 In the same module, add `isExactMatch(question: TriviaQuestion, answerText: string): boolean` — true when `normalizeAnswer(answerText)` equals `normalizeAnswer(question.expectedAnswer)` or `normalizeAnswer(x)` for any `x` in `question.acceptableAnswers ?? []`

## 2. Wire the pre-check into the judge

- [x] 2.1 In `src/plugins/trivia/freeform/judge.ts`, at the top of `judgeAnswer` (before the retry loop), return `{ correct: true, reason: "exact-match" }` when `isExactMatch(question, answerText)` is true — no `askClaude` call
- [x] 2.2 Confirm the non-matching path is untouched: prompt build, retry budget, and `judgeSubmissions` fan-out behave exactly as before

## 3. Tests

- [x] 3.1 `src/plugins/trivia/freeform/normalize.test.ts` — normalization (case, leading/trailing + internal whitespace) and `isExactMatch`: exact, case/whitespace variants, acceptable-variant hits, and the non-match guards (`C` vs `C++`, `5` vs `$5`, `cafe` vs `café`, empty/absent `acceptableAnswers`)
- [x] 3.2 `src/plugins/trivia/freeform/judge.test.ts` — `judgeAnswer` short-circuits on an exact match with `askClaude` never called and verdict `{ correct: true, reason: "exact-match" }`; a non-matching answer still calls `askClaude` and returns its parsed verdict
- [x] 3.3 Full trivia suite green; `npx tsc`, `npx oxlint`, `npx oxfmt --check` clean on changed files

## 4. Verify & ship

- [x] 4.1 `openspec validate add-freeform-exact-match-precheck --strict`
- [ ] 4.2 Commit (only when explicitly asked)
- [ ] 4.3 Archive this change alongside the code (sync the delta into `trivia-freeform-questions`)
