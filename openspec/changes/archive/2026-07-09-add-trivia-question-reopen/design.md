# Design: add-trivia-question-reopen

## Context

Trivia question records live in `games/<game>/questions.json` and move through a lifecycle stamped entirely by optional fields: `postedAt`/`messageLink`/`postedBlocks`/`batchId` (posting), `answerLocked` (lock), `resolved`/`resolvedAt`/`resolvedOutcome` (settle), `invalidated`/`invalidatedReason` (invalidate), `processedAt` (reveal scoring). Recovery machinery already half-exists: raw answer rows are never deleted (only verdicts are cleared), `postedBlocks` lets any card state be rebuilt, and every mutator returns a `refreshHint` pointing at the single card editor. What's missing is the inverse transition (invalidated → back) and a card editor that can paint non-terminal states.

Three defects interlock:

1. `settle_question` has no reopen verb, and its answer path doesn't clear `invalidated` — so `invalidated: true` wins forever in both `compute_answers` (skips scoring, stamps `processedAt`) and the card projector (paints ❌).
2. `update_answers_block` only knows two states (revealed, invalidated). A keyed-but-unprocessed question gets the results footer painted — an answer leak — and a keyless one is skipped entirely, so a reopened card can never be restored.
3. `compute_answers` reprocess mode accepts targets that were never processed, stamping `processedAt` on live questions — leaking the answer via (2) and silently removing the question from the pending-batch reveal flow.

Additionally, two tool names lie: `update_question` only writes reveal narrative (`revealBlocks`), and `update_answers_block` names an implementation detail. And `settle_question`'s description references `skip`/`skippedReason`/`skipped` — args and fields that have never existed (schema: `invalidate`/`invalidatedReason`; record field: `invalidated`).

## Goals / Non-Goals

**Goals:**

- Make invalidation reversible via an atomic, invariant-preserving tool verb.
- Make the card projector a total function of record state: invalidated / revealed / locked / live.
- Close the two `processedAt` integrity holes (projection leak, reprocess stamp-on-live).
- Rename the two misnamed tools; fix the `settle_question` description drift.
- Teach the reveal prompt the recovery flow so future incidents are fixable conversationally.

**Non-Goals:**

- A "defer" verb for the prediction gate (carry an unresolvable prediction to a later batch). Explicitly rejected: rare, and reopen makes wrong invalidations recoverable.
- Content editing (statement/choices/category/hint/media) — a future `update_question_metadata` whitelist tool if a real need appears.
- Deleting questions (staged or posted).
- Per-question unlock (unlock stays game-wide).
- Refreshing an already-posted reveal *summary* message after a re-score (next reveal self-corrects totals).

## Decisions

### D1: Reopen lives on `settle_question`, not a new tool and not `update_question`

`settle_question` is already the fate-decider (answer / invalidate / re-settle-with-override) and already branches on `hasAnswerKey`. Reopen is the exact inverse of invalidate, so it becomes the third mutually-exclusive verb: exactly one of `outcome`, `invalidate`, `reopen`. Alternatives rejected: a dedicated `reopen_question` tool (splits fate logic across tools for no gain); hanging it on `update_question` (that tool is the narrative writer, and its `includeRevealInQuestions: "no"` gate would wrongly block reopening).

