## Context

Two per-question config fields are frozen at write time and read back from the stamped value at reveal:

- `revealResponses` — resolved from the cascade and stamped by `post_questions` (`postQuestions.ts:326-334`); read at projection by every answer-type handler (`boolean.ts:233`, `choice.ts:303`, `freeform.ts:535` via `question.revealResponses ?? "yes"`).
- `judgeLeniency` — resolved and stamped by `save_question` (`saveQuestion.ts:333`); read by the freeform judge.

Freezing is deliberate and shared with the documented "policy in effect when posed" principle (`trivia-judge-leniency` spec, "judgeLeniency Stamped on the Question Record"). The gap is that there is no *escape hatch*: once a batch is posted, an admin who edits `revealResponses`/`judgeLeniency` cannot apply that edit to the already-posted batch. `compute_answers` already has a reprocess mode (`reprocessQuestionIds`) whose semantic is "re-derive each verdict from the question's CURRENT answer key" — but it re-derives from the key only, ignores config, and explicitly refuses freeform.

## Goals / Non-Goals

**Goals:**
- Let an admin apply a `revealResponses` or `judgeLeniency` change to an already-posted batch, through the existing atomic tools, with no new tool.
- Keep the freeze-at-write-time default intact: config edits still only affect future batches *unless* the admin explicitly reprocesses.
- Make freeform re-judgeable in reprocess mode using the re-stamped leniency.

**Non-Goals:**
- No new MCP tool, and no change to `update_answers_block` (already idempotent/reconciling).
- No automatic/implicit re-stamping anywhere outside the explicit reprocess path; default reveal (oldest pending batch) is untouched.
- No re-stamping of structural/answer-key fields beyond the existing key re-derivation (that already works) and the two config fields named here.
- Not re-opening Slack modals or re-collecting answers — only stored `answerText` is re-judged.

## Decisions

### Decision 1: Extend reprocess semantics rather than add a tool
Reprocess already means "bring this question's verdicts in line with the current key." We widen it to "...the current key AND current config." So in reprocess mode, before scoring each targeted question, the tool re-resolves `revealResponses` (all formats) and `judgeLeniency` (freeform only) from the live cascade and re-stamps them on the question record.

The per-question cascade context is rebuilt from the question's OWN stamped identity — `slot.index` and `season` on the `TriviaQuestion` record (`types.ts:152,158`) — passed to `buildCascadeContext(season, game, slotIndex, config)`, the SAME identity `post_questions` used when it first stamped the field. This is what makes a batch spanning multiple season-format slots resolve each question at its correct tier. Questions with no stamped `slot`/`season` (legacy/single-question rows) resolve through the game/workspace tiers exactly as they did at post time.

The re-stamp is isolated per question: if context rebuild or resolution throws for one question, the tool records a per-id error and skips that question (leaving its stamped value untouched — never a silent clobber), reusing the existing `perIdErrors` accumulation. A re-stamp whose resolved value equals the stamped value is a harmless overwrite.

*Alternative considered:* a dedicated `reapply_to_batch` tool. Rejected — the user's framing is correct that the capability is "reprocess the answers," and the tools are intentionally atomic; a second tool that re-stamps then defers scoring to `compute_answers` would just split one concept across two calls.

### Decision 2: Freeform reprocess = re-judge the whole retained set, overwriting in place
Lift the "freeform reprocess not supported" rejection. The judge path is gated by which rows it *selects*: default reveal judges only `correct === undefined` rows; reprocess selects EVERY retained row and writes the new verdict, which supersedes the prior one (the verdict write always sets `judgeReason`, so a reasonless re-judge clears a stale reason). Because step-1 re-stamped `judgeLeniency`, the re-judge uses the new preset. No separate reset pass and no extra write — the raw `answerText` is never modified or deleted.

*Alternative considered:* a reset pass that blanks each verdict to `undefined` before judging. Rejected — it adds a redundant write per row and creates a window where a transient judge failure blanks a previously-good verdict. Selecting all rows and overwriting is simpler and leaves a failed re-judge's prior verdict intact.

### Decision 3: Add `reprocessBatchId` as a batch-level target
`reprocessQuestionIds` requires enumerating IDs. Add an optional `reprocessBatchId` that expands to every question whose `batchId` matches (or the single legacy row whose `id` matches), mirroring `update_answers_block`'s `selectBatch`. Reprocess mode is entered when EITHER `reprocessQuestionIds` is non-empty OR `reprocessBatchId` is set. If both are provided, the union is processed.

*Alternative considered:* only IDs. Rejected — the admin's mental unit is "the last batch," which is exactly the `batchId` `update_answers_block` already consumes; sharing it keeps the two-step flow symmetric.

### Decision 4: Re-stamp is unconditional within reprocess, but a no-op when unchanged
Reprocess always re-resolves and writes the current cascade value. When the resolved value equals the stamped value, the write is a harmless overwrite. This avoids a "which fields?" argument on the tool and matches the existing "stamp `processedAt` unconditionally" behavior. The instruction layer — not the tool — decides *when* an admin should reprocess.

## Risks / Trade-offs

- **Re-judging is non-deterministic (model judge)** → a reprocess of unchanged-leniency freeform could flip a borderline verdict. Mitigation: reprocess is explicit and admin-initiated; the exact-match pre-check still short-circuits deterministically; document that reprocessing freeform re-runs the judge.
- **Reprocess now mutates config-derived fields, not just verdicts** → a caller expecting the old "verdicts only" semantic could be surprised. Mitigation: this is internal tool semantics behind an admin-only, explicit path; the spec delta states the widened contract and the `wasReprocessed` flag still signals a corrective run.
- **Targeting the wrong batch** → `reprocessBatchId` edits whatever batch matches. Mitigation: same handle `update_answers_block` already uses; the management instruction tells Claude to confirm the batch (e.g. via `get_question_history`) before reprocessing.
- **Claude re-running the reveal cron instead** (the original incident) → Mitigation lives in the management-instruction requirement: explicit prohibition on `run_scheduled_message_now` for config application, plus the honesty rule.

## Migration Plan

No data migration. Existing stamped fields are overwritten in place only when a batch is explicitly reprocessed; never-reprocessed batches keep their values. Legacy rows without a stamp continue to default (`revealResponses → "yes"`, `judgeLeniency → "strict-with-typos"`). Rollback is reverting the code; no persisted shape changes.
