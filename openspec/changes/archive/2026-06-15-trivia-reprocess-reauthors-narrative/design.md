## Context

Two paths put a reveal on the board. The **fresh reveal** (reveal cron, `scheduledPrompts.ts`) has an explicit "AUTHOR PER-CARD NARRATIVE" branch at line 775 that calls `update_question` when `includeRevealInQuestions === "yes"`. The **reprocess** path (admin "fix the last batch", runbook in `triviaCheckInstruction.ts` "Correcting an already-posted batch") lists only `compute_answers → update_answers_block`. It never mentions `update_question`, so the per-card narrative is left stale after a reprocess.

## Goals / Non-Goals

**Goals:**
- Reprocess re-authors the per-card narrative (when the axis is `"yes"`) so it conforms to the current `revealResponses` and re-derived verdicts.

**Non-Goals:**
- No new code, payload field, or `narrativeStale` signal (the precise Option B from exploration — deferred).
- No change to the fresh-reveal flow.
- No change to the summary narrative (already re-rendered fresh every reveal).

## Decisions

**Decision: Prompt-only fix in the reprocess runbook (Option A), not a code signal (Option B).**
The bug is a missing instruction, not a comprehension failure — the runbook simply omits the narrative step. Re-authoring on every reprocess is always-safe because reprocess is rare and explicit (admin-initiated, never automatic). The precision of a per-entry `narrativeStale` flag only buys token savings on large batches; not worth the plumbing now.

- *Alternative (Option B):* surface a per-entry `narrativeStale` flag from `compute_answers` so Claude re-authors only changed cards. More surgical, catches both revealResponses and judgeLeniency-flip triggers explicitly, but adds code. Noted as a follow-up if reprocess batches grow large.

**Decision: Gate the new step on `includeRevealInQuestions`, mirroring the fresh flow.**
The runbook step branches the same way step 1 of the reveal does: `"yes"` → `update_question` per reprocessed card before `update_answers_block`; `"no"` → skip. This keeps the two paths behaviorally identical on narrative.

## Risks / Trade-offs

- [Re-authors even when nothing visibly changed] → Acceptable: reprocess is rare and explicit, and re-authoring is always-correct (never produces a stale card).
- [Claude must know the current `revealResponses` to author correctly] → It already does: the reprocess re-stamps the current mode, and `update_answers_block` renders the matching footer; the runbook instruction reminds Claude to conform.
