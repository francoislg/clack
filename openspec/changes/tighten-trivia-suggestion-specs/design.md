## Context

The `add-trivia-question-suggestions` change introduced server-side coin-flip and weighted-difficulty sampling in `get_ideas`, with deltas synced into `trivia-categories` and `trivia-scheduled-prompts`. A follow-up review of those synced specs flagged 7 issues spanning testability, behavioral framing, and missing scenarios. This change is spec-only — no implementation changes are required.

## Goals / Non-Goals

**Goals:**

- Make the two distribution scenarios mechanically testable.
- Surface tolerated edge behavior (boundary values, divergence) as explicit scenarios.
- Replace one wording-ban requirement with a behavioral one.
- Annotate `SHOULD` clauses so readers can distinguish "soft by design" from "spec gap".

**Non-Goals:**

- Adding statistical distribution tests in code (out of scope; trackable as a follow-up).
- Changing the implementation in `getIdeas.ts` or `scheduledPrompts.ts`.
- Rebalancing the bucket sizes (Easy 3 / Medium 2 / Hard 2). The asymmetry was a deliberate user choice during the original conversation; this change documents it rather than altering it.

## Decisions

### "Many times" → concrete N and tolerance

Each distribution scenario gets:

- A concrete N (1000 invocations).
- An expected count.
- A tolerance band expressed as a multiple of the expected standard deviation, so the bands are statistically meaningful and we can pick a vanishingly low false-fail rate.

For Bernoulli sampling at probability p with N trials, σ = √(N · p · (1−p)). At N=1000:

- `suggestedAnswer = true` (p=0.5): expected 500, σ ≈ 15.8. Tolerance ±4σ ≈ ±64 → asserted band [436, 564]. False-fail rate ≈ 6e-5.
- `suggestedDifficulty = "Easy"` (p=0.3): expected 300, σ ≈ 14.5. ±4σ ≈ ±58 → [242, 358].
- `suggestedDifficulty = "Medium"` (p=0.6): expected 600, σ ≈ 15.5. ±4σ ≈ ±62 → [538, 662].
- `suggestedDifficulty = "Hard"` (p=0.1): expected 100, σ ≈ 9.5. ±4σ ≈ ±38 → [62, 138].

**Alternatives considered:** "must roughly match" without numbers (rejected — same problem we're fixing). Tighter tolerance like ±2σ (rejected — false-fail rate ≈ 5%, would flake CI).

### Step 3 reframe

Replace `the prompt SHALL NOT instruct Claude to "randomly decide"` (which tests prose) with:

- A behavioral SHALL: "Claude SHALL produce a statement whose truth value matches `suggestedAnswer`."
- A separate scenario covering the regression-guard intent: "the prompt does NOT contain wording that asks Claude to randomly decide the truth value."

The regression guard survives, but it lives where regression guards belong — in a scenario, not in the requirement description.

### Step 8 SHOULD annotation

Add a `**Note:**` line right after step 8 explaining the design rationale (model is allowed to disagree; mid-flow regeneration would be expensive; observed adherence is high). The text mirrors what's in the archived `add-trivia-question-suggestions/design.md` so readers don't have to dig into archived artifacts.

### Bucket asymmetry

Document only — Easy = 3 values, Medium = 2, Hard = 2 was a deliberate choice during the originating discussion. Rationale: difficulty self-rating is fuzzy; narrowing the higher buckets keeps "Hard" meaningfully obscure. The 30/60/10 weights compensate for the size asymmetry — a wider Easy band soaks up the bulk of the benign questions; the narrower Hard band reflects that Hard-rated questions should be rare and sharp.

### Boundary documentation

The threshold form `r < 0.3 → Easy; r < 0.9 → Medium; else Hard` means `r = 0.30` is Medium and `r = 0.90` is Hard. Add one line in the spec stating this explicitly. No code change.

### Divergence scenario

`save_question` does not validate `isTrue === suggestedAnswer`. Add a scenario describing the tolerated case. The scenario is descriptive (documents the existing tolerated path), not prescriptive (no new code).

## Risks / Trade-offs

- **Locking concrete numbers into the spec** → if we later change the sample size or weighting, the spec needs another delta. Mitigation: the numbers are derived from p and N via standard formulas, so they're easy to recompute.
- **Adding rationale notes inflates spec size** → kept to one short note per affected requirement.
- **Statistical tolerance can still flake** → ±4σ gives a false-fail rate around 6e-5; acceptable for any test that runs less than ~10⁴ times.
