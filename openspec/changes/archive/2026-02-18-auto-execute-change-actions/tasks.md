## 1. Add `auto` flag to action schemas

- [x] 1.1 Add optional `auto: z.boolean().optional()` to `changeActionSchema`, `reviewActionSchema`, `mergeActionSchema`, `updateActionSchema`, and `closeActionSchema` in `src/tools/presentation/submitResponse.ts`
- [x] 1.2 Add `auto` to the `REF_ACTION_TYPES` handling so it passes through validation and is included in the captured payload

## 2. Extract shared workflow trigger logic

- [x] 2.1 Extract the workflow trigger logic from `src/slack/handlers/changeAction.ts` into a shared function `triggerChangeWorkflow(intent, sessionInfo, userId, client)` that can be called by both the button handler and auto-execute
- [x] 2.2 Extract the follow-up trigger logic from `src/slack/handlers/changeThreadActions.ts` into a shared function `triggerFollowUp(intent, sessionInfo, changeSession, command, client)` that can be called by both the button handler and auto-execute

## 3. Implement auto-execute in response posting

- [x] 3.1 In `src/slack/handlers/core.ts`, after `postSuccessResponse` completes, check the response for actions with `auto: true` and resolve their staged intents from the session
- [x] 3.2 For auto-executed `change` actions, call the shared `triggerChangeWorkflow` with the resolved intent
- [x] 3.3 For auto-executed follow-up actions (`update`, `review`, `merge`, `close`), call the shared `triggerFollowUp` with the resolved intent and active change session
- [x] 3.4 Handle auto-execute errors by posting the error message in the thread without affecting the already-posted response

## 4. Relax session blocking

- [x] 4.1 Update `getActiveSessionForUser` in `src/changes/session.ts` to only return sessions in actively-executing states (`executing`, `reviewing`, `merging`), excluding `pr_created` and `planning`
- [x] 4.2 Verify the global `maxConcurrent` check in `startChangeWorkflow` still counts all non-completed/non-failed sessions (unchanged)

## 5. Fix update flow progress message spam

- [x] 5.1 In `src/slack/handlers/changeThreadActions.ts`, change the follow-up handler to post one acknowledgment message and capture its `ts`
- [x] 5.2 Change the `onProgress` callback to call `client.chat.update()` on the ack message `ts` instead of `client.chat.postMessage()`
- [x] 5.3 Update the final success/failure message to also update the same ack message (instead of posting a new one)

## 6. Update Claude instructions

- [x] 6.1 Update `data/default_configuration/dev_instructions.md` to include guidance on `auto: true`: use for clear directives, omit for ambiguous intent or proactive suggestions
