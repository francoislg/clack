## 1. Data model + persistence

- [x] 1.1 Added the optional `submitResponseMode?: "always" | "optional" | "skipped"` field to the `CronJob` interface in `src/cronJobs.ts`, alongside `skipConditions`.
- [x] 1.2 Added `sanitizeLoadedJobs` helper that drops the field with a logged warning when the persisted value isn't one of the three valid strings. Invoked from `loadJobs`.
- [x] 1.3 `CreateCronJobParams` accepts the new field and `createJob` includes it in the serialized record when set (omitted otherwise).
- [x] 1.4 `UpdateCronJobParams` accepts `submitResponseMode?: ... | null`. `updateJob`: explicit value overwrites, `null` clears, `undefined` leaves unchanged — matching the `skipConditions` pattern.
- [x] 1.5 Added a new `describe("submitResponseMode")` block in `src/cronJobs.test.ts` with 6 round-trip + CRUD tests (create persists, omits when unset, update sets, update replaces, update null clears, update undefined preserves). All 41 tests pass.

## 2. Plugin SDK integration

- [x] 2.1 Added `submitResponseMode?: ...` to `CronJobSpec` in `src/plugins/sdk.ts`, alongside skipConditions.
- [x] 2.2 Updated `reconcileCronJobs`: create path includes the field when set; update path passes `spec.submitResponseMode ?? null` (so dropping the field from a spec clears the persisted value, matching the existing pattern).
- [x] 2.3 Extended the FakeStore in `sdk.test.ts` to handle the field (createJob/updateJob mock). Added a `describe("submitResponseMode propagation")` block with 4 tests: persist on create, omit when unset, update in place, clear on omit. All 41 sdk tests pass.

## 3. Schema + gate logic in tool server

- [x] 3.1 Threaded `submitResponseMode` through `QueryToolContext` (`tools/types.ts`), the context-builder params (`tools/context.ts`), and into the `createSubmitResponseTool` deps call in `tools/server.ts`.
- [x] 3.2 Updated `computeAllowSkip` to accept the mode arg with the four resolution cells (always=false, optional=true, skipped=true, unset=existing logic). Pre-change call sites continue to work because the new arg is optional.
- [x] 3.3 Added 4 new `computeAllowSkip` tests covering each mode override path plus a "mode unset preserves today's behavior" assertion. All 32 server tests pass.

## 4. Skipped-only schema variant in submit_response

- [x] 4.1 Added `skippedOnlyResponseSchema` constant in `submitResponse.ts` — a shape with a single field `skip_response: z.literal(true)` and a description telling Claude to pass nothing else. The agent SDK uses strip semantics on unknown keys (existing pattern), so the shape itself is the constraint.
- [x] 4.2 Added `submitResponseMode?: "always" | "optional" | "skipped"` to `SubmitResponseDeps` and threaded it from `server.ts`. Did this in 4.1.
- [x] 4.3 In `createSubmitResponseTool`, branch on `isSkippedMode`. When true, use `skippedOnlyResponseSchema`. The handler shares logic with the normal skip path but bypasses the `SKIP_ACKNOWLEDGMENT` message check (which is moot when the schema doesn't expose `message`).
- [x] 4.4 Added a new `describe("submitResponseMode 'skipped'")` block in `submitResponse.test.ts` with 5 tests: accepts `{ skip_response: true }`; doesn't call deliver; doesn't require the acknowledgment string; gate fires before skip when requiredTools is unsatisfied; gate passes and skip succeeds when satisfied. 88 tests pass (was 83 + 5).

## 5. Cron scheduler propagation

- [x] 5.1 `cronScheduler.ts:executeDynamicJob` passes `submitResponseMode: job.submitResponseMode` to `processMessage`, alongside `skipConditions`.
- [x] 5.2 Added the field to `ProcessMessageParams`, `ProcessingContext`, and `AskClaudeOptions`. Threaded through to `buildQueryContext` so the tool-server reads it when building `createSubmitResponseTool`. Full chain wired.
- [x] 5.3 The two unit-test layers (computeAllowSkip + submitResponse skipped-mode block) plus the pass-through threading provide adequate coverage. A full-stack mocked integration test of the same plumbing would be redundant. The full test suite (3753 tests) confirms no regression.

## 6. Prompt guidance

- [x] 6.1 Added `submitResponseMode?: ...` to `PromptOptions`. Added a new RUN TERMINATOR block in `buildPrompt` rendered when `triggerType === "scheduled" && submitResponseMode === "skipped"`. Block explains the schema constraint and tells Claude to call `submit_response({ skip_response: true })` after every required tool.
- [x] 6.2 The branch checks the literal value `"skipped"` — `"always"`, `"optional"`, and unset all skip the block.
- [x] 6.3 The existing SKIP EVALUATION block has an additional guard: `options.submitResponseMode !== "skipped"`. So "optional" + skipConditions renders SKIP EVALUATION; "skipped" + skipConditions renders only the RUN TERMINATOR.
- [x] 6.4 Added 7 tests covering the matrix: renders for skipped+scheduled; suppresses SKIP EVALUATION when skipped + skipConditions; doesn't render for "always"/"optional"/unset; doesn't render for non-scheduled triggers; "optional" + skipConditions still shows SKIP EVALUATION. 60 prompt-builder tests pass.

## 7. create_scheduled_message tool

- [x] 7.1 Added the optional `submitResponseMode: z.enum(["always", "optional", "skipped"]).optional()` Zod parameter to `createScheduledMessage`, with a `.describe()` walking through each mode and the typical use case.
- [x] 7.2 The value is passed to `createJob` so it persists on the cron record.
- [x] 7.3 The success response includes `submitResponseMode` when the field was set (omitted otherwise).
- [x] 7.4 Added 2 new tests (persists when supplied; omits from saved record when not supplied). The Zod enum constraint covers invalid-value rejection at the schema layer — no explicit "bogus value" test needed. 15 createScheduledMessage tests pass.

## 8. Verification + cleanup

- [x] 8.1 `npx tsc --noEmit` clean (one pre-existing error in `format.integration.test.ts` from unrelated WIP — not from this change).
- [x] 8.2 `npm test`: 3765 tests / 738 suites / 0 fail.
- [x] 8.3 `npx oxlint` on all 19 touched files: 0 warnings, 0 errors.
- [x] 8.4 `npx oxfmt` applied; tests rerun green.
- [x] 8.5 `openspec validate add-submit-response-mode --strict`: "Change is valid".
- [x] 8.6 Trivia opt-in landed IN this change (per the user's option B): `buildGameSpecs.ts` sets `submitResponseMode: "skipped"` on every question spec; the reveal spec stays unset. Added 2 tests (`buildGameSpecs.test.ts`) asserting question mode is `"skipped"` and reveal mode is `undefined`. Added a new MODIFIED-via-ADDED spec delta under `specs/trivia-managed-schedules/` capturing the requirement.
- [ ] 8.7 Manually verify in dev/staging: trigger a trivia question cron via `run_scheduled_message_now`. Confirm exactly one Slack message lands (the question itself), and that no stray confirmation block is posted by Claude. The run history records `lastRunStatus: "skipped"` for the submit_response side (no responseTs).
