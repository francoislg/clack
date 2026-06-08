# Design

## Decision 1: Always-on admin tools, not the `trivia:management` server

`override_answer` and `remove_cheat` are registered as **admin-level, always-on** tools — the same shelf as `get_question_history` (admin, always-on) and `save_cheating` (member, always-on) — NOT bound to the attach-gated `trivia:management` server alongside `upsert_game`/`upsert_season`/etc.

Rationale: the management server houses **config** mutation (games, seasons, categories) and is deliberately behind `attach_integration("trivia:management")` because admins reach for it as a deliberate management session. These two tools are **runtime-data corrections** an admin makes ad hoc, in the very thread where they spotted the bad verdict or bad cheat. Forcing an `attach_integration` round-trip to fix a single verdict is friction with no payoff, and it splits a coherent capability (the corrective siblings of `save_cheating`/`get_question_history`) across two surfaces. Role gating (`admin`) still applies; the read-side cheat-privacy rule (cheat data is admin-only) is satisfied because both tools are admin-gated.

## Decision 2: Post-reveal gate is the override "protection layer"

`override_answer` refuses unless the targeted question has `processedAt` set (it has been revealed). Two reasons:

1. **There is nothing to override pre-reveal.** Freeform rows are `correct === undefined` until the reveal judges them; boolean/choice are computed at submit but the reveal hasn't run. Letting an admin set a verdict before the reveal would race the judge.
2. **It removes the foot-gun.** The admin's mental model is "I saw the posted result and it's wrong." Gating to post-reveal matches that model exactly.

The error for a not-yet-revealed question is structured and explicit ("question has not been revealed yet; nothing to override").

## Decision 3: `originalVerdict` is both the lock and the audit record

The crux. Reprocess (`compute_answers` reprocess) re-derives **every** retained row's verdict — boolean/choice recompute against the key, freeform re-judge via Haiku. Without protection, the sequence `override_answer` → (later) reprocess silently reverts the admin's fix.

Rather than a bare boolean lock, the marker is `SubmittedAnswer.originalVerdict?: { correct: boolean; judgeReason?: string }` — a snapshot of the verdict in effect **before the first manual override**. Its **presence** is the lock signal; its **contents** preserve the machine's original judgment.

```
   for each retained row of the question:
     if row.originalVerdict is set:        // was manually overridden
        ── SKIP re-derivation (no recompute, no re-judge)
        ── KEEP row.correct / row.judgeReason as stored
        ── still INCLUDE the row in the projected reveal buckets
     else:
        ── re-derive verdict as today (boolean/choice recompute, freeform re-judge)
```

This makes "atomic data fix, then refresh the card via the existing reprocess flow" coherent: reprocess **re-projects buckets from the stored `correct` values**, which now include the override, so `update_answers_block` renders the corrected card — it just doesn't re-judge the locked row. The override survives every future reprocess.

**Capture-once semantics.** `override_answer` writes `originalVerdict` only when it is **absent** (the first override snapshots the machine's `{ correct, judgeReason }`). A second override changes `correct`/`judgeReason` but leaves `originalVerdict` untouched, so the machine's *original* judgment is preserved — not overwritten by an intermediate manual value. This is the difference between "the verdict right before this edit" and "what the machine originally decided"; the latter is what's worth keeping for audit and for a possible restore.

**Restore mode ships in v1.** Because the original is retained, `override_answer` also accepts `restore: true`, which copies `originalVerdict` back into `correct`/`judgeReason`, deletes `originalVerdict`, and the row re-enters normal reprocess re-derivation. (The boolean lock could not have offered this.)

## Decision 4: Either-or params are handler-enforced, not schema-expressed

The SDK's `tool()` takes a `ZodRawShape` — a flat object of named fields wrapped in `z.object(...)`. A top-level `z.discriminatedUnion`/`z.union` is not a raw shape (and an MCP tool's input schema must be `type: object` regardless), and there is no seam to attach a `.superRefine()` cross-field constraint. Even a refinement wouldn't help steer the model, since refinements don't serialize into the JSON Schema Claude sees.

So `override_answer`'s two call shapes — override `{ correct, reason }` vs `restore: true` — are expressed as a flat shape with `restore?: boolean` the discriminator and `correct?`/`reason?` optional at the schema level. The handler enforces the rule:

```
   restore === true   → restore mode:  require originalVerdict present; ignore correct/reason
   restore not set     → override mode: require correct (boolean) AND non-empty reason
```

The tool description documents both shapes explicitly. This mirrors the repo's existing convention (null-to-clear/omit-to-keep in `upsert_game` is all handler-validated, not schema-expressed).

Coordination note: this interacts with the in-flight `trivia-reprocess-reapplies-config` change, which broadens reprocess to re-judge freeform. The `originalVerdict` skip is an additive guard that sits in front of that re-judge; both are additive and compose (skip wins over re-judge for overridden rows).

## Decision 5: `remove_cheat` decrements the global counter, floored at 0

`save_cheating` appends a report AND increments the **global, cross-game, cross-season** `cheatAttempts` counter on `users.json`. The inverse must undo both: remove the matching report(s) from the game's `cheats.json` and decrement the counter by the number of reports removed, floored at 0 (a counter can never represent a negative tally, and historical drift shouldn't push it below zero).

Matching is by `(game, cheaterUserId, questionId)`. If multiple reports match (the same user flagged twice on the same question), **all** matching reports are removed and the counter drops by that count — the admin's intent ("this person did not cheat on this question") covers every report for that pair. A no-match call is a structured "no matching cheat" result that mutates nothing (idempotent, safe to retry).

The owner DM that `save_cheating` emits has no inverse — removal is silent (no "un-cheat" DM), consistent with corrections being a quiet admin action.

## Decision 6: Re-render stays the existing two-tool flow

Neither tool re-renders a Slack message. The reveal-card refresh is already a specified, atomic two-tool flow (`compute_answers` reprocess → `update_answers_block`) that the admin instruction documents. Both new tools' results **point at** that flow when the affected question was already posted, rather than re-implementing rendering. This keeps each tool a single-responsibility data mutation and avoids coupling correction logic to the reveal renderer.

## Open questions

- **Override scope beyond freeform?** Boolean/choice verdicts are deterministic from the key; the "right" fix for a wrong boolean/choice verdict is usually to correct the key (`isTrue`/`correctIndex`) and reprocess. `override_answer` still accepts them (a per-user exception is occasionally legitimate — e.g. a known client glitch), but the tool description should steer boolean/choice corrections toward fixing the key first.
- **Audit trail.** v1 stores `originalVerdict` (the machine's original `{ correct, judgeReason }`) plus the overriding `reason` in `judgeReason`. It does NOT record *who* overrode or *when*. If that need emerges, a small `overriddenBy`/`overriddenAt` pair can be added later without disturbing the `originalVerdict` lock semantics.
