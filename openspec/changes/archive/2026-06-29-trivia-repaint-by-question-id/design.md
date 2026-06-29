## Context

`update_answers_block` is the sole editor of already-posted trivia question cards. Today it is keyed on `batchId` — a UUID minted by `post_questions` and shared by all questions posted in one fire. The only place `batchId` reaches Claude is `compute_answers`'s reveal-time payload; no read tool exposes it. So in any *later* request ("update the cards", "fix the last batch") Claude no longer holds the value and fabricates one, producing the observed `no questions found for batchId "<GUID>"` / `"<timestamp>"` failures.

The question `id`, by contrast, is on every read path (`find_previous_questions` rows, `compute_answers` `reveals[].questionId`) and uniquely identifies a card. The card-edit loop is already per-question (each card rebuilds from its own `postedBlocks` + `messageLink`); `batchId` only ever served as a convenience selector that expands to a set.

## Goals / Non-Goals

**Goals:**
- Key the card repaint on a handle Claude can always read → eliminate the guessing.
- Keep `batchId` as the internal grouping key, but never surface it to Claude.
- Give Claude the *semantic* batch facts it actually needs (is this batch still live? is it the latest?) without the opaque id.
- One uniform, copy-pasteable repaint path referenced identically by every content-mutating tool.

**Non-Goals:**
- Auto-repaint inside mutators (explicitly rejected — see Decisions).
- Changing how batches are formed, stamped, or revealed (`compute_answers`'s batch grouping and `appendToPreviousBatch` are untouched).
- Any on-disk schema change or data migration.
- Removing `reprocessBatchId` from `compute_answers`'s input schema (left as a dormant internal input; instructions stop steering Claude to it).

## Decisions

### 1. Question id is the repaint handle; `batchId` goes internal-only
`update_answers_block({ game, questionIds: string[] })`. Selection becomes "load `questions.json`, pick rows whose `id ∈ questionIds`, repaint each in `postedAt` order." Missing ids are reported in a `notFound` array; an all-missing call errors. This subsumes both the old whole-batch behavior (pass every `reveals[].questionId`) and the old optional `questionIds` subset filter / mid-window-replay special case (pass one id).

*Alternative considered — expose `batchId` on read tools so Claude can pass it back.* Rejected: it leaks an opaque join key into the reasoning surface for no benefit. The id is already universal and names the exact card; the batch handle adds an indirection that was the entire source of the bug.

### 2. Read tools surface derived batch facts, not the id
`find_previous_questions` adds two booleans per **posted** row, computed within the row's game (batch ids are unique only per game):
- `batchPending` — no question sharing this row's `batchId` has `processedAt` set (the batch is unrevealed: live, votes open).
- `batchIsLatest` — this row's `batchId` is the one whose max `postedAt` is greatest among the game's batched rows.

These are derived at projection time from the same in-memory question set the tool already loads (the `recentBatchFromNow` path proves the grouping is cheap). Unposted/legacy rows (no `batchId`) omit both. Claude reasons "last batch + still pending = the live round I can top up or replay mid-window" without ever seeing a GUID.

*Alternative — a dedicated `describe_batch` tool.* Rejected as premature; the facts ride along on the search rows admins already pull.

### 3. No auto-repaint; uniform `refreshHint` instead
Each content-mutating tool (`settle_question`, `override_answer`, `remove_cheat`) returns a `refreshHint` string naming the exact next call: `update_answers_block(game, questionIds: ["<id>"])`. Repaint stays a single explicit step that fires once.

*Alternative — auto-repaint inside each mutator (via a shared helper).* Rejected after analysis: the scoring mutators are chained (three `override_answer` calls on one card → three redundant `chat.update`s), and `remove_cheat` un-excludes an answer that only gets scored by a subsequent `compute_answers` pass — so an auto-repaint there can render pre-rescore state. Auto-repaint is only unambiguously safe for the terminal, single-card `settle_question(invalidate)` case; rather than special-case one tool, all three use the uniform hint and repaint fires at chain end where it is correct. The reliability concern that motivated auto-repaint (Claude forgetting the handle) is already solved by Decision 1 — the hinted call is now unambiguous.

### 4. `compute_answers` stops surfacing `batchId`
The renderer contract changes from "call `update_answers_block` with the returned `batchId`" to "call it with `reveals.map(r => r.questionId)`." `batchId` is removed from the payload. `reprocessBatchId` stays in the input schema (dormant) so the internal capability and its spec scenarios are preserved, but instructions drive reprocess via `reprocessQuestionIds`.

## Risks / Trade-offs

- **Whole-batch repaint now requires enumerating ids** → `compute_answers` already returns every `reveals[].questionId`, so the reveal flow passes them directly; no new lookup. Net: one array instead of one string, both already in hand.
- **`reprocessBatchId` becomes Claude-unreachable** (no batchId source) → acceptable: `reprocessQuestionIds` covers every documented flow, and the input stays for internal/legacy use rather than churning the reveal-processor spec's batch-selection scenarios.
- **Larger test surface** (every `update_answers_block` call site changes shape) → mechanical migration; the new per-id semantics are strictly simpler to assert (name ids, check those cards edited).
- **Batch-fact correctness across games** → both booleans are computed per the row's own game; the multi-game scan path must group before deriving, mirroring `recentBatchFromNow`.
