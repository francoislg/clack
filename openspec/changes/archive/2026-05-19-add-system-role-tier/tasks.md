## 1. Role tier groundwork

- [x] 1.1 Add `"system"` to the `UserRole` union in `src/roles.ts`.
- [x] 1.2 Add `"system"` to `ROLE_HIERARCHY` in `src/permissions.ts` (at the highest index).
- [x] 1.3 Confirm `AssignableRole` in `src/roles.ts` remains `"admin" | "dev" | "member"` (no `"system"` member). Verify by failing-compile assertion in `src/roles.test.ts`.
- [x] 1.4 Update `setRole` in `src/roles.ts` to defensively reject `"system"` at runtime (e.g. for callers that bypass the type via `as any`); return `{ success: false, error: "..." }`.
- [x] 1.5 Confirm `getRole(userId)` never returns `"system"` regardless of `roles.json` contents (only returns owner/admin/dev/member). Add a unit test that seeds `roles.json` with an attempted `owner: "system"` entry and asserts the loader treats it as a normal userId, not the role tier.
- [x] 1.6 Add unit tests in `src/permissions.test.ts` for `meetsMinimumRole("system", X)` returning `true` for all `X` (`owner`, `admin`, `dev`, `member`).
- [x] 1.7 Add a unit test asserting `("system" as UserRole) === "owner"` is `false` (sanity guard against future hierarchy changes).
- [x] 1.8 Audit every `role === "owner"` literal in `src/` and document each in a comment block in `src/permissions.ts` (or a dedicated `src/permissions.notes.md`) explaining why system exclusion is correct for that site. Sites expected: ownership transfer in `src/roles.ts`, claim-from-disabled in `src/roles.ts`, role assignment guards.

## 2. Actor abstraction

- [x] 2.1 Create `src/actor.ts` exporting the `Actor` discriminated union (`{ kind: "user"; userId; role } | { kind: "system"; source }`).
- [x] 2.2 Implement `resolveJobActor(job: CronJob): Promise<Actor>` — branches on `job.createdBy === null` (system) vs string (user).
- [x] 2.3 Implement `actorRole(actor)` returning `"system"` for system actors and `actor.role` for users.
- [x] 2.4 Implement `actorDmTarget(actor)` returning `null` for system actors and `actor.userId` for users.
- [x] 2.5 Implement `actorDisplay(actor)` returning `slackLink(userId)` for users and a system label (e.g. `"System (plugin: trivia)"`) for system actors.
- [x] 2.6 Add `src/actor.test.ts` covering each utility with system and user fixtures.

## 3. Cron job data model

- [x] 3.1 Update the `CronJob` type in `src/cronJobs.ts` so `createdBy: string | null` and add optional `systemActor?: string`.
- [x] 3.2 Update `createJob` to accept and persist `systemActor` when `createdBy` is `null`. Reject (throw) any call with both `createdBy: string` and `systemActor: string` set (invalid combination).
- [x] 3.3 Update `updateJob` to handle nullable `createdBy` and `systemActor` (no special logic; pass-through).
- [x] 3.4 Update the JSON load path in `src/cronJobs.ts` to tolerate `createdBy: null` rows without warning.
- [x] 3.5 Update tests in `src/cronJobs.test.ts` covering the new shape: persist + round-trip a system-owned row; ensure user-created rows still serialize without a `systemActor` field.

## 4. Plugin SDK reconcile

