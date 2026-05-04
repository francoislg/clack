## Why

Review of the synced trivia-suggestion specs surfaced 7 issues: vague "many times" sampling scenarios, a wording-ban that tests prompt prose instead of behavior, an unexplained `SHOULD` that readers can't distinguish from a gap, an undocumented bucket-size asymmetry, missing boundary documentation at 0.30 / 0.90, and a missing scenario for when the model diverges from `suggestedAnswer`. None of these block correctness, but they make the specs harder to test and harder to read confidently.

## What Changes

- Replace "many times" in the two distribution scenarios with concrete invocation counts and tolerance bands so the scenarios are mechanically testable.
- Reframe step 3's "the prompt SHALL NOT instruct Claude to 'randomly decide'" from a wording ban into a behavioral rule (Claude SHALL honor `suggestedAnswer`) plus a separate optional regression-guard scenario.
- Add a `**Note:**` after step 8 explaining why `isTrue` is `SHOULD` (not `SHALL`) — the design tolerates divergence to avoid mid-flow regeneration.
- Document the asymmetric bucket sizes (Easy = 3 values, Medium/Hard = 2 each) with a one-line rationale, or rebalance to symmetric bands (decision deferred to design discussion).
- Document boundary behavior at exactly 0.30 / 0.90: 0.30 → Medium, 0.90 → Hard.
- Add a scenario covering `save_question` accepting a payload where `isTrue !== suggestedAnswer` — divergence is tolerated, no validation error.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `trivia-categories`: tighten the "Get ideas tool" requirement — concrete sampling counts/tolerances, boundary documentation, asymmetry rationale.
- `trivia-scheduled-prompts`: tighten the "Send Questions Instructions Tool" requirement — reframe step 3, annotate step 8's SHOULD, add divergence scenario.

## Impact

- Specs only. No code changes are required to satisfy the tightened specs — the existing implementation already meets them; the deltas just make the existing behavior explicit and testable.
- Tests: optional. The two distribution scenarios become testable with the concrete counts/tolerances; we may want to add or upgrade the existing stubbed-Math.random tests to statistical tests in a follow-up. Out of scope for this change unless explicitly added.
