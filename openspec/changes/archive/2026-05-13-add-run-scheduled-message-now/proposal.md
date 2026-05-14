## Why

When a scheduled message fails (or fires with the wrong content), the operator's only recourse today is to wait for the next scheduled tick or recreate the job. There is no way to ask Clack to re-run a job on demand, and no way to ask it to re-run "as if" it had fired at the originally-scheduled time — which matters for prompts whose meaning depends on the run's date (daily digests, "yesterday's PRs", weekly retros). The retry conversation is becoming repetitive, and the existing tools cannot express it without either creating a near-immediate one-shot job (which pollutes the schedule list and doesn't update the original's run history) or asking an admin to intervene.

## What Changes

- Add a new MCP tool `run_scheduled_message_now` that fires an existing scheduled job on demand. Three modes collapse into one tool:
  - **Plain run-now**: `{ id }` — fires the job at current time.
  - **Replay/retry with date context**: `{ id, asOf }` — fires now, but instructs Claude to reason about dates as if it were `asOf`. Defaults to the most recent run's `executedAt` when omitted _and_ prior runs exist.
  - **Replace a prior post**: `{ id, replaceResponseTs }` — deletes a previously-posted bot message in the job's target channel before firing.
- Permissions: admins OR the job's `createdBy` can invoke the tool. Mirrors `cancel_scheduled_message`.
- Implicit Clack-ownership check for the optional delete: `replaceResponseTs` must appear in this job's `runs[]`. No reliance on `admin_delete_message`, so creators can clean up their own scheduled-post without admin elevation.
- Date displacement is **prompt-only** via the existing `additionalSystemPrompt` channel — no changes to `PromptOptions`, `AskClaudeOptions`, `ProcessMessageParams`, `ProcessingContext`, or `buildPrompt`. The cron-executor appends a "REPLAY CONTEXT" block to the attribution string when `asOf` is set.
- Run history: the new `runs[]` entry records `replayOf: <asOf ISO>` when the run was a replay, for provenance and debugging.
- Scheduling instructions doc (`data/default_configuration/user/scheduling.md`) gains a section explaining when and how Claude should call the tool.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `cron-messages`: adds the `run_scheduled_message_now` tool (its arguments, permission model, replace behavior, and `asOf` default); extends dynamic-job execution to accept an optional `asOf` date and append replay-context guidance to `additionalSystemPrompt`; adds the `replayOf` field on run-history entries.

## Impact

- **New files**: `src/tools/actions/runScheduledMessageNow.ts` (the tool), `src/tools/actions/runScheduledMessageNow.test.ts`.
- **Modified files**: `src/cronScheduler.ts` (accept `asOf` in `executeDynamicJob`, expose `runJobNow(job, client, asOf?)` extension), `src/cronJobs.ts` (`runs[]` entries get optional `replayOf` field; `updateJobRunStatus` accepts it), `src/tools/server.ts` (register tool under `allowScheduledMessages` block), `data/default_configuration/user/scheduling.md` (new guidance section).
- **No changes** to the Claude prompt-builder pipeline, slack handler params, or `AskClaudeOptions` — date displacement rides on `additionalSystemPrompt`.
- **Slack API**: uses existing `chat.delete` (no new scopes required; Clack already deletes its own messages via `admin_delete_message`).
- **No breaking changes**: pure additive.
