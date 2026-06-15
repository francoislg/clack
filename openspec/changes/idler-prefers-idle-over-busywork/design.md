## Context

The idler advances at most one work unit per off-hours fire along the ladder `continue > triage > implement > review > none`. Selection is priority-ordered by a deterministic score (`priority.ts`): each kind has a flat base weight (`review = 100`, `none = 0`), `freshInput` adds `+50`, `blocked` subtracts `1000` (pushing a unit below any workable kind). The behavior contract (`instructions.ts` `BEHAVIOR_INSTRUCTION`) and the work prompt (`prompts/work.ts`) are the VIA-Claude steering layer.

Two of the four productive kinds are freshness-gated by the prompt — `continue` requires "NEW comments since the cursor," `triage` requires "untriaged." But `review` is not: nothing tells Claude a PR already reviewed at its current head has no review work. Worse, both the contract and the spec frame review as *"better than idling"* / *"rather than doing nothing,"* and `review` carries a flat `100` weight that never decays. So a review unit perpetually outranks `none`, and the idler re-reviews unchanged PRs and re-fires `@claude review this` every 15 minutes.

This change is **prompt/contract-only**. No scoring math, schema, or ledger field changes.

## Goals / Non-Goals

**Goals:**
- Make "do nothing" the correct default of an empty/stale ladder, not a fallback the prompt argues against.
- Gate `review` on freshness (new commits since the unit's last-reviewed point), parallel to how `continue`/`triage` are gated.
- Stop `@claude review this` from re-firing on a PR with no new commits.
- Keep external-PR review available, but only when fresh.

**Non-Goals:**
- Sync-side discovery discipline (creating units per marginal item) — out of scope; work-fire only.
- A deterministic code-level floor (e.g. "score ≤ 0 → stop"). The fix leans on the existing `blocked` sink, driven by the prompt.
- Any change to `priority.ts` weights, `types.ts`, or the ledger/reference schema.

## Decisions

**1. Express the review freshness gate via the existing per-reference cursor + `blocked` signal — not a new field.**
References already carry a free-text cursor and idempotency notes. The contract instructs Claude to record the reviewed commit SHA (the PR head at review time) in the reference cursor, and on a later fire to treat the unit as having review work *only if* the current PR head differs. When the head is unchanged, Claude calls `upsert_idea` with `blocked: true`, so `computePriority` sinks it to `review(100) - 1000 = -900` — below `none(0)`. The fire then ends with no action.
- *Alternative considered:* add a `reviewedAt`/`reviewedSha` field to the reference schema and a code-level decay in `priority.ts`. Rejected — the user chose prompt-only; the cursor + `blocked` machinery already expresses "stale → sink" without touching scoring code or risking a too-strict state schema.

**2. Remove the anti-idle language entirely rather than soften it.**
Delete *"Lowest priority, but better than idling"* (contract rung 4/5) and the implicit "fill the fire" framing in `work.ts`. Reframe rung 5 (`none`) as: when no unit is *fresh and workable*, ending the fire is the correct outcome — explicitly state that re-reviewing an unchanged PR or re-triaging a quiet unit is NOT work and must not be invented.
- *Alternative considered:* keep the ranking but add "only if fresh." Rejected — the comparative phrasing ("better than idling") is itself the incentive; an LLM reads it as a directive to find something. Cleaner to remove the comparison and state idle is expected.

**3. The `@claude review this` re-trigger inherits the same freshness rule.**
The trigger is only valid as a response to fresh state (e.g. just-pushed commits). The contract forbids re-firing it when there are no new commits since the last trigger (tracked the same way — a cursor note on the reference). This closes the second manufactured-work path.

## Risks / Trade-offs

- **[A genuinely-changed PR is wrongly skipped because Claude mis-reads the cursor]** → The gate is "new commits since last-reviewed SHA," a concrete comparison Claude makes by reading the PR head; the cost of a false skip is one missed review cycle (picked up next window when the SHA still differs), not a stuck unit. Self-review holes already route through `nextSteps` → `continue`, which is independently freshness-gated.
- **[Prompt-only enforcement is softer than a code floor]** → Accepted per scope decision. The `blocked` sink is deterministic once Claude sets it; the residual risk is Claude failing to set `blocked` on a stale unit. Mitigated by making the contract's rung-5 language unambiguous and by the fact that `none` (0) already beats a `blocked` review (−900), so even a single correct `blocked` call wins.
- **[Removing "better than idling" makes the idler too passive, skipping legitimate review]** → Legitimate review is fresh review (new commits), which still scores `100`/`150` and is selected normally. Only *stale* review is suppressed. Net effect is fewer no-op review posts on humans' PRs, which is the desired outcome.
