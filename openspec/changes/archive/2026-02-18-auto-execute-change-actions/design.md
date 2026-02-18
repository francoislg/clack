## Context

Currently, all ref-based actions in `submit_response` render as Slack buttons that require a click to execute. The flow is: Claude stages intent → renders button → user clicks → handler executes. This is appropriate for ambiguous situations but adds friction for clear directives.

Additionally, sessions in `pr_created` status block users from starting new changes, even though the session isn't actively using compute. The update follow-up flow posts new Slack messages for each progress update instead of updating a single message.

## Goals / Non-Goals

**Goals:**
- Allow Claude to auto-execute ref-based actions when user intent is unambiguous
- Remove per-user session blocking for idle sessions (`pr_created`)
- Fix progress message spam in the update follow-up flow
- Keep the existing button-based confirmation flow as the default

**Non-Goals:**
- Changing the staged intent architecture (propose → stage → resolve stays)
- Adding new tools (the existing tool set is sufficient — `auto` is a flag on actions, not a new tool)
- Auto-executing `config_update` actions (admin operations always require confirmation)

## Decisions

### D1: `auto` flag on ref-based actions in `submit_response`

Add an optional `auto: boolean` field to all ref-based action schemas (`change`, `update`, `review`, `merge`, `close`). When `auto: true`, the system executes the action immediately after posting the response to Slack.

**Why not a separate tool?** The staged intent pattern works well — it validates inputs, provides refs for traceability, and enables retry on validation error. Adding `auto` to the existing flow preserves all of this. A new `execute_change` tool would duplicate validation logic and bypass the submit_response rendering pipeline.

**Why not auto-execute `config_update`?** Config changes are admin operations that modify system behavior. The confirmation click is a deliberate safety gate.

### D2: Auto-execute triggers from `postSuccessResponse`

After `postSuccessResponse` posts the Slack message, it checks for auto-flagged actions and triggers execution. The auto-execute path reuses the same handler logic as the button-click path (extracted into shared functions).

**Implementation:**
1. Extract the workflow trigger logic from `changeAction.ts` into a shared function (e.g., `triggerChangeWorkflow`)
2. Extract the follow-up trigger logic from `changeThreadActions.ts` into a shared function (e.g., `triggerFollowUp`)
3. In `postSuccessResponse`, after posting, iterate actions — for any with `auto: true`, resolve the staged intent from the response and call the shared trigger function
4. For auto-executed change actions: post an initial status message in the thread, then update it with progress (same UX as button-click flow)

**Why from postSuccessResponse?** It has access to the session, the response payload with staged intents, the Slack client, and the thread coordinates. It's the natural point to intercept.

### D3: Relax session blocking to actively-executing states only

Change `getActiveSessionForUser` to only return sessions in actively-executing states: `executing`, `reviewing`, `merging`. Sessions in `pr_created` (idle, waiting for user action) no longer block new changes.

**Why not remove the per-user block entirely?** Concurrent execution for the same user could cause resource issues (multiple worktrees, multiple Claude processes). Blocking on actively-executing states prevents this while allowing users to start new work when their previous change is idle.

**Why not also exclude `planning`?** Planning is a transient state that quickly moves to `executing`. If a user somehow triggers two changes at the exact same moment, both could start executing concurrently. Keeping `planning` in the block list prevents this race.

### D4: Fix update flow progress reporting

Change `changeThreadActions.ts` to post one acknowledgment message and then update it with progress, matching the pattern in `changeAction.ts`.

**Current (broken):** `onProgress` calls `client.chat.postMessage()` → new message each time.
**Fixed:** Post one ack message, capture its `ts`, then `onProgress` calls `client.chat.update()` on that `ts`.

### D5: Instruction guidance for `auto: true`

Update `dev_instructions.md` to tell Claude when to use `auto: true`:
- **Use auto** when the user gives a clear directive: "Fix this", "Do it", "Merge it", "Update the PR with X", "Close the PR"
- **Don't use auto** when the intent is ambiguous, when Claude is offering a suggestion the user hasn't explicitly asked for, or when the change seems risky

## Risks / Trade-offs

- **[Accidental execution]** → Claude misjudges intent and auto-executes when user was just asking. Mitigation: instructions emphasize defaulting to buttons when uncertain. The user can always refine instructions if Claude is too eager or too cautious.
- **[Concurrent session edge cases]** → With relaxed blocking, a user could have multiple `pr_created` sessions and then start a new executing one. Mitigation: the global `maxConcurrent` limit still applies as a hard ceiling on total active executions.
- **[Auto-execute + ephemeral messages]** → For ephemeral (DM-first) responses, auto-execute needs to post the progress in the original channel thread, not the DM. Mitigation: use the session's channel/threadTs from the processing context, same as button handlers do.
