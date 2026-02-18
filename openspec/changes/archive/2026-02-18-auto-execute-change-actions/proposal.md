## Why

Change actions (start, update, merge, review, close) require an explicit button click even when the user's intent is unambiguous. This adds unnecessary friction — "Fix this" should just fix it, "Merge it" should just merge. Additionally, users are blocked from starting new changes when they have an existing PR (`pr_created` session), and the update flow spams the thread with multiple progress messages instead of updating one.

## What Changes

- Add an `auto` flag to all ref-based actions (`change`, `update`, `review`, `merge`, `close`) in `submit_response`. When set, the system executes the action immediately after posting the response — no button click needed.
- Update Claude's instructions so it uses `auto: true` when the user's intent is clearly a directive ("Fix this", "Merge it", "Update the PR with X") and omits it when ambiguous.
- Relax session blocking: only block new changes when the user has an actively-executing session (`executing`, `reviewing`, `merging`), not when a session is in `pr_created` state waiting for follow-up.
- Fix the update flow's progress reporting: post one message and update it (like the initial change flow), instead of posting a new message every 30 seconds.

## Capabilities

### New Capabilities
- `auto-execute-actions`: Auto-execution of ref-based actions when Claude determines user intent is unambiguous

### Modified Capabilities
- `changes-workflow`: Relax per-user session blocking to only block on actively-executing statuses; fix progress message handling for the update follow-up flow
- `clack-tool-response`: Add `auto` boolean flag to all ref-based action schemas in `submit_response`
- `clack-tools`: Update dev instructions for when to use `auto: true`

## Impact

- `src/tools/presentation/submitResponse.ts` — Add `auto` field to ref-based action schemas
- `src/slack/handlers/core.ts` — After posting response, detect auto-flagged actions and trigger execution
- `src/slack/handlers/changeAction.ts` — Extract workflow trigger logic for reuse by auto-execute
- `src/slack/handlers/changeThreadActions.ts` — Fix progress reporting to update one message; extract trigger logic for reuse
- `src/changes/session.ts` — Relax `getActiveSessionForUser` to ignore `pr_created` sessions
- `src/changes/workflow.ts` — Adjust concurrency guard to match relaxed blocking
- `data/default_configuration/dev_instructions.md` — Add guidance for `auto: true` usage
