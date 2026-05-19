## Why

Plugin-managed cron jobs (e.g. trivia question/reveal schedules reconciled via `sdk.reconcileCronJobs`) fire as a fake userId equal to the plugin name (`createdBy: "trivia"`). At execution time this resolves to role `"member"` (the default for unknown users), which silently filters out any plugin tool gated above `"member"` — including the very tools the job's `requiredTools` list declares. The result is a catch-22: Claude is told it MUST call `mcp__trivia__get_ideas` / `mcp__trivia__save_question`, but those tools are absent from the catalog, so the scheduled run cannot complete. The same fake-userId leak also breaks error-DM routing, Slack mention rendering, and session attribution for plugin-managed jobs.

## What Changes

- **ADD** a top-of-hierarchy `"system"` user role tier. Internal-only — never assignable, never returned by `getRole(userId)` from disk, never rendered in the Home Tab role pickers.
- **ADD** an `Actor` abstraction in `src/actor.ts` (kind: `"user" | "system"`) plus utilities `resolveJobActor`, `actorRole`, `actorDmTarget`, `actorDisplay` so call sites consume actor identity through a single typed surface instead of touching `job.createdBy` directly.
- **BREAKING** Cron job data model: `createdBy` becomes nullable (`string | null`); plugin-managed jobs persist with `createdBy: null` and a new `systemActor: "plugin:<name>"` field. User-created jobs are unchanged.
- **MODIFY** `sdk.reconcileCronJobs` to emit `createdBy: null` + `systemActor: "plugin:<ownerKey>"` instead of `createdBy: pluginName`.
- **MODIFY** the cron scheduler so plugin-managed jobs run as role `"system"` (which `meetsMinimumRole` treats as ≥ any tier, but which `role === "owner"` literal checks correctly exclude).
- **MODIFY** error-DM routing: when a system-actor job fails, route the failure DM to the deployment owner via `sdk.dmOwner` instead of attempting to DM a non-user.
- **MODIFY** Home Tab cron rendering and any `slackLink(job.createdBy)` call site to use `actorDisplay` and tolerate `createdBy === null`.
- **ADD** a boot migration that rewrites existing plugin-managed entries in `cron-jobs.json`: `createdBy: "<plugin>"` → `createdBy: null` + `systemActor: "plugin:<plugin>"`.

## Capabilities

### New Capabilities

None — this change introduces an internal type tier and utility module but does not create a new spec-level capability.

### Modified Capabilities

- `user-roles`: add the `"system"` role tier and its internal-only / hierarchy / exclusion semantics.
- `cron-messages`: make `createdBy` nullable in the data model, add the optional `systemActor` field, and route error notifications for system-actor jobs to the deployment owner.
- `plugin-cron-reconciliation`: change `reconcileCronJobs` to emit `createdBy: null` + `systemActor: "plugin:<ownerKey>"` rather than overloading `createdBy` with the plugin name.

The new boot migration that rewrites legacy `cron-jobs.json` rows is an application of the existing `boot-migrations` capability, not a change to it.

## Impact

- **Code touched**: `src/roles.ts`, `src/permissions.ts`, `src/actor.ts` (new), `src/cronJobs.ts`, `src/cronScheduler.ts`, `src/plugins/sdk.ts`, `src/slack/handlers/changeWorkflowHelper.ts`, `src/slack/handlers/homeTab.ts` (cron rendering), `src/migrations/` (new migration file + registration), `src/claude/index.ts` (role plumbing into `buildQueryContext` is already wired).
- **Persisted data**: `data/state/cron-jobs.json` — plugin-managed rows rewritten by boot migration on next start.
- **Plugin authors**: no API change — `sdk.reconcileCronJobs` keeps the same signature; the actor-shape rewrite happens server-side.
- **Tests**: new unit tests for role hierarchy/exclusion semantics, actor utilities, scheduler role resolution, error-DM routing, and the boot migration. Existing tests that assert `createdBy === pluginName` on reconciled jobs will be updated.
- **No user-facing config change** required; admins do not interact with the new role tier.
