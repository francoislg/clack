## 1. Spec deltas

- [ ] 1.1 `trivia-categories/spec.md` — replace "many times" with concrete N=1000 + ±4σ tolerance bands (Bernoulli math in design.md).
- [ ] 1.2 `trivia-categories/spec.md` — document bucket-width asymmetry (Easy 3 / Medium 2 / Hard 2) and the design rationale.
- [ ] 1.3 `trivia-categories/spec.md` — document boundary behavior at exactly 0.30 and 0.90 with a dedicated scenario.
- [ ] 1.4 `trivia-categories/spec.md` — add "Pool exhausted by recent exclusions" scenario (zero remaining categories).
- [ ] 1.5 `trivia-scheduled-prompts/spec.md` — reframe step 3: behavioral SHALL on truth value matching `suggestedAnswer`, regression-guard moved into a dedicated scenario.
- [ ] 1.6 `trivia-scheduled-prompts/spec.md` — annotate step 8 with a Note explaining why `isTrue` is SHOULD (mirrors archived design.md rationale).
- [ ] 1.7 `trivia-scheduled-prompts/spec.md` — add divergence scenario: `save_question` accepts `isTrue !== suggestedAnswer` without error.

## 2. Validate

- [ ] 2.1 Run `openspec validate tighten-trivia-suggestion-specs --strict`.
- [ ] 2.2 Confirm no implementation changes are required (the existing `getIdeas.ts` and `scheduledPrompts.ts` already satisfy every tightened scenario).

## 3. Optional follow-up (out of scope for this change unless explicitly added)

- [ ] 3.1 Promote the stubbed-Math.random distribution tests in `src/plugins/trivia/trivia.test.ts` to statistical tests using N=1000 and the ±4σ bands from the spec, so the spec scenarios become directly executable.
