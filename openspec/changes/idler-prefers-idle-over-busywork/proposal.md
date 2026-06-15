## Why

The idler's "do nothing" rung exists, but the prompt and spec actively compete with it: the work-kind ladder frames review as *"better than idling"* and the spec's own scenario says the idler should *"perform a review pass rather than doing nothing."* Combined with a review rung that has **no freshness gate** (unlike continue/triage) and a flat priority weight that never decays, the idler will re-review the same unchanged PR every 15-minute off-hours fire and re-fire `@claude review this` on PRs with no new commits — manufacturing work just because the ladder told it that was preferable to stopping. We want idle to be the correct default when there's genuinely nothing fresh to do, not a last resort.

## What Changes

- Strip the anti-idle framing from the behavior contract and the work prompt: remove *"better than idling"* and any language that ranks doing-something over doing-nothing. Doing nothing is the expected, correct outcome of an empty ladder — not a failure.
- Add a **review freshness gate**: the review kind is only productive when there are new commits on the PR since the unit's last-reviewed cursor. A PR already reviewed at its current head has no review work — the unit is marked `blocked` so its priority sinks below `none`, and the fire ends. (Reuses the existing per-reference cursor + `blocked` signal — no schema or scoring-code change.) Applies to both self-review and external-PR review.
- **Gate the `@claude review this` re-trigger**: forbid re-triggering when there are no new commits since the last trigger. The trigger is a response to fresh state, not a way to fill an idle fire.
- Tighten the spec's ladder requirement so review is "the lowest *fresh* productive kind," and update the trigger-loop requirement with the no-new-commits guard.

Out of scope (per exploration decisions): sync-side discovery discipline (this change is work-fire-only), and any new deterministic code-level floor (the fix is prompt/contract-only, leaning on the existing `blocked` priority sink).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `idler-plugin`: revise the **Priority-ordered work-kind ladder** requirement so an unchanged PR yields no review work (idle is correct), strengthen the **Work task may do nothing** behavior to be the default rather than a fallback, add a review-freshness gate to the **Self-review feeds continue** review behavior, and add a no-new-commits guard to the **@claude review trigger loop** requirement.

## Impact

- `src/plugins/idler/instructions.ts` — `BEHAVIOR_INSTRUCTION`: remove anti-idle wording, add review freshness gate + re-trigger guard, reframe rung 5 (nothing) as the default.
- `src/plugins/idler/prompts/work.ts` — work prompt: drop the implicit "fill the fire" framing, instruct the review step and `@claude review` re-trigger to require new commits since cursor, mark stale review units `blocked`.
- No changes to `priority.ts`, `types.ts`, or any ledger schema — the freshness gate is expressed through the existing reference cursor and `blocked` signal.
- All edits are VIA-Claude path (English prompts/contract); no `t()` / i18n impact.
