## Why

When the freeform judge gets a verdict wrong, or a cheat is recorded against the wrong person (or for the wrong reason), an admin has no corrective path today. The only existing levers are blunt: `compute_answers` reprocess **re-judges** freeform via Haiku (it can't hand-set a verdict, and a re-run can flip the admin's intended outcome right back), and `save_cheating` is **append-only** with no way to undo a bad report or roll back the cumulative `cheatAttempts` counter it incremented. An admin who disagrees with the machine has to live with it.

This change adds two narrow, admin-only correction tools that let an admin set the record straight by hand — without re-running the judge and without leaving the cumulative counters inconsistent.

## What Changes

- **New `override_answer` tool** (admin, always-on — sibling of `get_question_history`). Sets a freeform/boolean/choice answer row's `correct` verdict by hand and a **required** human-readable `reason` (stored as the row's `judgeReason`). Captures the pre-override verdict into `originalVerdict` so the machine's original judgment is never lost.
  - **Protection: post-reveal only.** The tool refuses unless the targeted question has been revealed (`processedAt` is set). There is nothing to override before a verdict exists, and gating to post-reveal removes the foot-gun of "fixing" a row the reveal hasn't judged yet.
  - The tool result reports whether the reveal was already posted and, if so, points the admin at the existing refresh path (`compute_answers` reprocess → `update_answers_block`) so the visible card catches up to the corrected verdict.
  - **Restore mode (`restore: true`).** Undoes a prior override: copies `originalVerdict` back into `correct`/`judgeReason`, deletes `originalVerdict`, and the row re-enters normal reprocess re-derivation (the machine regains control). Refuses with a structured error when there is no `originalVerdict` to restore. In restore mode `correct`/`reason` are not used.
- **Reprocess preserves manual verdicts.** A row with `originalVerdict` set (i.e. it was manually overridden) is **skipped during reprocess re-derivation** (no boolean/choice recompute, no freeform re-judge) but its stored verdict is **still projected into the reveal buckets**. So `compute_answers` reprocess + `update_answers_block` refreshes the posted card to show the admin's override instead of silently clobbering it on the next run.
- **New `remove_cheat` tool** (admin, always-on — sibling of `save_cheating`). Removes the cheat report(s) matching a `(game, cheaterUserId, questionId)` from the game's `cheats.json` and **decrements** the global cumulative `cheatAttempts` counter by the number removed (floored at 0). Because cheats filter scoring at reveal time, the result points the admin at the same reprocess refresh path when the affected question was already revealed.

Both tools are atomic data fixes only — neither re-renders a Slack message on its own. Re-rendering stays the deliberate, already-specified two-tool flow (`compute_answers` reprocess → `update_answers_block`).

Deferred to a separate change: the user-facing "why was my answer refused?" conversational path (thread→question association, a member self-read tool, and an instruction). That path needs new plumbing (questions don't store their posted `ts`, and there is no member-level self-answer read tool) and is independent of these admin correction tools.

## Capabilities

### New Capabilities
<!-- none — this extends existing reveal-processor and cheating-detection capabilities -->

### Modified Capabilities
- `trivia-reveal-processor`: adds the `override_answer` admin tool (hand-set a verdict on a revealed question, post-reveal gate, `originalVerdict` capture); reprocess now skips re-derivation for rows with `originalVerdict` set while still projecting their stored verdict.
- `trivia-cheating-detection`: adds the `remove_cheat` admin tool (remove matching cheat reports and decrement the global counter, floored at 0).

## Impact

- Code: new `src/plugins/trivia/tools/reveal/overrideAnswer.ts` and `src/plugins/trivia/tools/answers/removeCheat.ts`; registration in `src/plugins/trivia/index.ts` (both admin, always-on, NOT topic-gated); `src/plugins/trivia/answerTypes/freeform.ts` (+ shared reprocess flow) to honor the `originalVerdict` skip; `src/plugins/trivia/core/types.ts` (`SubmittedAnswer.originalVerdict`); `src/plugins/trivia/core/dataLayer.ts` (a `removeCheat` helper + counter decrement).
- Data: `SubmittedAnswer` gains an optional `originalVerdict?: { correct: boolean; judgeReason?: string }` field (absent = never overridden, backwards compatible — no migration). Cheat removal is an in-place rewrite of an existing array; no schema change to `CheatReport`.
- Behavior: both tools are admin-gated and only reachable by an explicit admin call. Default reveal (oldest pending batch) and the existing reprocess semantics for non-overridden rows are unchanged.