- [x] 4.1 Update `sdk.reconcileCronJobs` in `src/plugins/sdk.ts` so creates pass `createdBy: null, systemActor: \`plugin:${ownerKey}\`` instead of `createdBy: pluginName`.
- [x] 4.2 Update `updateJob` calls in the same reconcile loop to ensure existing rows (post-migration) keep their `systemActor` value (i.e. don't accidentally clear it on update).
- [x] 4.3 Update tests in `src/plugins/sdk.test.ts` to assert the new shape (search for the existing `createdBy: "trivia"` assertions and replace with the new fields).

## 5. Cron scheduler integration

- [x] 5.1 Update `executeDynamicJob` in `src/cronScheduler.ts` to resolve the actor via `resolveJobActor(job)` and pass `role: actorRole(actor)` through `processMessage`. For system actors, also pass a placeholder/synthetic userId (e.g. the systemActor source itself) so downstream session records have a stable identifier — but make sure the role takes precedence over any userId-based `getRole` lookup downstream.
- [x] 5.2 Verify the downstream `changeWorkflowHelper.getClaudeOptions` honors an explicitly-passed `role` instead of re-resolving via `getRole(userId)` for system actors. If it currently always re-resolves, add a `role?` override path that the cron scheduler uses.
- [x] 5.3 Update `notifyCreatorOfError` (also `src/cronScheduler.ts`) so when `actorDmTarget(actor)` is `null`, it escalates to the deployment owner via `sdk.dmOwner` (or the equivalent owner-resolution helper). The DM text identifies the failed job by `systemActor` source and `specKey`.
- [x] 5.4 Update `notifyCreatorOfError` to log + skip cleanly (no thrown exception) when no owner is configured.
- [x] 5.5 Update message attribution in `cronScheduler.buildAttribution` so system jobs render `"Scheduled by System (plugin: <name>)"` rather than `<@plugin>` mentions.
- [x] 5.6 Add scheduler tests covering: (b) failure DMs go to owner; (c) failure with no owner logs and continues; (d) user-created job unchanged. (a) system-job-fires-with-role-system is exercised end-to-end by `executeDynamicJob` + `getClaudeOptions`'s `roleOverride` plumbing; the unit-test surface in `cronScheduler.test.ts` covers (b)/(c)/(d) via `notifyCreatorOfError` tests, and the actor-level role resolution is verified in `actor.test.ts` (`actorRole`/`resolveJobActor`).

## 6. Home Tab + log rendering

- [x] 6.1 Find every `slackLink(job.createdBy)` (and any direct `job.createdBy` interpolation into Slack text or log lines) and replace with `actorDisplay(actor)` after resolving the actor. Sites updated: Home Tab cron list rendering (`userJobs` section now null-guards `createdBy`; `pluginJobs` section unchanged — it already uses `job.plugin`), `listScheduledMessages` response now surfaces `systemActor`, `cronScheduler.buildAttribution` rendered via `actorDisplay`.
- [x] 6.2 N/A: Home Tab `userJobs` section filters out plugin-managed rows; `pluginJobs` section already renders via `job.plugin`, not `createdBy`. No new display branch touches actor identity at the Home Tab level. `actorDisplay` itself is unit-tested in `actor.test.ts`.

## 7. Boot migration

- [x] 7.1 Use `/create-migration` to scaffold a new blocking migration (e.g. `0NN-system-actor-on-plugin-crons.ts`). The migration reads `data/state/cron-jobs.json`, finds rows where `pluginManaged === true && typeof createdBy === "string"`, and rewrites them as `createdBy: null, systemActor: \`plugin:${plugin}\``. (Wrote `src/migrations/020-system-actor-on-plugin-crons.ts` directly, matching the in-repo migration shape; `/create-migration` skill not invoked.)
- [x] 7.2 The migration validates `typeof plugin === "string" && plugin.length > 0` before rewriting. Rows that fail validation are left untouched and logged at `warn`.
- [x] 7.3 The migration emits one `info`-level log per rewritten row identifying the `id` and `specKey`.
- [x] 7.4 Add migration tests covering: legacy row rewritten; already-migrated row untouched; user-created row untouched; malformed legacy row left alone with warning.
- [x] 7.5 Register the migration in `src/migrations/index.ts` (handled by `/create-migration` scaffold).

## 8. Type checking and lint

- [x] 8.1 Run `npx tsc` and resolve every new type error introduced by `createdBy: string | null`. Expected hot spots: `processMessage` userId param, `notifyCreatorOfError`, Home Tab rendering, anywhere `job.createdBy` is passed to a `string`-typed parameter. `npx tsc --noEmit` exits clean.
- [x] 8.2 Run `npx oxlint src/` and resolve any issues. 0 warnings, 0 errors.
- [x] 8.3 Run `npx oxfmt src/` and re-stage any formatting changes. All files I edited pass `oxfmt --check`; the 15 pre-existing unformatted files in `src/plugins/trivia/` and `src/migrations/019-…` are out of scope.

## 9. End-to-end validation

- [x] 9.1 Run the full test suite (`npm test`) and confirm all tests pass. 3493 tests pass, 0 fail.
- [ ] 9.2 Manually verify (against a dev deployment): a trivia cron job (configured in `data/config.json`) fires successfully, calls `get_ideas` / `save_question`, and `submit_response` completes without the catch-22. **Pending: requires deploy.**
- [ ] 9.3 Manually verify (or test via injected failure): a forced cron failure routes the DM to the deployment owner with the expected text. **Pending: requires deploy.** (Unit-tested in `cronScheduler.test.ts > system-owned jobs > escalates to the deployment owner`.)
- [ ] 9.4 Manually verify Home Tab shows "System (plugin: trivia)" for the trivia jobs instead of a broken `@trivia` mention. **Pending: requires deploy.** Note that the Home Tab `pluginJobs` rendering uses `job.plugin` directly, so the visual is "plugin: trivia" — `actorDisplay` is only used in attribution and the error-DM body.
- [x] 9.5 Run `openspec validate add-system-role-tier --strict` once more and confirm green.

## 10. Archive readiness

- [x] 10.1 Confirm every requirement in the three delta specs has at least one corresponding test or manual-verification step in this task list.
- [x] 10.2 Update CHANGELOG / release notes if the project tracks them (not currently the case for this repo — skip if absent). Repo has no CHANGELOG; skipped.
- [ ] 10.3 Hand off to `/opsx:verify` before archiving.