**Reopen semantics** (single `updateQuestion` patch, atomic per the data layer's read-modify-write):

- Always: `invalidated: undefined`, `invalidatedReason: undefined`.
- When keyless (`!handler.hasAnswerKey(question)`): additionally `resolved: false`, `resolvedAt: undefined`, `resolvedOutcome: undefined` — a never-settled prediction returns to pending.
- When keyed: `resolved`/`resolvedAt`/`resolvedOutcome` stay — a settled-then-invalidated question returns to settled (re-correct via `override: true` if the key is also wrong).
- `processedAt` is NEVER touched. A question invalidated *before* its reveal (never processed) returns to the pending flow and reveals normally with its batch; one invalidated *at/after* its reveal (processed) stays out of the pending flow — its recovery completes via `compute_answers` reprocess, which requires `processedAt` (D2). This keeps the scheduled reveal cadence undisturbed, keeps the reprocess guard consistent, and means the scheduled reveal prompt can never re-invalidate an in-recovery question.
- Errors when the question isn't invalidated (nothing to reopen) — same no-op-on-error contract as the other verbs.
- Answer rows untouched: verdicts were already cleared at invalidation; `compute_answers` reprocess re-derives them from retained raw picks after the question is settled again.
- Returns `refreshHint` (plain repaint — the card must show its restored live/locked state; scoring comes later via settle + reprocess).

Field deletion needs no data-layer change: `updateQuestion` merges via object spread and `JSON.stringify` drops `undefined` values, so passing `field: undefined` removes it from disk. `answerLocked` is deliberately not touched — a reopened question that was locked stays locked, which the state projector then renders correctly.

### D2: `processedAt` is the single "answer is public" bit — no new `answerRevealed` flag

The moment `compute_answers` scores a question, the reveal summary posts and the answer is public knowledge; `processedAt` records exactly that. An explicit `answerRevealed` flag would be stamped and cleared in lockstep with `processedAt` in every legitimate flow — a second source of truth that can only drift. Instead the invariant is enforced at both ends:

- **Projection** (D3) never paints the results footer unless `processedAt` is set.
- **Reprocess guard**: `compute_answers` reprocess mode records a per-id error for any target whose `processedAt` is unset ("not yet revealed — nothing to reprocess") and skips it, mirroring the existing per-id error style. This closes today's hole where reprocessing a live question stamps `processedAt`, leaks the answer, and steals the question from the pending batch.

### D3: The card projector becomes state-complete and is renamed `refresh_question_cards`

Projection order per card (first match wins), all rebuilt from stored `postedBlocks`:

```
invalidated: true                        → ❌ invalidated line (existing editInvalidatedIntoCard)
hasAnswerKey && processedAt !== undefined → results footer + narrative + post-game buttons (existing editRevealIntoCard)
answerLocked === true                    → locked notice, buttons removed (live-state rebuild)
otherwise                                → live card: original buttons + current roster footer
```

The live/locked rebuild is not new rendering — it's the same projection `transitionLock` (`tools/lock/applyLock.ts`) and the roster editor already perform. Implementation extracts/reuses that path so there is exactly one way to render each state (`postedBlocks` always contains the full original actions block, so buttons — hint button included — restore for free). Questions without `postedAt`/`postedBlocks` (staged or legacy) are skipped with the existing warning path.

This replaces today's behavior of *skipping* keyless cards: a reopened pending prediction now repaints from ❌ back to its live/locked look in one call. It also fixes the leak: keyed-but-unprocessed now renders live/locked, never the footer.

Rename rationale: `update_answers_block` names a Block Kit implementation detail; `refresh_question_cards` names the contract (make these cards match disk). The rename is internal-only — tool names appear in prompts, `refreshHint` builders (`core/refreshHint.ts`), tool descriptions, i18n labels, and tests; nothing persisted or external stores them. Same reasoning for `update_question` → `set_reveal_narrative` ("set" matches its replace-never-append semantics).

### D4: Recovery flow is prompt-taught, not automated

The blessed sequence for an operator (documented in the settle/reveal tool descriptions and the reveal prompt):

1. `settle_question({ reopen: true })` → flags cleared.
2. `refresh_question_cards([id])` → card restored (live or locked).
3. Once the outcome is known: `settle_question({ outcome })` (plain — the question is keyless again).
4. `compute_answers({ reprocessQuestionIds: [id] })` → verdicts re-derived from retained raw picks (legal: the question kept its `processedAt` from the invalidated reveal).
5. `refresh_question_cards([id])` → results footer painted; scores flow into the next leaderboard.

For a question that was invalidated *before* it was ever revealed (no `processedAt`), steps 3–5 are unnecessary: after reopen + repaint it simply reveals with its batch through the normal scheduled flow. The recovery of an already-revealed question is entirely admin-driven — because `processedAt` survives reopen, the scheduled reveal never picks the question up again, so there is no cadence disturbance and no re-invalidation churn; the flip side is that nothing nags about an unfinished recovery (accepted: reopen is an admin verb, and the `refreshHint`/tool result spell out the remaining steps).

### D5: Description drift fixed in the same change

`settle_question`'s DESCRIPTION is rewritten to use the real names (`invalidate`, `invalidatedReason`, record field `invalidated`) and to document the reopen verb. This drift (present since the tool's first commit) is what led the bot to describe nonexistent `skipped` fields to an operator during the motivating incident.

## Risks / Trade-offs

- **[Reopened never-revealed prediction gets re-invalidated]** A question invalidated *pre-reveal* and reopened returns to the pending flow; if its event *still* hasn't happened when its batch reveals, the prompt's "outcome unavailable → invalidate" rule kills it again. → Acceptable churn: reopen makes it recoverable again, and the prompt's recovery note tells Claude to mention the reopen path when invalidating. (A defer verb is the real fix and is an explicit non-goal.) Already-revealed reopens are immune — they keep `processedAt` and never re-enter the scheduled flow.
- **[Live-repaint duplication]** If the projector reimplements the live-card render instead of sharing `transitionLock`'s path, the two renders drift (e.g. hint button, roster grouping). → Extraction into one shared live-projection helper is a hard requirement of the tasks, not an optional cleanup.
- **[Rename fallout]** A stale prompt/instruction/doc still naming `update_answers_block` or `update_question` would make Claude call a nonexistent tool. → Repo-wide grep for both names is a task; `refreshHint` builders are the single source for hint wording so mutator results can't drift.
- **[Stale reveal summary after recovery]** The already-posted reveal summary message still mentions the old invalidation after a recovery completes. → Accepted (summary refresh is a non-goal); the next reveal's leaderboard reflects corrected scores, and Claude can post a follow-up correction conversationally.
- **[Operator reopens a healthy question]** Reopen requires `invalidated: true`, so the blast radius is limited to invalidated questions; a mistaken reopen is undone by re-invalidating (verdicts on an invalidated question were already cleared, so no scoring state is lost).

## Migration Plan

None needed. No schema change (fields are only removed from records), no persisted references to tool names, no config change. Deploy is a normal image roll; the renamed tools register at boot.

## Open Questions

None — resolved during exploration: reopen placement (settle_question), no `answerRevealed` flag (`processedAt` + guards), rename targets and names, defer explicitly out of scope.
