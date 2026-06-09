# Design

## The central constraint: the streamer is a turn-start decision

A turn's streamer is created **before Claude runs**. In `executeAndDeliver` (`handlerResponse.ts:152`):

```
if (!silentThinking) { streamer = createStreamer(...); await streamer.start(); }
const deliver = silentThinking ? buildDirectDeliverFn(ctx) : buildDeliverFn(ctx);
```

…then `askClaude(...)` runs. So by the time Claude can call `submit_response`, the card (or its absence) is already live. Two consequences shape the whole design:

1. **A turn's visibility cannot be changed by that same turn.** Claude can *record a new mode*, but it applies to the **next** turn. Switching `invisible → streamer` cannot retroactively stream progress that was never captured; switching `streamer → invisible` would mean deleting a card the user already saw flicker. We accept a **one-turn lag** on transitions. For casual→work this is benign (the first work answer being quiet is fine; subsequent ones stream).
2. **The mode must live on durable thread state**, read at turn start — not be a property of a single message. That state is the session.

## Where the mode lives and who reads it

`SessionContext.deliveryMode: "streamer" | "invisible"` (absent ⇒ `"streamer"`), persisted like `attentionLevel`.

The single read happens in `processMessage` (`core.ts`), after the session is resolved inside `withThreadLock` and before `executeAndDeliver`:

```
const effectiveSilentThinking = silentThinking || session.deliveryMode === "invisible";
```

Doing the read **centrally in core**, not in `autoRespond`, means every path that reuses an engaged session honors the mode for free — thread-reply auto-respond today, and anything else that resolves an engaged session tomorrow. `autoRespond` needs no change. The cron path keeps passing `silentThinking: true` explicitly; the `||` preserves that.

Why not a per-turn classifier (decide visible/invisible before Claude runs, from message content)? That removes the one-turn lag but adds a fuzzy pre-Claude judgment on every reply. The explicit, Claude-driven switch is simpler and matches the product intent ("Clack decides when a thread turns serious"). Pre-analysis-driven mode selection is a possible future refinement, deliberately out of scope.

## The Claude-facing surface mirrors `attention_level` exactly

`attention_level` already establishes the pattern: a thread-future dial that exists in three places — seeded via `post_to` / `deliver_to`, and switchable via a top-level `submit_response` field. `default_delivery_mode` is its sibling and reuses all three seams:

| Concern | attention_level | default_delivery_mode (new) |
|---|---|---|
| Seed on cross-post | `post_to.attention_level` → `registerThreadSession` (`autoExecute.ts:579`) | `post_to.default_delivery_mode` → same call |
| Seed on channelless deliver | `deliver_to[].attention_level` → `registerThreadSession` (`server.ts:567`) | `deliver_to[].default_delivery_mode` → same call |
| Switch this thread | `submit_response.attention_level` → `setAttentionLevel` (`handlerResponse.ts:574`) | `submit_response.default_delivery_mode` → persist on session |
| Gating | `allowAttentionLevel` (mentions, reactions, auto-respond, thread-reply) | same gate |

`EngageThreadOptions` and `registerThreadSession` thread the new field onto the seeded session next to `attentionLevel`.

## Naming

The user-facing field is `default_delivery_mode: "streamer" | "invisible"` (Claude-facing, English — VIA-Claude path, stays English). It reads as "the thread's default way of delivering," which is honest: it sets the mode for *future* turns, not the current message (already-silent in the cron/post_to seeding contexts). The internal session field is `deliveryMode`; the internal "invisible" mechanism is the existing `silentThinking`.

## Edge cases

- **New, non-engaged sessions** (a fresh mention / DM) have no `deliveryMode` → `"streamer"`. Unchanged.
- **Switch on a skip turn**: `handleSkip` persists `deliveryMode` the same way it persists `attentionLevel`, so Clack can flip the mode while declining to reply.
- **`"off"` attention + a mode**: orthogonal. `attention_level: "off"` disengages the thread (no future turns), so a stored `deliveryMode` simply never gets read again — harmless.
- **Switch + delivery failure**: mirror `attentionLevel` — only persist on a successful turn (the persistence sits in `handleSuccess`, reached after delivery).
