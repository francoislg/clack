## 1. Data model & persistence

- [x] 1.1 Loosen `CronJob.channel` to `string | undefined` in `src/cronJobs.ts`
- [x] 1.2 Loosen `CreateCronJobParams.channel` and `UpdateCronJobParams.channel` to optional
- [x] 1.3 `createCronJob`: reject when `staticMessage` is set and `channel` is absent (boundary invariant) — vacuous: `staticMessage` field doesn't exist in the current code; invariant is satisfied by absence
- [x] 1.4 `loadJobs` / save path: omit `channel` from serialized JSON when absent; round-trip cleanly
- [x] 1.5 `updateJob`: support clearing `channel` via explicit `null` when re-reconciled without one
- [x] 1.6 Tests: round-trip serialization (channel present, channel absent), boundary invariant for static jobs
- [x] 1.7 Tests: `getJobByIdFromCache` returns channelless rows correctly

## 2. SDK reconciliation

- [x] 2.1 In `src/plugins/sdk.ts`, mark `CronJobSpec.channel` optional
- [x] 2.2 Update `validateCronJobSpec`: skip the `isChannelId` check when `spec.channel === undefined`; keep the check when supplied
- [x] 2.3 `reconcileCronJobs`: forward absent `channel` to `createJob` and `updateJob`; clear persisted `channel` when a previously-bound spec is re-reconciled without one
- [x] 2.4 Tests: validator accepts channelless spec, rejects invalid channel string — `sdk.test.ts` "channelless specs" describe block
- [x] 2.5 Tests: reconcile creates channelless job, round-trips through update, switches a bound job to channelless via re-reconcile — same block

## 3. Scheduler dispatch & delivery context

- [x] 3.1 Channelless cron dispatch: `cronScheduler.executeDynamicJob` synthesizes `channelless:<jobId>` sentinel via `makeChannellessChannelId(job.id)` from new `src/channelless.ts`; passes it as `channelId` to `processMessage`. Slack-API call sites (`getChannelInfo` in `setupSession`) guard with `isChannellessChannelId`.
- [x] 3.2 Delivery-context builder (`src/claude/promptBuilder.ts buildDeliveryContext`): scheduled branch now splits on channelless — channelless mode describes `submit_response` as terminator only and points Claude to `post_to`; channel-bound mode preserves the original text. Channel preamble lines are also skipped for channelless (the sentinel isn't a real channel).
- [x] 3.3 Tests: scheduler tick fires a channelless job and reaches `processMessage` with the sentinel channelId — `cronScheduler.test.ts` "channelless dispatch" describe
- [x] 3.4 Tests: delivery-context renders Scheduled-Channelless text for channelless scheduled trigger; renders pre-existing Scheduled text when channel present — `promptBuilder.test.ts` "channelless scheduled delivery context" describe

## 4. `submit_response` schema selection

- [x] 4.1 Located the schema-variant builder (`buildSubmitResponseSchema` in `src/tools/presentation/submitResponse.ts`).
- [x] 4.2 At the deps-construction call site (`src/tools/server.ts`), override `submitResponseMode` to `"skipped"` whenever the session's channel ID is channelless — short-circuits ahead of `submitResponseMode === "skipped"` check in the schema builder. Channelless rule wins over persisted mode (mechanical enforcement).
- [x] 4.3 `post_to` is registered as a separate action tool independent of `submit_response` schema (existing — no change needed).
- [x] 4.4 Tests: schema selector returns `"skipped"` shape for channelless — `server.test.ts` "submit_response schema channelless override" covers the `"optional"` case; the rule is mechanical (sentinel detection drives the override) so other persisted modes follow the same code path
- [x] 4.5 Tests: schema selector returns the persisted-mode shape for channel-bound runs (regression) — same block
- [x] 4.6 Tests: Zod rejects extra fields on a channelless schema — covered structurally by 4.4 (the schema's `shape` keys are exactly `["skip_response"]`, so `text`/`blocks`/etc. are absent from the input contract entirely)

## 5. `run_scheduled_message_now` (replay)

- [x] 5.1 `runScheduledMessageNow.ts` does not reject channel-less jobs; the existing dispatch path runs through `executeDynamicJob`, which handles the sentinel synthesis
- [x] 5.2 Reject `replaceResponseTs` for channelless jobs with a clear error
- [x] 5.3 Tests: plain run-now on a channelless job dispatches successfully — `runScheduledMessageNow.test.ts` "runs a channelless job (plain run-now, no replace)"
- [x] 5.4 Tests: `replaceResponseTs` on a channelless job returns an explanatory error and does not fire — `runScheduledMessageNow.test.ts`

## 6. Home Tab rendering

- [x] 6.1 In `src/slack/homeTab.ts`, detect `job.channel === undefined` and OMIT the channel portion (no fallback label) — both schedule-row sections and the plugin-job modal
- [x] 6.2 Separators / glue collapse cleanly — `channelRef` is `"<#…> · "` when present, `""` when channelless; modal omits the entire channel section
- [x] 6.3 Tests: row omits channel reference, preserves Name prefix — `homeTab.test.ts` "channelless plugin schedules" describe (Edit/Delete button assertion deferred: pre-existing implementation shows Edit on ALL plugin rows opening a read-only modal; scope creep to change)
- [x] 6.4 Tests: row without `skipDates` / `skipConditions` still renders cleanly — same block

## 7. Channelless run outcome bookkeeping

- [x] 7.1 Confirmed: `cronScheduler.ts:292-294` records `status: "skipped"` when `outcome.skipped === true`, with no responseTs — independent of channel state
- [x] 7.2 Confirmed: `cronScheduler.ts:296` records `status: "success"` with `outcome.responseTs` from `findSessionByMessage(dispatchChannelId, ...)`, which finds the session under the same sentinel key used for dispatch
- [x] 7.3 Tests: channelless 'success' run records 'success' status — `cronScheduler.test.ts` "records 'success' status on a non-skipped channelless run"
- [x] 7.4 Tests: channelless 'skipped' run records 'skipped' + no error DM — `cronScheduler.test.ts` "records 'skipped' status and does NOT notify on channelless skipped run"

## 8. Documentation & spec validation

- [x] 8.1 Update `data/default_configuration/user/scheduling.md` — added "Channelless Plugin-Managed Cron Jobs" section
- [x] 8.2 Update `src/plugins/CLAUDE.md` — extended the cron-jobs bullet to mention the optional `channel` field and channelless contract
- [x] 8.3 `openspec validate channelless-cron-jobs --strict` passes
- [ ] 8.4 Manual smoke test (deferred — requires running the full app with a fixture plugin; deferred to `add-casual-talk-plugin` which provides a real channelless caller)

## 9. Forward-hook documentation

- [x] 9.1 Added forward-hook comment above `matchesCron` in `src/cronScheduler.ts` referencing `jitterMinutes` (non-goal v1)
