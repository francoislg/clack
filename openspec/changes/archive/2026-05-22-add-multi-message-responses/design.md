## Context

Today, `submit_response` produces exactly one Slack message per call. The schema enforces this structurally: `blocks`, `table`, `reactions`, and `actions` live at the top level and describe the single deliverable. `post_to` actions stage *deferred* cross-posts (one message each, fired on button click or `auto: true`), but each `post_to` is itself singular.

This single-message model is right for thread replies — a structured Block Kit message handles 99% of cases, and splitting across messages clutters someone else's conversation. But it forces awkward workarounds for two genuine multi-message use cases:

1. **Scheduled (cron) deliverables** want an "announcement at top-of-channel + threaded detail" shape — a single payload that lands as a primary post with a threaded conversation underneath.
2. **`post_to` cross-posts** want the same shape — Claude prepares an announcement-style broadcast for another channel, with the same primary+thread structure.

The current schema can only approximate this by chaining multiple separate `post_to` actions, none of which share a thread relationship.

The user explicitly does NOT want this capability in pure thread-reply contexts. The instinct: Clack should not be allowed to fragment a user's conversation thread, even on request. Multi-message is for *publishing*, not *replying*.

## Goals / Non-Goals

**Goals:**

- Allow `submit_response` (in scheduled-trigger context) to deliver a primary + N additional/threaded messages atomically.
- Allow `post_to` actions to do the same, regardless of trigger context.
- Strict all-or-nothing validation: any error in any message → reject the entire batch, no partial delivery.
- Collect all validation errors and return them together, so Claude fixes everything in one retry.
- Cap `additional_messages` via operator config (default 5, bound `[1, 10]`).
- Cap `thread_replies` at a fixed sanity ceiling (20).
- Preserve full backward compatibility: every existing `submit_response` call continues to work unchanged.

**Non-Goals:**

- Multi-message support in pure thread-reply contexts (DM, @mention, reaction). The fields are absent from the schema entirely in those modes.
- True delivery-atomic semantics. We don't `chat.delete` already-posted messages when a mid-batch Slack API call fails — partial delivery is accepted as a recoverable state. Claude can re-submit on the next turn.
- Per-message `post_top_level` / `disengage` / `skip_response`. These are session-level signals, primary-only.
- Configurable `thread_replies` cap. The 20-ceiling exists only to prevent runaway loops; tuning it is not worth the config surface.
- Nested multi-message inside multi-message (an additional message that itself has additional messages). Out of scope and structurally unnecessary.

## Decisions

### Decision 1 — Two fields (`additional_messages` + `thread_replies`), not one

The two cases reduce operationally to "send N messages with a thread relationship," but their UX is meaningfully different:

```
additional_messages (post_top_level !== true):
  primary  ─ posted in the current thread
  +msg[i]  ─ siblings in the same thread (same thread_ts as primary)

thread_replies (post_top_level === true):
  primary  ─ posted top-level to channel (no thread_ts)
  +msg[i]  ─ replies under primary (thread_ts = primary.ts)
```

**Why two fields, not one with a routing knob:** the `post_top_level` flag already disambiguates. Forcing Claude to pick a routing target per message adds schema surface for zero expressive gain. The field name itself documents the intent — `additional_messages` reads as "more of the same," `thread_replies` reads as "start a thread under this."

**Alternative considered:** single `messages: MessagePayload[]` array replacing the primary fields. Rejected: massive blast radius (every call site, test, persistence layer reads `payload.blocks`), and the asymmetry between primary (which carries `message`, `post_top_level`, `disengage`) and followups would require either ugly schema unions or losing those primary-only fields.

### Decision 2 — Mode-exclusive with `post_top_level`

`additional_messages` requires `post_top_level !== true`. `thread_replies` requires `post_top_level === true`. The other combinations are rejected with a clear error.

**Why:** the alternative combinations don't have useful semantics. `thread_replies` without a top-level primary would mean "post replies to ... what thread? the existing user thread?" — but that's exactly what `additional_messages` already expresses cleanly. `additional_messages` with `post_top_level: true` would mean "post multiple top-level messages in the channel" — that's spam, even in publishing mode.

Cross-field validation is runtime (zod struggles to express it cleanly without losing type inference), surfaced as part of the all-at-once error list.

### Decision 3 — Gating via `allowMultiMessage` deps flag (top-level only)

Top-level `additional_messages` / `thread_replies` are exposed in the `submit_response` schema only when `SubmitResponseDeps.allowMultiMessage === true`. Today, the only handler that sets this is the scheduled-trigger (cron) one. All other triggers omit it.

**Why a hard schema gate, not just prompt discipline:** the user explicitly does NOT want Claude reaching for this in thread replies, even when asked. Schema gating means the fields simply don't exist for Claude to reach for. Prompt wording (the "rarely used" pattern) is one mistake away from over-use; a schema gate is structural.

