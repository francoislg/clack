## 1. Refactor buildDeliveryContext to read from session

- [x] 1.1 Change `buildDeliveryContext` signature from `(options?: AskClaudeOptions)` to `(session: SessionContext)` in `src/claude.ts`
- [x] 1.2 Replace options-based checks with session field checks: `session.dmChannel && session.originChannel` for DM-first, `session.triggerType === "reactions" && session.isEphemeral` for ephemeral, etc.
- [x] 1.3 For DM-first mode, include `channelPostTs` awareness in the prompt (note if answer was already shared)
- [x] 1.4 Update `buildPrompt` to call `buildDeliveryContext(session)` instead of `buildDeliveryContext(options)`

## 2. Make delivery context descriptive

- [x] 2.1 Rewrite the DM-first delivery context prompt to list available actions (`send_to_thread`, `reject`) without mandating them, and add "Choose actions appropriate to your response"
- [x] 2.2 Rewrite the ephemeral delivery context prompt to list required actions (`accept`, `reject`, `refine`) as visibility controls
- [x] 2.3 Keep DM and mention prompts as-is (they already describe rather than prescribe)

## 3. Remove delivery flags from AskClaudeOptions

- [x] 3.1 Remove `isDmFirst`, `isEphemeral`, and `triggerType` fields from the `AskClaudeOptions` interface in `src/claude.ts`
- [x] 3.2 Update `processMessage` in `src/slack/handlers/core.ts` to stop passing `isEphemeral`, `triggerType`, `isDmFirst` to `askClaude`
- [x] 3.3 Update `getHandlerClaudeOptions` in `src/slack/handlers/handlerResponse.ts` to stop reconstructing `isDmFirst` from session info fields
- [x] 3.4 Update `processDmRefinement` in `src/slack/handlers/dmActions.ts` — confirm it needs no changes (it already passes the session to `askClaude`)
- [x] 3.5 Grep for any remaining references to the removed fields and clean them up

## 4. Verify and test

- [x] 4.1 Run `npx tsc` to verify no type errors
- [x] 4.2 Run `npm test` to verify existing tests pass
- [x] 4.3 Verify that `processDmRefinement` call path now receives correct delivery context by tracing through the code
