## Context

`submit_response` is the single delivery point: Claude must call it to put anything in Slack. Normal (bound-channel) runs deliver a primary message to the session's channel. Channelless runs (plugin crons like casual-talk) have **no** bound channel, so the `optional-post-to` mode was added — but it expressed delivery as a `post_to` **action**, a mechanism designed for staged buttons (`auto: true` to fire, otherwise a clickable button) and cross-posting. Using it as the *primary* delivery for a non-interactive cron is a category error, and it caused a chain of bugs:

1. the channelless schema stripped `actions`, so `post_to` was unreachable;
2. once allowed, the generic skip path ran first and swallowed the combined `{ skip_response, post_to }` call;
3. once that delivered, `handleSuccess` posted a bogus primary to the synthetic `channelless:<jobId>` channel → `channel_not_found` crashed the job;
4. once guarded, the captured `post_to` lacked `auto: true`, so the post-run auto-execute filtered it out and the post was silently dropped.

The content fields are also partly duplicated today: the primary, `post_to`, and the follow-up `MessagePayload` (`additional_messages`/`thread_replies`) each describe "a Slack message" with overlapping-but-separate shapes.

## Goals / Non-Goals

**Goals:**
- Make "deliver a message to an explicit channel" a first-class `submit_response` concept (`deliver_to`), not a faked action.
- One shared message-payload entity + one delivery routine used by the normal primary, `post_to`, and `deliver_to` — no drift.
- A channelless run is unambiguous: `deliver_to` (≥1) or `skip_response`; neither is a hard error (never a silent no-op).
- Delete the band-aids (implicit `auto`, skip-ordering trick, `handleSuccess` channelless guard).

**Non-Goals:**
- Changing normal bound-channel delivery behavior, the `skipped` mode, or `post_to`'s cross-posting role.
- A standalone "send to channel" MCP tool (would break the single-delivery-point contract).
- Renaming the `optional-post-to` mode key (kept to limit blast radius; the name is now a slight misnomer but internal).

## Decisions

### 1. `deliver_to` shape: array of `{ channel, thread_ts?, response }`
Each entry is one delivery to an explicit destination. `response` is the shared message-payload (below). The array makes all three multiplicities fall out with no special-casing: multiple messages → multiple entries; top-level + thread → one entry with `thread_replies`; same content to N channels → repeat the entry with different `channel`.

- `channel` is **required** (Slack cannot post without one; there is no bound channel to fall back to). `thread_ts` optional (reply vs top-level).
- Alternatives rejected: a single `{ channel }` object (can't fan out); a top-level `channel` field next to `blocks` (confusable with normal delivery); `channels: string[]` (can't carry per-destination thread/content). The array-of-entries is the only one that covers all cases uniformly.

### 2. Shared message-payload entity
Extract the content shape — `blocks` + `thread_replies?` + `actions?` + `suppress_unfurls?` + `reactions?` — into one schema/type (building on today's `messageContentFields`), and a shared "deliver this payload to (channel, thread_ts)" routine wrapping the existing direct-deliver logic. The normal primary, each `post_to` action, and each `deliver_to.response` all reference the same entity and call the same delivery code. `deliver_to.response` deliberately EXCLUDES `skip_response` and `deliver_to` (no recursion) and `additional_messages` (the array subsumes same-channel multiples).

### 3. Delivery + `responseTs`
The handler's `optional-post-to` branch iterates `deliver_to` entries, delivering each via the shared routine against its `channel`/`thread_ts`. The **first** entry's posted ts is recorded as the run's `responseTs` (what `executeDynamicJob` reads). Validation (blocks, button labels, nested `post_to` inside `actions`, referenced intents) reuses the existing per-message building blocks in `submitResponse/actions.ts`.

### 4. Deliver-or-skip-or-error
In `optional-post-to`: non-empty `deliver_to` → deliver; `skip_response: true` with no `deliver_to` → skip; neither (or empty `deliver_to`) → `recordError` returned to Claude. This replaces the current "empty call records a skip" silent behavior.

### 5. Remove the band-aids
With delivery routed to a real channel and never to the sentinel:
- the uncommitted implicit-`auto` forcing is dropped (not needed; `deliver_to` isn't an action);
- the `optional-post-to`-before-skip ordering trick collapses into the single `deliver_to` branch;
- the `handleSuccess` `isChannellessChannelId` guard is **kept** (the original "remove it" idea was rejected at implementation time). Its precondition — "no primary is ever routed to the sentinel" — fails for one edge case: if Claude ends a channelless run WITHOUT calling `submit_response`, `buildSuccessResponse` returns the raw-text path and `handleSuccess`'s fallback would post that text to the synthetic `channelless:<id>` channel → `channel_not_found`. The guard is the correct permanent safety property (the sentinel is never postable), not a band-aid. On the happy `deliver_to` path it is also satisfied because delivery already happened via the explicit channels and `responseCapture` is set.

## Risks / Trade-offs

- [Claude keeps emitting the old `post_to`-as-primary shape after deploy] → the channelless schema no longer offers `post_to` at the top level for primary delivery; an attempt resolves to "neither deliver_to nor skip" → hard error returned, so Claude self-corrects rather than silently dropping. Prompt rewritten to teach `deliver_to`.
- [Shared-entity extraction regresses normal delivery] → the entity is the existing content fields factored out, not redefined; full `submit_response` suite + delivery tests must stay green. Behavior-preserving for the normal path.
- [Multi-entry `responseTs` ambiguity] → define it as the first entry's ts; documented. Acceptable since cron status only needs one anchor ts.
- [`post_to` action still overlaps conceptually with `deliver_to`] → kept intentionally for cross-posting/fan-out from interactive sessions; `deliver_to` is channelless-only. Both now share the message-payload entity, so they don't drift.

## Migration Plan

Internal contract only (no data migration). Deploy replaces the channelless delivery path atomically. Rollback = revert the change; the prior committed fixes (`025209e`, `340b236`) remain in history if a partial revert is ever needed, but the intent is to supersede them.
