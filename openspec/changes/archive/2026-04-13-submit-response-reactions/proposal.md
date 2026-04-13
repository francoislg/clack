## Why

Once `submit_response` fires, Claude's session ends — it can't call `add_reaction` after that. But a common pattern is reacting to the response you just posted (e.g., adding a checkmark to signal completion, or adding poll emojis). Currently there's no way to do this atomically with the response.

## What Changes

- Add optional `reactions` parameter to `submit_response` — an array of emoji names to add to the posted response message
- Extend `DeliverFn` to accept optional `reactions` and return the posted message's `ts`
- Delivery layer adds reactions after posting, logging warnings for invalid emojis instead of failing

## Capabilities

### New Capabilities

_None — this extends existing capabilities._

### Modified Capabilities

- `clack-tool-response`: `submit_response` gains an optional `reactions` parameter; delivery handles adding reactions to the posted message

## Impact

- `src/tools/types.ts` — `DeliverFn` signature changes (opts gains `reactions`, success gains `ts`)
- `src/tools/presentation/submitResponse.ts` — schema gains `reactions`, passes through to deliver
- `src/slack/handlers/handlerResponse.ts` — `buildDeliverFn` and `buildDirectDeliverFn` return `ts` and add reactions after posting
