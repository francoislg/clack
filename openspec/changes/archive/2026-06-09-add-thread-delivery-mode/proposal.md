## Why

Casual-talk seeds its threads with `attention_level: "high"` so Clack follows up on every human reply. But those follow-up turns run through the normal `processMessage` → `executeAndDeliver` path, which creates a `SlackStreamer` — the live "thinking" / tool-progress card. For casual chatter that card reads as robotic: a banter reply shouldn't announce a thinking indicator and stream tool calls. It should just appear, like a person typing.

The capability to suppress the streamer already exists (`silentThinking`, used by cron, `handlerResponse.ts:152`), but it is decided once at the trigger level and never reaches the engaged-thread follow-up path. There is no way to mark a thread as "deliver quietly" and have its replies honor that.

We also want this to be **mutable per thread**, not a fixed flag: a thread can start as casual chatter (invisible) and later turn into a real work session (where the streamer is genuinely useful), so Clack must be able to switch the mode mid-conversation.

## What Changes

- Add a per-thread **delivery mode** — `"streamer" | "invisible"` — persisted on `SessionContext` (`deliveryMode`, absent reads as `"streamer"`). It is the exact sibling of `attentionLevel`: where `attentionLevel` governs *how eagerly* Clack follows up, `deliveryMode` governs *how* it delivers.
- At the start of every turn, `processMessage` reads the resolved session's `deliveryMode` and runs that turn with `silentThinking` when the mode is `"invisible"`. This is the single wire that was missing; it covers every path that reuses an engaged session (thread-reply, auto-respond), not just casual-talk.
- Expose `default_delivery_mode` on the two engagement-seeding surfaces — the `post_to` action and each `deliver_to` entry — beside `attention_level`. When set, it seeds the mode onto the destination thread's session.
- Expose `default_delivery_mode` as a top-level `submit_response` field (sibling of `attention_level`) so Claude can **switch** an engaged thread's mode on any turn. The switch persists onto the session and takes effect on the **next** turn (the current turn's streamer is decided before Claude runs — see design.md).
- Update casual-talk's cron prompt to set `default_delivery_mode: "invisible"` on its single `deliver_to` entry, so casual chatter threads are streamer-free end to end. Prompt-only, on by default; no new config.

## Capabilities

### New Capabilities

- `thread-delivery-mode`: a per-thread, mutable delivery mode that decides whether a turn shows the live streamer card or delivers silently; seeded on engagement, switchable on any turn.

### Modified Capabilities

- `engaged-thread-registration`: the seeding primitive (`registerThreadSession` / `EngageThreadOptions`) gains an optional `deliveryMode` that rides onto the seeded session alongside `attentionLevel` / `followUpContext`.

## Impact

- Code: `src/sessions.ts` (new field + seeding opt), `src/slack/handlers/core.ts` (read mode → silentThinking), `src/slack/handlers/handlerResponse.ts` (persist switch), `src/tools/presentation/submitResponse.ts` (three schema fields + forwarding), `src/tools/server.ts` + `src/slack/handlers/autoExecute.ts` (seed mode from deliver_to / post_to), `src/tools/types.ts` (adapter types), `src/plugins/casual-talk/prompt.ts` (policy).
- Backward compatible: absent `deliveryMode` reads as `"streamer"` — every existing trigger (mentions, DMs, reactions, normal auto-respond, trivia) is unchanged. Only threads explicitly seeded/switched to `"invisible"` go quiet.
- Builds on the in-flight engaged-thread-registration work.
