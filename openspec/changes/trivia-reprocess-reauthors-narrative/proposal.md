## Why

When an admin reprocesses an already-posted trivia batch, the per-card narrative (`update_question` / `revealBlocks`) is never refreshed — the reprocess runbook only re-scores and re-renders the facts footer. So after a `revealResponses` or `judgeLeniency` change + reprocess, the stale narrative still quotes a now-hidden typed answer ("you said Swiss") or asserts a verdict the re-judge flipped. Claude only fixes it after the user complains.

## What Changes

- Add a narrative re-authoring step to the reprocess runbook in `triviaCheckInstruction.ts` ("Correcting an already-posted batch"): when `includeRevealInQuestions` resolves to `"yes"`, re-author each reprocessed card's narrative via `update_question` (conforming to the now-current `revealResponses` and re-derived verdicts) BEFORE calling `update_answers_block`.
- Mirror the existing fresh-reveal "AUTHOR PER-CARD NARRATIVE" branch (`scheduledPrompts.ts:775`) so the reprocess path no longer diverges from the reveal path on narrative.
- Prompt-only. No new code, no new payload field. Re-authoring on every reprocess is always-safe since reprocess is rare and explicit (admin-initiated).

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `trivia-reveal-in-cards`: add a requirement that reprocessing an already-posted batch re-authors the per-card narrative (when the axis is `"yes"`), so it conforms to the current reveal mode and re-derived verdicts.

## Impact

- `src/plugins/trivia/prompts/triviaCheckInstruction.ts` — the "Correcting an already-posted batch" runbook (steps 1–3) gains a narrative-authoring step.
- No code, type, or payload changes. No migration.
