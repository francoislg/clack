## 1. Behavior contract (instructions.ts)

- [x] 1.1 In `BEHAVIOR_INSTRUCTION`, remove the anti-idle framing: delete "Lowest priority, but better than idling" and any wording that ranks a productive kind above doing nothing.
- [x] 1.2 Reframe ladder rung 5 ("Nothing") as the correct, expected outcome of an empty or stale ladder — explicitly state that re-reviewing an unchanged PR or re-triaging a quiet unit is NOT work and must not be invented.
- [x] 1.3 Add a review-freshness rule to the ladder: review is productive only when the PR head has new commits since the unit's last-reviewed cursor; record the reviewed head on the reference cursor after reviewing; when the head is unchanged, mark the unit `blocked` (via `upsert_idea`) so it sinks below `none`. State this applies to self-review AND external/human-PR review.
- [x] 1.4 Add the no-new-commits guard to the `@claude review this` re-trigger: never re-post the trigger on a PR with no new commits since the last trigger.

## 2. Work prompt (prompts/work.ts)

- [x] 2.1 In the REVIEW step, require new commits since the last-reviewed cursor before reviewing; on an unchanged head, `upsert_idea` with `blocked: true` and move on.
- [x] 2.2 In step 2 ("Pick the single highest-priority unit workable RIGHT NOW"), tighten the do-nothing guidance so a stale review / quiet triage does not count as workable; ending the fire is correct.
- [x] 2.3 Gate the optional `@claude review this` re-trigger line on new commits since the last trigger.

## 3. Tests

- [x] 3.1 Add a focused content-assertion test (e.g. `instructions.test.ts`) verifying `BEHAVIOR_INSTRUCTION` no longer contains "better than idling" and DOES contain the review-freshness gate + idle-is-default framing.
- [x] 3.2 Confirm `priority.test.ts` still covers "blocked sinks below any workable kind" (the mechanism the freshness gate relies on); add a case asserting a `blocked` review scores below `none` if not already covered.

## 4. Verify

- [x] 4.1 Run `npx tsc` (type-check), `npx oxlint src/plugins/idler`, `npx oxfmt --check src/plugins/idler`, and `npm test`.
- [x] 4.2 Run `openspec validate idler-prefers-idle-over-busywork --strict` and confirm it passes.