**Why deps-flag, not config-flag:** the gate is per-trigger, not per-installation. A config flag would force all-or-nothing, where a deps-flag lets each trigger handler decide. Cron handlers opt in by default; everyone else opts out by default.

**Inside `post_to`**, the fields are NOT gated — they're always available. The rationale: creating a `post_to` is itself an explicit "I am publishing somewhere" choice. Adding a second gate on top of an already-explicit primitive is overconfiguration for one knob. If we later regret this, gating is a one-line change.

### Decision 4 — Caps: configurable for `additional_messages`, fixed for `thread_replies`

- `additional_messages` cap: `config.submitResponse.maxAdditionalMessages`, default **5**, valid range **[1, 10]**, rejected at `loadConfig` if out of range.
- `thread_replies` cap: hardcoded **20**.

**Why configurable for `additional_messages`:** noise tolerance differs per install (busy product channel vs. sleepy dev channel). Admins should tune without code changes. Bounded `[1, 10]` so a misconfig can't turn the bot into a flood gun.

**Why fixed for `thread_replies`:** Clack owns the thread it just created. Noise is self-imposed, not imposed on someone else's conversation. The ceiling exists only as a runaway guard, not as a tuning knob. Not worth the config surface.

**Why 5 / 20 specifically:** 5 covers the legit use case (e.g., "post each tournament result as its own message") while staying cheap if Claude misuses it. 20 is generous enough that hitting it indicates Claude is in a loop, not authoring a long thread.

### Decision 5 — Validation-atomic, collect-all-errors

Validation runs every gate across the whole batch (primary + every additional + every thread_reply + every post_to and its nested batch), collecting errors into a single array. If any error exists, the entire batch is refused with one `invalid_batch` result containing `details: string[]`.

**Why collect-all:** today's first-fail validation means Claude fixes one error, retries, hits the next, fixes, retries — N round-trips for N errors. Collect-all is one round-trip regardless of error count. Same refusal semantics, strictly better feedback.

**Error path format:** each entry carries a path like `additional_messages[1].blocks[0].text: too long (12345 chars, max 3000)` or `actions[2].thread_replies[0].actions[0].ref: unknown ref "xyz"`. Claude sees the full structure of what's wrong.

**Gates that walk the batch:**

| Gate | What it validates |
|---|---|
| `validateBlocks` | per message (primary + each follower + each post_to body + each post_to follower) |
| `validateTable` | per message |
| Length limit (10,000 chars per Slack message) | per message — each message gets its own budget |
| `validateActionButtonLabels` | per message that has `actions` |
| `validateRefActions` | across the whole batch — any ref-action anywhere must resolve in the intent store |
| `validateStagedIntentsCoverage` | across the whole batch — every staged intent must appear *somewhere* in the response |
| `validatePostToActions` | extended: walks both primary `actions` and follower `actions`; duplicate-channel guard sees the whole picture |
| Cross-field `additional_messages` × `post_top_level` | once, against the primary |
| Cross-field `thread_replies` × `post_top_level` | once, against the primary |
| Cap on `additional_messages.length` | from config, default 5, bound [1, 10] |
| Cap on `thread_replies.length` | fixed at 20 |

### Decision 6 — Sequential delivery, no rollback

Validation-atomic, not delivery-atomic. After all validation passes, deliver primary, then each follower in order:

```
primary → deliver({ blocks, ..., postTopLevel? })          → ts_primary
for additional in additional_messages:
  deliver({ blocks, ..., threadTs: <existing thread ts> })
for reply in thread_replies:
  deliver({ blocks, ..., threadTs: ts_primary })
```

The streamer (thinking indicator) is deleted exactly once, before the primary delivery — same as today. Followers post fresh.

**Why no rollback on mid-batch Slack failure:** Slack offers no transactional batch. Rolling back via `chat.delete` is best-effort, racy (someone might already be reading the thread), and adds significant complexity for an edge case. Real-world Slack API failures mid-batch are rare; when they happen, Claude sees a `delivery_failed` error and can recover on the next turn. The user has explicitly accepted this tradeoff in conversation.

**`DeliverFn` change:** add optional `threadTs?: string` to the deliver opts. Implementations route to `chat.postMessage` with that `thread_ts` (or omit for top-level when `postTopLevel: true`).

### Decision 7 — Per-message `MessagePayload` schema (lean)

Each `additional_messages[i]` / `thread_replies[i]` / `post_to.additional_messages[i]` / `post_to.thread_replies[i]` is a `MessagePayload`:

```ts
{
  blocks: Block[],         // required
  table?: TableBlock,      // optional, same as primary
  actions?: Action[],      // optional
  reactions?: string[],    // optional
}
```

