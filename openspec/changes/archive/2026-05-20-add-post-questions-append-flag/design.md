## Context

`post_questions` stamps a per-call `batchId` UUID on every fresh question it posts. `process_reveal_answers` reveals exactly one batch per fire (oldest by `min(postedAt)`), so partial retries land in a separate batch and split a single logical "round" across two reveals — observed in production on 2026-05-20 (see proposal).

Two pieces shape the design space:

1. The only callers of `post_questions` today are Claude turns inside a scheduled cron prompt. Claude can read the prior call's results but it does not durably remember a UUID across turns the way it remembers a flag. A boolean flag is the lower-cognitive-load API for the LLM.
2. Once a batch has been revealed (`process_reveal_answers` stamps `processedAt` on every question in the batch), appending more rows to that batchId would resurrect a closed round. The reveal flow does not re-process a batch — it only reveals each batch once — so appended-after-reveal rows would never reveal and would silently leak.

## Goals / Non-Goals

**Goals:**
- Let Claude opt into "this call is a continuation of the previous batch" with a single boolean argument, with no UUID handling on the prompt side.
- Make append-after-revealed-batch an explicit failure mode (atomic; no Slack posts, no record mutations) rather than silent data loss.
- Preserve the existing default-mode behavior bit-for-bit when the flag is absent or false. Idempotent-skip semantics stay identical.
- Keep `process_reveal_answers` unchanged — the existing "group by `batchId`, pick oldest pending" logic naturally handles a unified batch.

**Non-Goals:**
- Re-revealing or re-processing an already-revealed batch. The flag does NOT enable that; it only blocks it explicitly.
- Auto-detecting that this is a retry. The flag is explicit — Claude must opt in. (Implicit "is this a retry?" detection is fragile and surprising.)
- Persisting a "currently-being-built batch" cursor for a game. We compute the most-recent batch on demand from `questions.json`; no new state file.
- Recovering legacy rows that have `postedAt` but no `batchId`. They remain singleton batches as today.

## Decisions

### Decision: Use a boolean flag `appendToPreviousBatch`, not a `batchId` arg

**Choice:** Add `appendToPreviousBatch: boolean` (default `false`).

**Alternatives considered:**
- **Explicit `batchId` string arg.** Lets the model thread a UUID; flexible but the model must extract the UUID from the prior tool result and pass it back on the retry. More moving parts in the prompt and more failure modes (typos, wrong batchId).
- **Auto-detect retry by content.** Look at `items[]` and infer "all items in this call are fresh, and the game has a recent batch with `processedAt` undefined → must be a retry". Surprising and brittle when the operator deliberately starts a new batch shortly after an unrelated one.

**Rationale:** A boolean is the smallest viable surface area for the prompt to instruct Claude on. The lookup ("what's the most recent batchId for this game?") is cheap (already reading `questions.json`) and unambiguous when the input is a single bit.

### Decision: "Most recent batch" = the batch whose maximum `postedAt` is the latest

**Choice:** Among the questions in `games/<game>/questions.json` that carry a `batchId`, group by `batchId` and pick the group whose `max(postedAt)` is the largest. That group is the "previous batch" the flag appends to.

**Alternatives considered:**
- **Minimum `postedAt` per group.** Would mean "oldest start of any pending batch" — picks the wrong batch when multiple batches overlap or when a long batch began before a short subsequent one.
- **Persist a per-game "current batch cursor" file.** Adds state and a new write path; harder to reason about under concurrent calls.

**Rationale:** Maximum-`postedAt` matches the operator intent: "the batch I just posted into, the one whose most recent message is the freshest." Computed directly from the existing data; no new state.

### Decision: Fail atomically if the most-recent batch is already revealed

**Choice:** Before stamping any item, check whether ANY question in the resolved previous batch has `processedAt` set. If yes, return an error result for the whole call (no Slack posts, no row mutations). The error names the offending batchId and the question ids whose `processedAt` is set so Claude (or an operator) understands why.

**Alternatives considered:**
- **Allow append but mark the appended items as "post-reveal" somehow.** Pollutes the reveal model — the existing reveal flow has no concept of "this row joined the batch after the verdict shipped."
- **Silently mint a new batchId instead of failing.** Looks helpful but masks the operator's mistake; the next reveal would then surface a separate batch they did not expect.

**Rationale:** Append-after-revealed is operator error or stale state. Failing loudly is the only safe choice — silently re-routing would either re-reveal a closed round or silently orphan the rows.

### Decision: Fail atomically if no prior batch exists

**Choice:** If the game has no questions with a `batchId` (or no questions at all), `appendToPreviousBatch: true` is a hard failure with a clear error message. The fallback is NOT to mint a fresh batchId — that would defeat the purpose of the flag (which is "I am extending an existing batch").

**Rationale:** The flag is opt-in and explicit. Silently falling back to default-mode would hide a real bug in the caller's logic (e.g. retry firing in a context where no original call ever happened).

### Decision: Idempotent-skip semantics stay identical

**Choice:** An item whose question already has `postedAt` set is still skipped and its existing `batchId` is preserved — regardless of the flag value. The flag only affects how the `batchId` for NEW (freshly-posted) items is chosen.

**Rationale:** Idempotency is a separate concern from batch routing. Mixing them would surprise callers.

### Decision: No changes to `process_reveal_answers`

**Choice:** The reveal tool keeps its "group by `batchId`, pick oldest pending batch" semantics. When `appendToPreviousBatch` works correctly, the retried items share the original batch's `batchId`, so the existing grouping naturally includes them.

**Rationale:** The bug is on the posting side; the reveal side is correct. Adding logic to the reveal side would be wasted complexity.

## Risks / Trade-offs

- **Risk:** A race where two operator calls both set `appendToPreviousBatch: true` and read the same "most recent" batch could both succeed and both stamp the same batchId.
  - **Mitigation:** That is the intended outcome — both calls extending the same batch is exactly the contract. The reveal flow handles arbitrary numbers of items per batch.

- **Risk:** If a question is later inserted into `questions.json` with a manually-set very-high `postedAt`, the next `appendToPreviousBatch` call would pick its batch as "most recent" even though the operator may have intended a different one.
  - **Mitigation:** Manual edits to `questions.json` are out-of-band. The risk is theoretical for the cron-driven flow; an admin tool that rewrites question rows would be a separate concern.

- **Trade-off:** The flag is per-call, not per-item. A mixed batch (some items extending, some starting fresh) is not expressible. That is acceptable: the only real-world caller is "retry the failures from the last call", which is uniformly an extension.

- **Risk:** Claude might use the flag in scenarios that are not retries (e.g. starting a new round but believing it should "continue" the previous one).
  - **Mitigation:** Prompt wording (`SEND_QUESTIONS_INSTRUCTIONS`) names the flag's purpose explicitly: "only when retrying items that failed in an earlier `post_questions` call within the same scheduled run." Plus the explicit-fail-on-revealed-batch guard catches any case where Claude tries to extend an already-closed round.

## Migration Plan

- No data migration. New rows continue to be stamped with a `batchId`; existing rows keep theirs.
- Roll-forward only. The flag is additive; defaulting to `false` preserves current behavior.

## Open Questions

- Should the failure-mode error structure include a hint like "this batch was revealed at <processedAt>"? Helpful for operators reading the trace; the implementation already has the timestamp available. Default to yes unless verbosity becomes a concern.
