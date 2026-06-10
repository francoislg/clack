## Why

A 2026-06-09 re-inventory of the zod sweep (see `zod-inventory.md`) found that Change 3 (`persisted-state-loaders-onto-zod`) under-counted the persisted-state layer. It migrated three clean loaders (`workers/persistence.ts`, `roles.ts`, `userPreferences.ts`) and *proposed* folding in `changes/persistence.ts` + `cronJobs.ts`, but those two were **descoped during apply** as "thin guards" — so they still hand-roll validation today. Four further siblings were never enumerated at all.

Seven graceful-degradation loaders therefore remain on the same hand-rolled pattern Change 3 was about: a blind `JSON.parse(...) as X` cast or a bespoke `isValid*`/type-guard function on a runtime-read JSON file, with a log + default/`null` fallback on mismatch. `workers/quarantine.ts` is the most glaring — it sits in `workers/` right beside the file Change 3 *did* migrate.

This is **Change 5 of the sweep**. It depends only on `src/plugins/zodResult.ts` (Change 1). Like Change 3, these are graceful surfaces: schemas must read OLD on-disk data without rejecting it, so the wrapper logs + falls back rather than throwing.

## What Changes

- Define a zod schema for each loader's on-disk shape and replace the hand-rolled guard/cast with `schema.safeParse()`; on failure, log + return the existing default/`null` — no change to graceful-degradation behavior or accepted shapes.
- Surfaces:
  - `workers/quarantine.ts` `readQuarantineRecord` — replace `isQuarantineRecord` (`QuarantineRecord` schema).
  - `autoRespond.ts` `loadRules` — replace `as Partial<AutoRespondState>` (`AutoRespondState` schema; `AutoRespondRule[]`).
  - `cronJobs.ts` `loadJobs` — replace `as Partial<CronJobState>` + `sanitizeLoadedJobs` (`CronJobState`/`CronJob`/`CronRun`/`SkipDate` schemas; the `submitResponseMode` enum becomes `z.enum`).
  - `changes/persistence.ts` `parseSessionState` — replace `isValidSessionState` (`PersistedSessionState` schema).
  - `userSkills.ts` `readMeta` — replace `isValidMetaShape` (`UserSkillMeta` schema); optionally fold `validateSlug`/`validateDescription` into reusable `z.string()` rules.
  - `skillPlugins.ts` manifest read — replace the blind manifest `as` cast (narrow manifest schema; preserve basename/zero-count defaults).
  - `errorReports.ts` `readErrorReport` — replace the blind `as ErrorReport` cast (`ErrorReport` schema). *(Has no loader test today — add one with the migration.)*
- Remove the per-module `isObject`/`isValid*` guards and ad-hoc default-filling once schemas cover them.

## Capabilities

### Modified Capabilities

- `worker-pool` (quarantine sidecar load), `auto-respond` (rules load), `scheduled-messages` (cron-jobs load), `worker-session-restore` (change-session load), `user-created-skills` (skill meta load + slug/description rules), `lazy-skill-loading` (skill-plugin manifest load), `error-reporting` (error-report load): each loader's parsing is schema-driven; graceful-degradation behavior and accepted shapes (including legacy on-disk data) preserved.

## Impact

- Code: `src/workers/quarantine.ts`, `src/autoRespond.ts`, `src/cronJobs.ts`, `src/changes/persistence.ts`, `src/userSkills.ts`, `src/skillPlugins.ts`, `src/errorReports.ts`.
- Risk: MUST read existing on-disk data unchanged — a schema that rejects a real saved file would wipe state (rules, cron jobs, in-flight change sessions, quarantine records). Mitigation: each loader already has a unit test (except `errorReports.ts`); run them as the gate before/after, and add fixture round-trips over real sample files. Lower complexity than Change 2 (single shapes, graceful, no boot-fatal path).
- Explicitly EXCLUDES `src/sessions.ts` (3-shape legacy synthesis — `sessions-loader-onto-zod`), boot config (`config-validation-onto-zod`), migrations (intentional legacy parsing), and external-API parsers.
- Depends on: `collapse-trivia-config-validation-onto-zod` (for `src/plugins/zodResult.ts`); naturally sequenced after `persisted-state-loaders-onto-zod`.
