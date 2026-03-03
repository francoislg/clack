## Why

DM-first refinement and synthesis calls to `askClaude` don't pass `isDmFirst` or `triggerType`, so Claude never receives the delivery context prompt. This means refined responses have no action buttons ("Send to thread", "Reject") even though the instruction text says "click a button below." The root cause is architectural: delivery context is passed as explicit flags through `AskClaudeOptions` at every call site, and `processDmRefinement` / `synthesizeConversation` simply forgot to include them. Rather than patching each call site, we should derive delivery context from the session itself — the session already persists `triggerType`, `dmChannel`, `originChannel`, and `channelPostTs`.

Additionally, the current delivery context is prescriptive ("Include `send_to_thread` and `reject` actions"), which is too rigid for DM refinement threads where the user might ask anything — including requesting code changes. A descriptive approach ("You're in a DM thread originated from an emoji reaction") lets Claude adapt its actions to what the user actually asked.

## What Changes

- `buildDeliveryContext` reads delivery state from the session instead of from `AskClaudeOptions` flags
- Remove `isDmFirst`, `isEphemeral`, and `triggerType` from `AskClaudeOptions` (they become session-derived)
- The delivery context prompt becomes descriptive (describes the situation and available actions) rather than prescriptive (mandates specific actions)
- `processDmRefinement` and `synthesizeConversation` no longer need to manually reconstruct delivery flags — they just pass the session
- `getHandlerClaudeOptions` no longer needs to reconstruct `isDmFirst` from session info fields

## Capabilities

### New Capabilities

_None_

### Modified Capabilities

- `delivery-context`: Delivery context is derived from the session instead of passed as explicit `AskClaudeOptions` flags. The prompt becomes descriptive rather than prescriptive, listing available actions without mandating them.
- `dm-first-reactions`: DM thread refinement and synthesis calls now automatically receive correct delivery context because it's session-derived. Fixes missing buttons on refined responses.

## Impact

- `src/claude.ts` — `buildDeliveryContext` signature changes from `(options)` to `(session)` or `(session, options)`. `AskClaudeOptions` loses `isDmFirst`, `isEphemeral`, `triggerType`.
- `src/slack/handlers/core.ts` — `processMessage` no longer passes delivery flags to `askClaude`; session already has them.
- `src/slack/handlers/dmActions.ts` — `processDmRefinement` and `synthesizeConversation` simplified (no manual flag reconstruction).
- `src/slack/handlers/handlerResponse.ts` — `getHandlerClaudeOptions` simplified (no manual `isDmFirst` reconstruction).
- `src/sessions.ts` — No schema changes needed; `triggerType`, `isEphemeral`, `dmChannel`, `originChannel`, `channelPostTs` are already persisted.
