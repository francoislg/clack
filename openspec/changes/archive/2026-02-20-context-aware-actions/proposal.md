## Why

Claude currently has no knowledge of how its responses will be delivered (ephemeral, DM, public thread) or what triggered the interaction (reaction, DM, mention, button click). This causes it to always emit Accept/Reject/Refine buttons per its instructions, even when they're meaningless (e.g., "Accept" in a DM where the message is already delivered). A server-side `ensureEphemeralActions()` hack patches over this for ephemeral responses, but the root issue is that Claude lacks delivery context.

## What Changes

- Pass delivery context (`isEphemeral`, `triggerType`, `isDmFirst`) into `AskClaudeOptions` and inject it into Claude's prompt
- Update instructions to make Claude context-aware: MUST include accept/reject/refine for ephemeral, SHOULD NOT for non-ephemeral
- Remove `ensureEphemeralActions()` — no more server-side button enforcement
- Remove hardcoded DM-first button stripping in `postDmThreadReply()` — let Claude decide
- Add DM-first action types (`send_to_thread`) to `submit_response` schema so Claude can offer them when appropriate

## Capabilities

### New Capabilities

- `delivery-context`: Passing delivery metadata (ephemeral, trigger type, DM-first, button source) to Claude so it can make informed decisions about which actions to include in responses

### Modified Capabilities

- `clack-tool-response`: Add `send_to_thread` action type; update action guidance to be delivery-context-aware
- `dm-first-reactions`: Remove server-side button stripping; Claude controls DM-first actions via `send_to_thread`
- `slack-reaction-trigger`: Remove `ensureEphemeralActions()` enforcement; Claude is now responsible for including required ephemeral actions
- `slack-message-trigger`: Clarify that DM/mention responses should not include accept/reject actions

## Impact

- `src/claude.ts` — `AskClaudeOptions`, `buildPrompt()` or `buildSystemPrompt()`
- `src/slack/handlers/core.ts` — thread delivery context through `processMessage()`
- `src/slack/handlers/handlerResponse.ts` — remove `ensureEphemeralActions` call
- `src/slack/blocks.ts` — remove `ensureEphemeralActions()`, add `send_to_thread` action support
- `src/slack/dmResponse.ts` — remove hardcoded button stripping in `postDmThreadReply()`
- `src/tools/presentation/submitResponse.ts` — add `send_to_thread` action schema
- `src/tools/types.ts` — add `send_to_thread` to Action union
- `data/default_configuration/instructions.md` — delivery-context-aware action guidance
- `src/slack/handlers/changeWorkflowHelper.ts` — pass through delivery context
- Button handler files (refine, choice, followup) — pass delivery context on re-invocations
