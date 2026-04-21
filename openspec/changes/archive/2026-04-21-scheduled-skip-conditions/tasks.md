## 1. Storage model and CRUD

- [x] 1.1 Add `skipConditions?: string` to `CronJob` in `src/cronJobs.ts`
- [x] 1.2 Extend `CronRun.status` union (and `CronJob.lastRunStatus`) to include `"skipped"`
- [x] 1.3 Add `skipConditions?: string` to `CreateCronJobParams` and persist it (omit when absent/empty)
- [x] 1.4 Add `skipConditions?: string` to `UpdateCronJobParams`; treat empty string as clear, `undefined` as no-op (match existing `plugin` semantics)
- [x] 1.5 Update `updateJobRunStatus` signature and callers to accept `"skipped"`; ensure `runs` history writes `status: "skipped"` with no `responseTs`
- [x] 1.6 Add/extend `src/cronJobs.test.ts` cases covering create/update/clear of `skipConditions` and the `"skipped"` run status

## 2. Tool server gating

- [x] 2.1 Add `skipConditions?: string` to `ProcessMessageParams` (`src/slack/handlers/core.ts`) and propagate it onto the session so `createToolServer` (`src/tools/server.ts`) can read it from the tool context
- [x] 2.2 In `src/tools/server.ts`, override `allowSkip` for scheduled runs when `skipConditions` is a non-empty string (leave `shouldAllowSkip` unchanged as the default policy) — extracted as `computeAllowSkip(triggerType, skipConditions)` for testability
- [x] 2.3 Add `server.test.ts` cases: scheduled + `skipConditions` set → `allowSkip: true`; scheduled without `skipConditions` → `allowSkip: false`
- [x] 2.4 Verify `submit_response` tests cover the scheduled-with-skip schema path (skip accepted with correct acknowledgment, disengage NOT exposed) — added `skipOnlyResponseSchema` variant so disengage is only exposed when `allowDisengage` is also true

## 3. Prompt assembly

- [x] 3.1 In `src/claude/promptBuilder.ts` scheduled branch, inject a "Skip evaluation" section when `skipConditions` is present, including the verbatim operator string and instructions to call `submit_response` with `skip_response: true` on match
- [x] 3.2 Do NOT include the exact safeguard acknowledgment string in the prompt (the tool enforces it)
- [x] 3.3 Add `src/claude/promptBuilder.test.ts` cases: section rendered when `skipConditions` set, omitted when absent/empty

## 4. Cron scheduler delivery

- [x] 4.1 In `src/cronScheduler.ts`, pass the job's `skipConditions` through to `processMessage` via the `ProcessMessageParams.skipConditions` field added in task 2.1
- [x] 4.2 When the run returns `response.skipped === true`, short-circuit before any `chat.postMessage` / streamer delivery — `submit_response` already skips delivery when skip is accepted; `executeJob` now reads the returned `ClaudeResponse.skipped` flag
- [x] 4.3 Call `updateJobRunStatus(jobId, "skipped")`; do NOT DM the creator
- [x] 4.4 For `oneShot` jobs, delete the job after a skipped run as well (skip still counts as the one chance to fire)
- [x] 4.5 Add `cronScheduler.test.ts` cases: skipped run posts nothing, records `"skipped"`, no creator DM, one-shot cleanup on skip

## 5. MCP tool surface

- [x] 5.1 Add optional `skipConditions` parameter to `create_scheduled_message` (Zod string, describe that it is free-form text evaluated by Claude at run time)
- [x] 5.2 Add optional `skipConditions` parameter to `update_scheduled_message` (empty string clears, omitted leaves unchanged)
- [x] 5.3 Include `skipConditions` in `list_scheduled_messages` output when set
- [x] 5.4 Ensure `get_scheduled_message_runs` output differentiates `"skipped"` from `"success"`/`"error"` — widened `CronRun.status` union flows through the existing `run.status` passthrough
- [x] 5.5 Update tool-mapping labels in `data/default_configuration/tool_mapping/clack.json` if the create/update labels need the new field reflected — existing labels are generic (`{channel}`, `{id}`); no change needed
- [x] 5.6 Add/extend test cases in `src/tools/actions/createScheduledMessage.test.ts`, `src/tools/actions/updateScheduledMessage.test.ts`, `src/tools/query/listScheduledMessages.test.ts`, and `src/tools/query/getScheduledMessageRuns.test.ts` covering the new field and outcome

## 6. Home Tab integration

- [x] 6.1 In `src/slack/homeTab.ts`, show a context line summarizing `skipConditions` (truncate long values) for any job that has it set
- [x] 6.2 Render `lastRunStatus === "skipped"` with a distinct neutral label (not a warning)
- [x] 6.3 Extend the scheduled-message edit modal with a multi-line input for `skipConditions`, pre-filled from the stored value
- [x] 6.4 Wire the modal submit handler to call `updateJob` with the new value (empty string clears)
- [x] 6.5 Refresh the Home Tab after a successful edit so the context line reflects the change (existing `publishHomeView` call covers this)
- [x] 6.6 Add `src/slack/homeTab.test.ts` cases: skipConditions rendered when set / hidden when absent; edit modal input pre-fills and round-trips (set, change, clear)

## 7. Docs and validation

- [x] 7.1 Update `data/default_configuration/user/scheduling.md` to describe `skipConditions`: what it does, when to use it, and the run-history outcome
- [x] 7.2 Run `openspec validate scheduled-skip-conditions --strict` and fix any reported issues
- [x] 7.3 Run `npx tsc` (type check) and `npm run test` — resolve all errors and failures before calling the change done
