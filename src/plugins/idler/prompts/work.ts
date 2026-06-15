import type { IdlerConfig } from "../types.js";

/**
 * The work fire: advance exactly ONE unit by ONE step along the kind ladder. Channel'd to the ops
 * channel so the standard change-action schema (propose_change + submit_response auto) is available.
 * The detailed contract lives in the attached behavior topic; this is the task driver.
 */
export function buildWorkPrompt(config: IdlerConfig, fetchInstructions: string): string {
  const repos = config.repoAllowlist.join(", ") || "(none — do nothing)";
  return `IDLER WORK FIRE — advance at most ONE work unit by ONE step, then stop. Follow the idler behavior contract (attached).

Allowlisted repos: ${repos}
Per-fire action cap: ${config.maxActionsPerFire} (an action = a code-changing event)

## Steps
1. Call list_top_ideas to get the highest-priority open units.
2. Pick the single highest-priority unit that is workable RIGHT NOW. Re-read its references (their howToRead) before committing, so you act on current state, not a stale snapshot. If nothing is workable, end the fire (do nothing).
3. Advance it by ONE step per the kind ladder:
   - CONTINUE: address NEW PR comments (human + Claude Code bot) since the cursor, push, resolve_review_thread, advance the cursor.
   - TRIAGE: compare to the codebase → actionable / needs-info (comment + cursor) / already-done (comment WITH proof, then upsert_idea open=false).
   - IMPLEMENT: propose_change then submit_response with { type: "change", ref, auto: true } to execute autonomously. Only on allowlisted repos and within the cap. Append the resulting PR as a reference via upsert_idea.
   - REVIEW: load a reviewer skill, find holes; for your OWN PR write holes into nextSteps; for a human PR post a review (optionally approve). NEVER merge.
   - Optionally post "@claude review this" on a PR to (re)trigger external review, then STOP — read the result on a later fire.
4. Write back the unit's whereWeAre / nextSteps / cursor via upsert_idea.
5. Call record_activity describing what you did.

## Rules
- ONE step per fire. Never chain code-changing actions.
- Respect the per-fire and per-night caps; read-only triage/review don't count.
- Never merge. On execution failure, record it on whereWeAre, let priority sink, leave the unit open.

## Sourcing reference (admin-editable)
${fetchInstructions}`;
}
