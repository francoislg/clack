## Context

Free-form reveal judging currently runs one Haiku call per pending submission (`judgeSubmissions` → `judgeAnswer` → `sdk.askClaude`, bounded to 6 concurrent, 4 retries each). The most common correct case — a player who typed the canonical answer verbatim — pays the full model cost and inherits the model's flakiness, including the "left pending after retries" recovery path the parent `per-answer-freeform-judge` change introduced. That change explicitly deferred deterministic pre-checks to a separate proposal (its task 6.1, scoped there to numeric tolerance); this change is the string-equality sibling.

## Goals / Non-Goals

**Goals:**
- Skip the model entirely when the player's answer is exactly the expected answer (or an enumerated acceptable variant), modulo case and whitespace.
- Guarantee zero false accepts: the pre-check is a strict subset of what the model judge already accepts.
- Keep the non-matching path byte-for-byte unchanged.

**Non-Goals:**
- Fuzzy matching, typo tolerance, translation, or qualifier handling — those remain the model judge's job.
- Numeric tolerance pre-checks (`date`/`countable` windows) — still deferred (parent change task 6.1).
- Deduplicating identical non-matching answers into a single judge call — out of scope here.
- Auto-re-judging rows left pending after retries — out of scope; the existing 4-retry + re-reveal recovery is unchanged.

## Decisions

**1. Pre-check lives at the top of `judgeAnswer`, not in `judgeSubmissions` or `processReveal`.**
`judgeAnswer` is the single chokepoint every submission already flows through, and it owns the retry loop the pre-check needs to bypass. Placing the guard there means a match returns before the loop is ever entered, and any future caller of `judgeAnswer` inherits the optimization for free. Alternative (guard in `processReveal`): rejected — it would duplicate the model-vs-no-model branch outside the judge and leave `judgeAnswer` itself naively calling the model.

**2. Conservative normalization: `trim → toLowerCase → collapse internal whitespace`. No punctuation stripping, no accent folding.**
The pre-check may only accept what the judge would accept. Lowercasing and whitespace-collapsing can make two strings equal *only* when they are the same answer, so they preserve the subset guarantee. Stripping punctuation breaks it — `C++`→`c` would wrongly equal `C`→`c`, and `$5`→`5` would wrongly equal `5`; the judge would reject those as materially different. Accent folding has the same hazard (`café` vs `cafe`). The cost of staying conservative is only missed short-circuits (e.g. a trailing period), which fall through to the model harmlessly. Alternative (mirror the judge's "punctuation-insensitive" universal rule): rejected — it trades the correctness guarantee for marginal extra hits.

**3. Compare against `expectedAnswer` AND every `acceptableAnswers` entry.**
`expectedAnswer` is the canonical string and the most common exact hit; `acceptableAnswers` are author-enumerated fully-correct variants the judge already treats as correct. Both are safe to short-circuit. Empty/absent `acceptableAnswers` simply contributes no comparison targets.

**4. Synthetic verdict reuses the existing `reason` field: `{ correct: true, reason: "exact-match" }`.**
No schema change. `processReveal` already persists `reason` into `judgeReason` regardless of correctness (freeform.ts:205), giving free observability into how often the model was skipped. The label is internal and never surfaced to players.

**5. New module `freeform/normalize.ts`.**
Per the project's small-files-with-tests convention, the normalizer and the `isExactMatch(question, answerText)` predicate live in their own pure module with `freeform/normalize.test.ts`, rather than growing `judge.ts`.

## Risks / Trade-offs

- **[A normalization rule subtly over-accepts]** → Mitigated by construction: only case-folding and whitespace-collapsing are applied, both provably meaning-preserving. Unit tests assert the materially-different cases (`C`/`C++`, `5`/`$5`, `café`/`cafe`) do NOT match.
- **[Missed short-circuits for trivially-different forms (e.g. trailing period)]** → Accepted. These fall through to the model and are judged correctly as today; the only cost is one model call we could in principle have skipped.
- **[`reason: "exact-match"` leaks to players]** → Not a risk: `judgeReason` is internal and not rendered in reveal output (consistent with other reason labels).
