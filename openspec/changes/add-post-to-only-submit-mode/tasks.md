# Tasks

## 1. Refactor submit_response (folded in)

- [x] Extract `submitResponse/actions.ts`: action flatten/walk/validators (`flattenActions`, `walkBatchActions`, `validateRefActions`, `validatePostToActions`, `validateStagedIntentsCoverage`, `stampConfigUpdateLabels`, `REF_ACTION_TYPES`) + shared delivery helpers.
- [x] Add shared helpers `persistPostToSnapshots`, `validateNestedPostToButtonLabels`, `persistReferencedIntents`, `collectActionErrors`; rewrite the normal path AND the post-to-only path to use them (DRY — removes the duplicated snapshot/intent/button loops).
- [x] Collapse the 7 ref-backed action schemas (`change`, `config_update`, `update`, `skill_*`) into a single `refActionSchema(...)` factory.

## 2. submit_response schema variant

- [x] Add `optionalPostToResponseSchema` (`{ skip_response?: literal(true), actions }`, no primary fields).
- [x] Add the `"optional-post-to"` branch in `buildSubmitResponseSchema`.
- [x] Add the post-to-only delivery branch in the handler (validate actions → snapshot → capture → record; empty call records a skip).
- [x] Skip path bypasses the `SKIP_ACKNOWLEDGMENT` check in `optional-post-to` (no `message` field in the schema).

## 3. submitResponseMode enum plumbing

- [x] Add `"optional-post-to"` to every `submitResponseMode` type site (cronJobs, context, types, sdk, promptBuilder, claude/index, core, server `computeAllowSkip`).
- [x] `VALID_SUBMIT_RESPONSE_MODES` accepts the new value; persistence/reconcile round-trip clean.

## 4. Channelless mapping

- [x] `server.ts` maps channelless → `"optional-post-to"` (was `"skipped"`).
- [x] Updated stale channelless comments in `cronScheduler.ts` and `cronJobs.ts`.

## 5. casual-talk plugin

- [x] Cron spec sets `submitResponseMode: "optional-post-to"`.

## 6. Tests

- [x] `submitResponse.test.ts`: optional-post-to delivers via post_to (snapshot + capture), bare skip, empty-call-as-skip.
- [x] `server.test.ts`: channelless assembles the `optional-post-to` schema (skip_response + actions only).
- [x] `casual-talk/plugin.test.ts`: reconciled spec asserts `"optional-post-to"`.
- [x] `sdk.test.ts` StoredJob type accepts the new value.

## 7. Verify

- [x] `npx tsc --noEmit`, `npx oxlint src/`, `npx oxfmt --check` all clean.
- [x] Full `npm test` suite green (5458 passed, 3 skipped).
- [ ] `openspec validate add-post-to-only-submit-mode --strict` passes.
- [ ] Manual/VM check after deploy: a casual-talk hit on a quiet channel actually posts (the `post_to executes` count is no longer 0).
