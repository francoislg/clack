## Context

The casual-talk plugin fires a channelless cron tick, rolls a die, and on a hit (`roll === 1`) reads candidate channels and either posts one `deliver_to` message or skips. Today posting is the only positive action.

The reaction primitives already exist and are wired into exactly the context casual-talk runs in:

- `add_reaction` (`src/tools/query/addReaction.ts`) / `remove_reaction` (`src/tools/query/removeReaction.ts`) are registered whenever `ctx.slackClient` is present (`server.ts:406-407`) — the casual-talk cron run has a client.
- `find_emoji` (`src/tools/query/findEmoji.ts`) searches **custom** workspace emoji by name; standard Unicode emoji are common knowledge to Claude.
- `fetch_channel_messages` resolves `channel_name` via `getChannelInfo` (`src/slack/channelCache.ts`), whose `ChannelInfo` type carries `{ id, name, isDm?, isPrivate? }` — **no `purpose`**. The underlying `conversations.info` response does include `channel.purpose.value`; `getChannelInfo` just doesn't read it today. (A separate, unused-here cache `src/slack/channelsCache.ts` does expose `purpose`/`topic`, but it backs `find_channel`, not `fetch_channel_messages`.) So surfacing purpose means extending `getChannelInfo`/`ChannelInfo`, not reading an already-populated field.

So the change is overwhelmingly prompt-level (in `prompt.ts`) plus one additive field on `fetch_channel_messages`. No config, no new tool, no new `submit_response` schema.

## Goals / Non-Goals

**Goals:**

- Let a casual-talk hit react to a recent message as an alternative or complement to posting.
- Give reactions a looser joinability bar than posting (acknowledge, don't only converse).
- Calibrate emoji to channel character via `find_emoji` + channel `purpose`/`promptSuggestion`.
- Keep volume tasteful through judgment, not a numeric cap.
- Reuse the existing termination contract (`deliver_to` XOR `skip_response`) with zero schema change.

**Non-Goals:**

- No separate, more-frequent reaction cadence or second die roll (Model B) — reactions fold into the existing hit (Model A).
- No new config fields, no `reactions`-specific rate, no admin tooling.
- No reaction-removal behavior, no reaction analytics/tracking.
- No change to the miss path, the post bar, or the persona's existing constraints beyond extending them to reactions.

## Decisions

### D1 — Model A: fold reactions into the existing hit (not a separate cadence)

On a hit, Claude evaluates the read channels and chooses among **react-only**, **post-only**, **react-and-post**, or the existing legitimate **skip**. Rationale: zero new config/roll, smallest surface, and the user explicitly chose A. A separate reaction cadence (Model B) was considered and deferred — it adds a config axis and a second roll for a behavior that judgment can already pace within a hit.

### D2 — Reactions terminate within the existing contract

A reaction is a side-effect of the `add_reaction` tool call, not a delivery. So:

- **React-only:** one or more `add_reaction` calls, then `submit_response({ skip_response: true })` (no `deliver_to`). This is already a legal terminal state; `skip_response` here means "no message posted," which is accurate.
- **React-and-post:** the `add_reaction` calls, then the single `deliver_to` entry (no `skip_response`).

No `optional-post-to` schema change. The existing "deliver XOR skip" invariant holds — a reaction is neither, it's a prior tool effect.

### D3 — Looser joinability for reactions than for posts

Posting keeps today's bar (substantive, fresh, human-leaf thread worth a written reply). Reacting accepts any recent **human** message worth a lightweight acknowledgment — a win, a funny line, an announcement, a fresh human message with no replies. Rationale: a 🎉 is far lower-touch than a sentence, so it earns a lower bar; the no-pile-on human-leaf guard still applies (don't react to bot-leaf messages / the bot's own posts).

### D4 — Search emoji before reacting

Before adding a reaction, Claude calls `find_emoji` to discover custom workspace emoji matching the channel's character and the message content, then picks the most fitting (custom or standard). Rationale: the user wants Clack to "search for emojis before posting one"; workspaces often have themed custom emoji that read as more native than a generic 👍. `add_reaction` already handles `invalid_name`/`already_reacted` gracefully, so a bad guess degrades quietly.

### D5 — Surface `channel_purpose` in `fetch_channel_messages` (via `getChannelInfo`)

Extend `ChannelInfo`/`getChannelInfo` (`src/slack/channelCache.ts`) with an optional `purpose`, populated from `conversations.info`'s `channel.purpose?.value` (only when non-empty — an empty-string purpose is treated as absent), then surface it as an optional `channel_purpose` field on the `fetch_channel_messages` result alongside the existing `channel_name`. Rationale: emoji calibration needs channel character; folding it into the call Claude already makes avoids a second `find_channel` round-trip. Extending `getChannelInfo` (rather than switching `fetch_channel_messages` to the plural `channelsCache`) is the minimal change and keeps both consumers on one cache. Additive and omitted when unavailable, so no existing consumer breaks.

### D6 — Volume by judgment, no hard cap

The prompt guides Claude to focus on one or two messages per fire and, when several related messages are active, to react to just the best one rather than blanketing. Rationale: the user rejected a hard cap; a numeric limit would be arbitrary and a too-low cap would suppress legitimate multi-message moments while a too-high one invites spam. Taste scales better than a constant here.

## Risks / Trade-offs

- **Reaction spam / over-reacting** → D6's one-or-two-messages guidance + the existing human-leaf guard + `already_reacted` being silently idempotent keep it bounded without a cap.
- **Claude reveals automation via reaction timing** → extend the existing persona "never reveal the roll/schedule/automation" constraint explicitly to the reaction path.
- **`find_emoji` returns nothing useful (sparse custom emoji)** → fall back to standard emoji Claude already knows; the search is best-effort, not required.
- **`channel_purpose` absent for some channels** → field is optional/omitted; Claude falls back to `promptSuggestion` and the messages themselves.
- **Looser reaction bar drifts into reacting to bots** → the human-leaf rule from the existing join logic is reused verbatim for the react path; reactions are only added to human messages.

## Migration Plan

Pure prompt + additive tool-field change; no data migration. Deploys with the next casual-talk reconcile (prompt rebuilt at reconcile time) and a normal app restart for the `fetch_channel_messages` field. Rollback is reverting the prompt and the field — no persisted state is touched.

## Open Questions

None — the four design questions (model, emoji search, joinability looseness + react-and-post, volume) were resolved with the user.
