## Why

Several persisted-state JSON loaders hand-roll their shape validation with bespoke type-guard functions, then degrade gracefully (log + return `null`/default) on mismatch. The patterns are duplicated per module (`isObject`, `isWorkersState`, `isValidSessionState`, ad-hoc `?? default`) with no shared schema or formatter. An investigation classified them: `src/workers/persistence.ts`, `src/roles.ts`, `src/userPreferences.ts` are clean single-shape loaders (GOOD candidates); `src/changes/persistence.ts` and `src/cronJobs.ts` (`sanitizeLoadedJobs`) carry only thin single-field guards (trivial, folded in).

This is **Change 3 of the sequenced sweep**. It depends only on `src/zodResult.ts` (Change 1). These are the graceful-degradation surfaces — schemas must read OLD on-disk data without rejecting it, so the wrapping logs + falls back rather than throwing.

## What Changes

- Define zod schemas for `WorkersState`/`PersistedWorker` (enum status, ISO-date → `Date` via `.transform`), `RolesConfig` (`.default()` per field), and the user-preferences map (keep deprecated `dmOptOut` as `.optional()` but strip from the runtime type).
- Replace the hand-rolled type guards with `schema.safeParse()`; on failure, log + return the existing default/`null` (no behavior change to graceful degradation).
- Fold in the trivial single-field guards: `cronJobs.ts` `submitResponseMode` enum and `changes/persistence.ts`'s three-field check become small zod schemas validated at parse time.
- Remove the per-module `isObject`/`is*State` guards and ad-hoc default-filling once schemas cover them.

## Capabilities

### Modified Capabilities

- `worker-pool` / `worker-session-restore` (workers.json load), `user-roles` (roles.json load), `user-preferences` (preferences load): persisted-state parsing is schema-driven; graceful-degradation behavior and accepted shapes preserved, including the inert `dmOptOut` field.

## Impact

- Code: `src/workers/persistence.ts`, `src/roles.ts`, `src/userPreferences.ts`, plus folded-in `src/changes/persistence.ts`, `src/cronJobs.ts`.
- Risk: MUST read existing on-disk data unchanged — a schema that rejects a real saved file would wipe state. Each schema needs a fixture round-trip test over real sample files. Lower complexity than Change 2 (single shapes, no legacy synthesis).
- Explicitly EXCLUDES `src/sessions.ts` (3-shape legacy synthesis) — deferred to `sessions-loader-onto-zod`.
- Depends on: `collapse-trivia-config-validation-onto-zod` (for `src/zodResult.ts`). Stub proposal — `design`/`tasks` to be written once Change 1 lands.
