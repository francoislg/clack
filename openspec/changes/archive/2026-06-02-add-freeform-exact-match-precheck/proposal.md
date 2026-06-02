## Why

Every pending free-form answer is judged by its own Haiku call (`judgeAnswer` → one `sdk.askClaude` per submission, bounded to 6 concurrent). The dominant case — a player who simply typed the canonical answer — pays a model call, the 4-retry budget, and the small but real risk of landing "pending" after a model hiccup, when the answer is unambiguously correct by string equality. Skipping the model for those answers is faster, cheaper, and strictly more reliable.

## What Changes

- Add a deterministic **exact-match pre-check** at the top of `judgeAnswer`: before any model call, normalize the player's answer and compare it against the question's `expectedAnswer` and every entry in `acceptableAnswers`. On a match, return `{ correct: true, reason: "exact-match" }` immediately — no `askClaude` call, no retry loop, no chance of landing pending.
- The pre-check **only ever accepts** — a non-match falls through to the existing Haiku judge path, completely unchanged. This keeps the pre-check a strict subset of what the judge already accepts, so it can never accept something the judge would reject.
- **Maximally conservative normalization** (no false-accept risk): `trim` → `toLowerCase` → collapse internal whitespace runs to a single space. No punctuation removal, no accent folding. `C` never matches `C++`, `5` never matches `$5`, `café` never matches `cafe` — all fall through to the LLM.
- The hedging guard is preserved for free: `"Paris or London"` never string-equals `"Paris"`, so it falls through and still earns its `multiple-guess` rejection from the judge.

## Capabilities

### New Capabilities
<!-- None -->

### Modified Capabilities
- `trivia-freeform-questions`: Reveal-time judging gains a deterministic exact-match short-circuit ahead of the per-answer model call — an answer that normalizes equal to `expectedAnswer` or any `acceptableAnswers` entry is accepted without invoking the judge.

## Impact

- `src/plugins/trivia/freeform/normalize.ts` — new: the conservative normalizer (`normalizeAnswer`) plus an `isExactMatch(question, answerText)` predicate. Small, pure, fully unit-tested.
- `src/plugins/trivia/freeform/judge.ts` — `judgeAnswer` calls the pre-check before the retry loop; on a hit it returns the synthetic `exact-match` verdict without touching `askClaude`.
- Tests: `freeform/normalize.test.ts` (normalization + match/no-match cases), `freeform/judge.test.ts` (pre-check short-circuits without calling `askClaude`; non-match still calls the model).
- No config schema changes. No data migrations. No new dependencies. No change to stored question/answer record shapes (`reason: "exact-match"` reuses the existing optional `judgeReason` field).
