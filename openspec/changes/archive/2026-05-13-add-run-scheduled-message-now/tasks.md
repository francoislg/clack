## 1. Data Model — `replayOf` on run-history entries

- [x] 1.1 Add optional `replayOf?: string` field to the run-history entry type in `src/cronJobs.ts` (the entry shape stored in `job.runs[]`).
- [x] 1.2 Update `updateJobRunStatus` to accept an optional `replayOf` argument and persist it on the new entry. Existing call sites pass nothing; behavior is unchanged when omitted.
- [x] 1.3 Add a small unit test in `src/cronJobs.test.ts` (or co-located test file) verifying that `updateJobRunStatus(jobId, "success", responseTs, replayOf)` round-trips `replayOf` through load/save.

## 2. Cron Executor — `asOf` support

- [x] 2.1 Extend `executeDynamicJob` in `src/cronScheduler.ts` to accept an optional `asOf?: Date` parameter.
- [x] 2.2 When `asOf` is provided, build a REPLAY CONTEXT block (multi-line string instructing Claude to treat the effective current date as `asOf` for relative-date reasoning and filters) and concatenate it to the `additionalSystemPrompt` that's currently `buildAttribution(job)`.
- [x] 2.3 Update `executeJob` (the scheduler's wrapper) and `runJobNow` so they both forward an optional `asOf` to `executeDynamicJob`. Tick-driven fires pass undefined; tool-driven fires can pass a value.
- [x] 2.4 After execution completes (success/error/skipped), pass `replayOf: asOf?.toISOString()` to `updateJobRunStatus` so the new `runs[]` entry carries the provenance field.
- [x] 2.5 Add unit tests in `src/cronScheduler.test.ts`: (a) executeDynamicJob without asOf produces no REPLAY CONTEXT block; (b) executeDynamicJob with asOf injects REPLAY CONTEXT containing the ISO timestamp; (c) the `runs[]` entry written after a replay run carries `replayOf`.

## 3. New MCP Tool — `run_scheduled_message_now`

- [x] 3.1 Create `src/tools/actions/runScheduledMessageNow.ts` exporting `createRunScheduledMessageNowTool(ctx: QueryToolContext)`.
- [x] 3.2 Define args via zod: `id: string`, `asOf?: string` (ISO datetime), `replaceResponseTs?: string`.
- [x] 3.3 Implement permission check: load the job via `getJob(args.id)`; reject if not found; reject if non-admin AND `job.createdBy !== ctx.userId`. Mirror `cancelScheduledMessage.ts` style.
- [x] 3.4 Reject when `!job.prompt` (the tool is dynamic-only — static jobs are unsupported).
- [x] 3.5 Parse `args.asOf` into a `Date` when provided; return a clear error on bad input.
- [x] 3.6 When `args.replaceResponseTs` is set: verify it appears in `job.runs[].responseTs`; if not, return an error. If valid, call `chat.delete` on `(job.channel, args.replaceResponseTs)` best-effort (catch errors, capture as `replaceError`).
- [x] 3.7 Call `runJobNow(job, ctx.slackClient!, asOf)` (or the equivalent direct `executeDynamicJob` + status-update sequence).
- [x] 3.8 Return a textResult with: `ok: true`, `id`, `asOf?`, `replacedPriorPost?: boolean`, `replaceError?: string`, and any observable run outcome (e.g., the new `responseTs` if available).
- [x] 3.9 Add unit tests in `src/tools/actions/runScheduledMessageNow.test.ts` covering: success path (plain run-now), success path (with asOf), success path (with replaceResponseTs success), permission rejection (non-creator non-admin), job-not-found, static-job rejection, invalid asOf, unowned replaceResponseTs, and best-effort delete failure (returns ok with `replaceError`).

## 4. Tool Server Registration

- [x] 4.1 Import `createRunScheduledMessageNowTool` in `src/tools/server.ts`.
- [x] 4.2 Register the tool inside the existing `if (ctx.allowScheduledMessages && ctx.slackClient)` block alongside `createCancelScheduledMessageTool`.
- [x] 4.3 Update `src/tools/server.test.ts` if it asserts on the registered tool set under the scheduled-messages flag. (no-op — the test only sets the flag, doesn't assert on the tool list.)

## 5. Scheduling Instructions — guidance for Claude

- [x] 5.1 Add a "Running a scheduled message on demand" section to `data/default_configuration/user/scheduling.md` covering:
  - When to use `run_scheduled_message_now` (user asks to retry / re-run / replay a schedule).
  - How to pick `asOf` (read `executedAt` from `get_scheduled_message_runs`; quote the ISO string verbatim).
  - When to set `replaceResponseTs` (user wants the prior post replaced rather than supplemented).
  - The two documented limits: tool calls use real wall-clock time even when `asOf` is set; `skipConditions` evaluate against present-time state, so a replay may post when the original skipped (or vice versa).
- [x] 5.2 Verify the file passes `npx oxfmt --check` (the pre-commit hook runs this on staged files).

## 6. End-to-End Verification

- [x] 6.1 Run `npx tsc` to confirm no type errors across `cronJobs.ts`, `cronScheduler.ts`, the new tool, and `server.ts`.
- [x] 6.2 Run `npm test` and confirm all new + existing tests pass. (3142/3142 passing.)
- [x] 6.3 Run `npx oxlint src/tools/actions/runScheduledMessageNow.ts src/cronScheduler.ts src/cronJobs.ts data/default_configuration/user/scheduling.md` to confirm clean lint. (0 warnings, 0 errors across 8 files.)
- [x] 6.4 Run `openspec validate add-run-scheduled-message-now --strict` and confirm green.
- [ ] 6.5 Smoke test in a dev workspace: create a daily-digest cron job, let one tick fire and succeed, then invoke the new tool with `{ id, asOf: <a date 5 days ago> }` and verify (a) the post appears in the target channel, (b) the content reasons about "today" as 5 days ago, (c) `get_scheduled_message_runs` shows the new entry with `replayOf` populated. (Needs the user's running dev workspace — left for the user.)
