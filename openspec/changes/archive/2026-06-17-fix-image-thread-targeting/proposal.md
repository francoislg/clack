## Why

When Clack generates or edits an image inside a thread, the image lands as a top-level channel message instead of in the thread the conversation started in. Unlike `submit_response` — whose `channel`/`thread_ts` routing is filled in by bot infrastructure — `generate_image` posts directly via `filesUploadV2` and depends on Claude to supply `thread_ts`. The delivery context surfaces the Channel ID but never the thread's timestamp, so Claude has no value to pass and the upload defaults to the channel root. (Confirmed in a real session: the thread root ts appeared zero times in the SDK transcript.)

## What Changes

- Surface the session's `thread_ts` value in the DELIVERY CONTEXT preamble for thread-bearing triggers (reactions, mentions, thread-reply, auto-respond), alongside the already-surfaced Channel ID, so Claude can route direct-posting tools into the conversation's thread.
- Add explicit guidance that direct-upload tools (e.g. `generate_image`) should pass that `thread_ts` to post into the current thread rather than the channel root.
- Update the gemini-image plugin usage instruction to pass `thread_ts` from the delivery context when in a thread.
- Instruct gemini-image to produce exactly ONE posted image per request — inspect/iterate with `deliver: "data"` (which does not post) and only `upload` the final pick — unless the user explicitly asks for multiple. (Same bug report: a single ask produced two posted images because Claude iterated with `deliver: "both"`.)

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `delivery-context`: surface the thread timestamp value (not just the channel ID) for thread-bearing triggers, and describe how tools that post directly to Slack should use it to target the thread.

## Impact

- `src/claude/promptBuilder.ts` — delivery-context builder (thread/reaction/mention branches); add the `thread_ts` value and routing guidance.
- `src/plugins/gemini-image/usageInstruction.ts` — instruct Claude to pass `thread_ts` when in a thread.
- No schema, config, or persisted-state changes. `generate_image` already accepts `thread_ts`; no tool-signature change required.
