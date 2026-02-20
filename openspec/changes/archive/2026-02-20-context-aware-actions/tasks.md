## 1. Add `send_to_thread` Action Type

- [x] 1.1 Add `send_to_thread` to the `Action` union type in `src/tools/types.ts`
- [x] 1.2 Add `sendToThreadActionSchema` to `src/tools/presentation/submitResponse.ts` and register in the discriminated union
- [x] 1.3 Add `send_to_thread` to `DEFAULT_LABELS`, `ACTION_STYLES`, and `getActionId()` in `src/slack/blocks.ts` (maps to existing `clack_dm_send_to_thread` action_id)

## 2. Pass Delivery Context to Claude

- [x] 2.1 Add `isEphemeral`, `triggerType`, and `isDmFirst` fields to `AskClaudeOptions` in `src/claude.ts`
- [x] 2.2 Add a `DELIVERY CONTEXT` block to `buildPrompt()` in `src/claude.ts` that renders the delivery context fields into the prompt
- [x] 2.3 Pass delivery context from `processMessage()` in `src/slack/handlers/core.ts` to `askClaude()`
- [x] 2.4 Update `getHandlerClaudeOptions()` in `src/slack/handlers/handlerResponse.ts` to include `isEphemeral`, `triggerType`, `isDmFirst` from `SessionInfo`
- [x] 2.5 All button handlers already call `getHandlerClaudeOptions(sessionInfo)` — no call site changes needed

## 3. Remove Server-Side Button Enforcement

- [x] 3.1 Remove `ensureEphemeralActions()` function from `src/slack/blocks.ts`
- [x] 3.2 Remove `ensureEphemeralActions` call in `postEphemeralResponse()` in `src/slack/handlers/core.ts` — render Claude's actions as-is
- [x] 3.3 Remove `ensureEphemeralActions` call in `postSuccessResponse()` in `src/slack/handlers/handlerResponse.ts` and `resend.ts` — render Claude's actions as-is

## 4. Remove DM-First Button Stripping

- [x] 4.1 Update `postDmThreadReply()` in `src/slack/dmResponse.ts` to render Claude's structured response actions instead of stripping them and injecting hardcoded buttons
- [x] 4.2 Remove `getDmAnswerActions()` from `src/slack/dmResponse.ts` (no longer needed — Claude provides the actions)

## 5. Update Instructions

- [x] 5.1 Update `data/default_configuration/instructions.md` "Submitting Your Response" section to describe delivery-context-aware action rules (ephemeral requires accept/reject/refine; DM-first requires send_to_thread/reject; DM/mention should not include accept/reject)
- [x] 5.2 Update `data/default_configuration/dev_instructions.md` to add `workMode: true` to the choice action guidance for bug/issue fix suggestions (pre-existing change)

## 6. Migration for Custom Instructions

- [x] 6.1 Create migration `src/migrations/002-instruction-updates.ts` that patches custom instruction overrides in `data/configuration/` (if they exist). Two changes bundled:
  - `instructions.md`: Add the delivery-context-aware action guidance to the "Submitting Your Response" section
  - `dev_instructions.md`: Add `workMode: true` to the choice action guidance for bug/issue fix suggestions (change "offer a `choice` action" to include `with `workMode: true``)
  - If neither file exists, no action needed (user gets updated defaults). Append/update relevant sections rather than overwriting entire files.
