# Proposal: casual-talk-follow-channel-window

## Why

Casual-talk seeds engagement only on the THREAD it posts into (`attention_level`), so a person who replies to a chatter opener **top-level in the channel** — rather than in the thread hanging off it — is never heard. The `channel_attention_level` dial that would follow the channel's top-level conversation already exists on the `deliver_to` entry and is fully wired in core (`src/tools/server.ts` → `seedEphemeralRule` → the `channelReply` path), but the engagement instructions never set it. Result: casual-talk listens to only half the natural reply surface.

## What Changes

- **The `casual-talk:engagement` topic gains a channel-window mandate.** On every TOP-LEVEL `deliver_to` entry (no `thread_ts` — a fresh opener or a top-level channel join), Claude SHALL set `channel_attention_level: "low"` alongside the `attention_level` it already sets. This seeds an ephemeral, decaying channel window anchored to the post, so top-level human replies about it engage Clack.
- **Threaded entries are unchanged.** `channel_attention_level` is NOT set on a `thread_ts` entry (core ignores it there and warns); the thread dial (`attention_level`) stays the only engagement lever for a threaded reply.
- **Level is hardcoded `"low"`.** The window answers only replies that address Clack directly or are clear follow-ups about the post; unrelated channel traffic decays it. No `CasualTalkConfig` field and no admin knob — consistent with the plugin-provided-per-delivery attention model, and deliberately conservative given casual-talk's prior over-engagement incident.

This is instruction-only: no core code, no config schema, no migration, no manifest/scope changes. The ephemeral-rule seeding, the `channelReply` path, and the window's decay/expiry all already exist.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

- `casual-talk-plugin`: adds a requirement that the engagement topic seed a `"low"` channel window on every top-level `deliver_to` entry (and never on a threaded one).

## Impact

- `src/plugins/casual-talk/engagement.ts` — extend the posting section with the channel-window mandate; update the `deliver_to` shape example.
- `src/plugins/casual-talk/engagement.test.ts` / `plugin.test.ts` — assert the new mandate.
- No on-disk state changes, no migration, no config schema, no manifest/scope changes, no i18n strings (engagement content is Claude-facing English).
- Coexists with the (already-implemented) `joined-thread-clamp-and-reliable-stop` thread-origin work — the thread dial and the channel dial are orthogonal; this change touches only the channel dial.
