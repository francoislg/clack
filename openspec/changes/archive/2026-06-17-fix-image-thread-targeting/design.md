## Context

`submit_response` is routed by bot infrastructure — the delivery handler already knows the channel and thread and fills them in. Plugin tools that post directly to Slack do not get that treatment: `generate_image` (`src/plugins/gemini-image/generateImage.ts`) calls `filesUploadV2` and only threads when Claude passes `thread_ts` (`:58-61`, applied at `:112`/`:200`).

The DELIVERY CONTEXT preamble built in `src/claude/promptBuilder.ts` (~`:250-390`) surfaces the **Channel ID** (`:257`/`:259`) for non-DM, non-channelless sessions but never surfaces the **thread timestamp value**. In a confirmed real session the thread root ts never appeared in the SDK transcript, so Claude supplied `channel` (which it had) and omitted `thread_ts` (which it never had) — the image posted to the channel root.

The session object already carries `threadTs`; it simply isn't emitted into the prompt.

## Goals / Non-Goals

**Goals:**
- Make `threadTs` available to Claude in the delivery context for thread-bearing triggers (reactions, mentions, thread-reply).
- Tell Claude that direct-posting tools should pass that value to land in the thread.
- Update the gemini-image usage instruction to follow this.

**Non-Goals:**
- Changing `generate_image`'s signature — it already accepts `thread_ts`.
- Auto-injecting `threadTs` into plugin tool calls (would require threading session context through the SDK boundary into plugin tools; out of scope, see Decisions).
- Changing `submit_response` routing — it is unaffected.
- Altering DM / auto-respond / channelless scheduled behavior.

## Decisions

**Surface the value in the prompt rather than auto-inject it into the tool.**
The robust-looking alternative is to have the gemini-image deps default `threadTs` from session context so Claude can't get it wrong. Rejected for now: the plugin SDK boundary (`src/plugins/CLAUDE.md`) deliberately keeps plugin tools from reaching into core session state, and `generate_image` accepts an arbitrary `channel` (it can post to other channels), so a silent default would fight the explicit-routing design. Surfacing the value in the prompt keeps the plugin boundary intact and fixes every current and future direct-posting tool at once.

**Emit a single thread-coordinate line, gated on `threadTs` presence.**
Add the `threadTs` value and a one-line routing hint to the thread/reaction (`~:373`), mention (`~:387-390`), and thread-reply (`~:363`) branches. Guard on `session.threadTs` being set so DM, auto-respond-without-thread, and channelless scheduled runs are untouched.

**Keep the gemini-image instruction change minimal.**
`usageInstruction.ts:24` currently names only `channel`. Add: when the delivery context provides a thread timestamp, pass it as `thread_ts` so the image posts in the thread.

## Risks / Trade-offs

- [Claude still has to act on the surfaced value] → Mitigation: phrase the delivery-context line imperatively ("pass this `thread_ts`...") and reinforce in the gemini-image instruction. Acceptable residual risk — same model of trust as the rest of the delivery context.
- [Other direct-posting plugins might want top-level posting] → Mitigation: the line is descriptive ("to post in the thread, pass..."), not a hard rule; tools that intentionally post top-level simply omit it.
- [Surfacing a raw ts could be misused as a message reference] → Low: the value is already a normal Slack thread_ts and is what `post_to`/upload tools expect.

## Migration Plan

Prompt/instruction-only change. No data migration, no config change, no restart-coupled wiring beyond the normal instruction hot-reload. Rollback = revert the two edited files.