Explicitly NOT carried per-message: `message` (primary preamble only), `post_top_level` (session signal), `disengage` (session signal), `skip_response` (session signal).

**Actions inside follower messages**: allowed for symmetry. Ref-based actions (`change`, `config_update`, `update`) still must appear exactly once across the batch (today's `validateStagedIntentsCoverage` already enforces presence, not location — it just needs to walk the batch). `post_to` inside a follower is allowed at the top batch level but `post_to` nested inside a `post_to`'s own followers is rejected (matches today's "nested post_to" rule, extended).

### Decision 8 — Snapshot persistence: one record per `post_to` (unchanged structure)

Today, each `post_to` action gets one snapshot record (`{ text, blocks, table?, actions?, reactions? }`). With multi-message inside `post_to`, the snapshot record grows to carry the followers:

```ts
{
  text,           // extracted display text of primary blocks
  blocks,         // primary
  table?,
  actions?,
  reactions?,
  additional_messages?: MessagePayload[],
  thread_replies?: MessagePayload[],
}
```

On button-click replay, the handler delivers primary then sequenced followers using the same `DeliverFn` shape. No new snapshot records per follower — one snapshot ID maps to the whole batch.

For top-level `submit_response`, `responseCapture` grows analogously to hold the batch.

### Decision 9 — Session persistence: array of rendered-blocks per response

Sessions today persist a single `renderedBlocks` per submit_response. With multi-message, it becomes an array (one entry per delivered message). Backwards-compatible: old sessions deserialize as a single-element array.

## Risks / Trade-offs

- **[Claude over-uses multi-message in scheduled mode]** → The fields are exposed without a "rarely used" suppression because the user wants them available for scheduled deliverables. Mitigation: the cap (5) is small; the schema description directs the use cases narrowly; if cron output starts spawning unnecessary followups we add prompt discipline.
- **[Mid-batch Slack failure leaves partial delivery]** → Accepted explicitly. Claude re-submits on next turn. The thinking-indicator is already gone, so the user sees the partial batch; not ideal, but rare and recoverable.
- **[Schema branch explosion]** → Today the schema already has 8 variants (skip × disengage × postTopLevel × scheduled modes). Adding `allowMultiMessage` doubles that to 16 if naively combined. Mitigation: rather than pre-build all combinations, compose the field set dynamically based on deps flags and build the schema once per `createSubmitResponseTool` call. The existing code already does some of this.
- **[Validators now need to walk a tree, not a flat list]** → `validateRefActions`, `validateStagedIntentsCoverage`, `validatePostToActions` all do a `flattenActions` walk today; extend to walk the batch + post_to nested followers. Path labels grow longer (`additional_messages[1].actions[0].thread_replies[0].actions[2]`) but stay machine-parseable.
- **[Snapshot ID semantics]** → One `post_to` = one snapshot ID, even when the post_to expands to multiple Slack messages. This is the simplest model (a button click replays the whole batch) and matches the "single user-initiated action triggers a single publish event" mental model. Alternative (one snapshot per follower) was considered and rejected: complicates the click handler and breaks the "one button, one publish" abstraction.
- **[Streamer interaction]** → The streamer is deleted before the primary delivery (today's behavior). Followers post fresh. Need to ensure the streamer cleanup is NOT re-triggered for followers — current `DeliverFn` implementations check for streamer presence per call; the easiest fix is for the batch loop to call `deliver()` for the primary with `postTopLevel`, then call followers via a "raw post" variant that bypasses streamer cleanup. Concrete shape TBD in implementation — either a `firstOfBatch?: boolean` flag or two distinct callbacks.
- **[Tests churn]** → Every existing test that asserts `payload.blocks === X` continues to pass (backwards-compatible field names). New tests cover: gating per trigger, cross-field exclusivity, batch error aggregation, sequential delivery + ts plumbing, snapshot persistence with followers, `post_to` extension with followers, config bound rejection, cap enforcement, nested post_to-in-post_to-followers still rejected.

## Open Questions

- **Streamer-cleanup signaling**: the cleanest deliver-side API for "this is the first call of a batch, do streamer cleanup; this is a follow-up, don't." Lean toward an explicit `firstOfBatch: boolean` opt rather than letting implementations detect it (cleaner contract). Confirm during implementation.
- **`post_to.auto: true` interaction with followers**: when an `auto` post_to has followers, the auto-execute handler must replay primary + followers in sequence and capture the primary's ts for `thread_replies`. Straightforward but worth a dedicated test.
- **Tool-mapping labels for batch results**: the "delivered N messages" success result might want a richer tool-mapping label than today's `Replying`. Defer to the existing tool-mapping config; not a hard requirement for v1.
