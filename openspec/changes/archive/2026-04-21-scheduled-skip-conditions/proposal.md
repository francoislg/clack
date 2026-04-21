## Why

Scheduled messages always post a response when they fire, even if the job's reason for running no longer applies (e.g., nobody reacted in the last 24h, the target channel is quiet, the linked PR was already merged). Today there is no way to let Claude decline the run from within the prompt — the `scheduled` trigger is excluded from `skip_response`, so any "skip if X" instruction in the prompt results in Claude posting a message explaining that it's skipping, which is the opposite of the desired behavior.

## What Changes

- Add optional `skipConditions` field to scheduled message definitions. When set, it is injected into the system prompt as a pre-check instruction telling Claude to evaluate the conditions first and call `submit_response` with `skip_response: true` if any apply.
- When `skipConditions` is set on a scheduled job, the `submit_response` schema for that run exposes the `skip_response` parameter (and its required acknowledgment). When unset, the schema behavior is unchanged — skip is not offered.
- The cron scheduler's delivery path honors a skipped response by posting nothing for that run (no streamer message to delete for scheduled jobs, so this is a short-circuit before any Slack posting).
- Run history records the skip as a distinct outcome from a normal delivery or a failure, so operators can see which cron fires were intentionally skipped.
- MCP tools updated so Claude can manage the field end-to-end:
  - `create_scheduled_message` accepts an optional `skipConditions` parameter.
  - `update_scheduled_message` can set, replace, or clear the field.
  - `list_scheduled_messages` / `get_scheduled_message_runs` include `skipConditions` (and the skip outcome for runs) in their output.
- Home Tab surfaces `skipConditions` on scheduled message rows (viewable at a glance) and allows admins to edit the field through the existing scheduled-message edit flow.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `skip-response`: extend trigger gating to allow `skip_response` on `scheduled` triggers when the job defines `skipConditions`; keep it disabled for scheduled jobs without that field.
- `cron-messages`: add optional `skipConditions` field to cron jobs, inject it into the run's prompt, handle skipped outcomes in the delivery path and run history, and thread it through scheduler execution. (The `scheduled-messages` capability in `openspec/specs/scheduled-messages/` is unaffected — it covers Slack's native `chat.scheduleMessage` reminder tools, not cron jobs.)
- `clack-tools`: extend `create_scheduled_message`, `update_scheduled_message`, `list_scheduled_messages`, and `get_scheduled_message_runs` to accept / return the new `skipConditions` field and skip outcome.
- `home-tab`: display `skipConditions` on scheduled message rows and allow editing it through the existing scheduled-message admin flow.

## Impact

- **Config schema**: scheduled message / cron job definitions gain an optional `skipConditions: string` field.
- **Prompt assembly**: `src/claude/promptBuilder.ts` scheduled branch injects the skip-evaluation instruction when the field is present.
- **Tool server gating**: `src/tools/server.ts` threads a per-session skip flag so `allowSkip` can be true for scheduled runs that opted in. `shouldAllowSkip` remains the default policy; the opt-in overrides it.
- **Scheduler**: `src/cronScheduler.ts` passes `skipConditions` into the session context and suppresses Slack delivery when the response is skipped.
- **Run history**: scheduled run records need a `skipped` outcome alongside `delivered` / `failed`.
- **MCP tools**: `src/tools/actions/createScheduledMessage.ts`, `src/tools/actions/updateScheduledMessage.ts`, `src/tools/query/listScheduledMessages.ts`, and `src/tools/query/getScheduledMessageRuns.ts` each gain `skipConditions` plumbing; tool-mapping labels in `data/default_configuration/tool_mapping/clack.json` updated if needed.
- **Home Tab**: `src/slack/homeTab.ts` scheduled-message rendering shows the field and the edit modal exposes it for admin editing.
- **Docs**: `data/default_configuration/user/scheduling.md` updated to describe the new field.
- No breaking changes — the field is optional and defaults to the current behavior.
