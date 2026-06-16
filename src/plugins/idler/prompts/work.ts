import type { IdlerConfig } from "../types.js";

/**
 * The work fire: advance exactly ONE unit by ONE step along the kind ladder. Channel'd to the ops
 * channel so the standard change-action schema (propose_change + submit_response auto) is available.
 * The detailed contract lives in the attached behavior topic; this is the task driver.
 */
export function buildWorkPrompt(config: IdlerConfig, fetchInstructions: string): string {
  const repos = config.repoAllowlist.join(", ") || "(none — do nothing)";
  const silentNote =
    config.reporting.tickUpdates === "none"
      ? `\n\nPER-TICK REPORTING IS OFF: this fire produces NO Slack output — any message you submit is suppressed, and change execution runs silently. Do the work and record it via record_activity; the morning summary is where progress surfaces. Do not craft a user-facing narration message.`
      : "";
  return `IDLER WORK FIRE — advance at most ONE work unit by ONE step, then stop. Follow the idler behavior contract (attached).${silentNote}

Allowlisted repos: ${repos}
Per-fire action cap: ${config.maxActionsPerFire} (an action = a code-changing event)

## Steps
1. Call list_top_ideas to get the highest-priority open units.
2. Pick the single highest-priority unit that has FRESH work RIGHT NOW. Re-read its references (their howToRead) before committing, so you act on current state, not a stale snapshot. A stale review (PR head unchanged since you last reviewed it) or a quiet triage (no new source activity) does NOT count as workable. If no unit has fresh work, end the fire — doing nothing is the correct outcome, never manufacture activity to fill the fire.
3. Advance it by ONE step per the kind ladder:
   - CONTINUE: address NEW PR comments (human + Claude Code bot) since the cursor, push, resolve_review_thread, advance the cursor.
   - TRIAGE: compare to the codebase → actionable / needs-info (comment + cursor) / already-done (comment WITH proof, then upsert_idea open=false).
   - IMPLEMENT: propose_change then submit_response with { type: "change", ref, auto: true } to execute autonomously. Only on allowlisted repos and within the cap. Append the resulting PR as a reference via upsert_idea.
   - REVIEW: only when the PR has NEW commits since the unit's last-reviewed cursor. Load a reviewer skill, find holes; for your OWN PR write holes into nextSteps; for a human PR post a review (optionally approve). Record the reviewed PR head on the cursor. If the head is unchanged, do NOT review — upsert_idea with blocked: true and move on. NEVER merge.
   - Optionally post "@claude review this" on a PR to (re)trigger external review, then STOP — read the result on a later fire. Only re-trigger when the PR has new commits since the last trigger; never re-trigger on an unchanged PR.
4. Write back the unit's whereWeAre / nextSteps / cursor via upsert_idea.
5. Call record_activity describing what you did.

## Rules
- When you CLOSE a unit (upsert_idea open:false — done/merged/already-done), also set staleAfter.date about 2 days out. The unit is not removed now; the daily memory review prunes it after that grace window, so it survives briefly in case work must resume. Never prune a unit yourself.
- ONE step per fire. Never chain code-changing actions.
- Respect the per-fire and per-night caps; read-only triage/review don't count.
- Doing nothing is valid and expected when no unit has fresh work — never invent busywork.
- Never merge. On execution failure, record it on whereWeAre, let priority sink, leave the unit open.

## Sourcing reference (admin-editable)
${fetchInstructions}`;
}
