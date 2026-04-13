## Context

`submit_response` ends Claude's tool loop. After it returns, no more tool calls can be made. The `add_reaction` tool exists but can't be used post-response. Users want Claude to react to its own posted messages (checkmarks, polls, etc.).

The delivery layer (`buildDeliverFn` in `handlerResponse.ts`) already has the Slack client and knows the message `ts` — either from the streamer (`streamer.getMessageTs()`) or from `chat.postMessage`'s response.

## Goals / Non-Goals

**Goals:**
- Let Claude add reactions to the response it just posted, atomically with `submit_response`
- Keep `submit_response` ignorant of Slack details — the delivery layer handles reactions
- Fail gracefully on invalid emojis (log warning, don't fail the response)

**Non-Goals:**
- Reacting to messages other than the one just posted (use `add_reaction` tool for that)
- Removing reactions via `submit_response`

## Decisions

### Reactions handled by the delivery layer, not submit_response

`submit_response` passes `reactions` through to `deliver()`. The delivery layer adds them after posting because it already has the Slack client and the message `ts`. This avoids threading the Slack client into `SubmitResponseDeps`.

### DeliverFn returns the posted message ts

Change `DeliverFn` success result from `{ ok: true }` to `{ ok: true; ts?: string }`. Both streamer and fallback paths return the ts. The `ts` is needed internally by the delivery layer for adding reactions, and may be useful for future features.

### Fire-and-forget reactions with warning logging

Each reaction is added via `reactions.add` after delivery. Failures are logged as warnings but don't affect the response result. `already_reacted` is silently ignored. Invalid emoji names are logged. This ensures a typo in a reaction name never breaks the user's response.

### Reactions run in parallel

All `reactions.add` calls fire concurrently (Promise.all) since they're independent and order doesn't matter.
