## Why

On 2026-07-06 every user-created cron job silently vanished from the deployed VM. Root cause: `loadJobs()` (`src/cronJobs.ts`) validates the persisted file with a single whole-collection `cronJobStateZod.safeParse(...)` over `z.array(cronJobZod)`. That array is **atomic** — if *one* job fails validation (a field tightened by a schema change, a typo, a legacy shape), `safeParse` fails and the loader returns an **empty** array. The next `saveState()` (triggered by plugin `reconcileCronJobs` on boot) then persists that empty-plus-plugin state, making the loss **permanent** on disk.

This directly violates the project's own state-loader rule: graceful readers must be permissive and *"on mismatch log + return the existing default"* per item — a too-strict schema must never *"silently wipe real state."* The current loader wipes the entire collection on any single-item mismatch, and nothing surfaces the loss to a human.

The user requirement is absolute: **a job that fails validation is preserved, never scheduled, and surfaced to the owner. Nothing is deleted without an explicit human decision.**

## What Changes

- **Per-element parse.** `loadJobs()` validates each job individually. Valid jobs load and schedule as today. An invalid job is **never dropped** — it is quarantined.
- **Quarantine, not deletion.** Invalid jobs are preserved verbatim in a new top-level `quarantinedJobs: unknown[]` field in `cron-jobs.json`. `saveState()` round-trips this array untouched on every write, so the plugin-reconcile save cycle can no longer overwrite malformed jobs out of existence.
- **Total-failure guard.** If `JSON.parse` itself throws or the top-level shape is unusable, the loader does NOT null-to-empty-then-overwrite. It snapshots the file to `cron-jobs.corrupt-<ts>.json`, **freezes persistence** (an in-memory flag blocks `saveState` from overwriting the original until cleared), and reports — the original file is left intact and recoverable.
- **Owner notification.** Any quarantine or persistence-freeze DMs the owner(s) with the job id(s), offending field path, and error, reusing the existing owner-DM pattern (`src/workers/quarantineNotifier.ts`).
- **Home Tab recovery panel.** A "Quarantined schedules" section on the Home Tab (owner/admin-gated, same gate as the existing worker-quarantine controls) lists each quarantined job with its validation error and two buttons: **Retry** (re-validate; on success it rejoins the live jobs) and **Delete** (explicit, the only path that removes a quarantined job). A separate banner surfaces the persistence-freeze state so a total parse failure is never silent beyond the owner DM.

Out of scope (called out as follow-ups): the same whole-collection-safeParse fragility exists in the other persisted-state loaders hardened in `refactor(state): zod-validate the remaining persisted-state loaders`; the companion `add-daily-state-backup` change is the generic safety net for all of them. This change deep-fixes only the cron loader, which is the one with a Home Tab surface and the one that actually failed.

## Capabilities

### Modified Capabilities

- `cron-messages`: the load path becomes per-job resilient with quarantine + persistence-freeze; the persist path round-trips `quarantinedJobs` untouched.

### Added Capabilities

- `home-tab`: a Quarantined-schedules panel with Retry / owner-only Delete.

## Impact

- Code: `src/cronJobs.ts` (loadJobs, saveState, new quarantine + freeze state, `isCronPersistenceFrozen`/`getQuarantinedJobs` accessors), `src/slack/homeTab.ts` (panel + freeze banner), `src/slack/handlers/cronQuarantine.ts` (Retry/Delete actions, registered from `src/slack/app.ts`), a new `src/cronQuarantineNotifier.ts` modeled on `src/workers/quarantineNotifier.ts`.
- Data: `cron-jobs.json` gains an optional `quarantinedJobs` array; a `cron-jobs.corrupt-<ts>.json` may be written on total failure. Both live on the persisted data disk.
- Risk: LOW-MEDIUM. The parse change is additive (valid jobs behave identically). The gating test asserts that a file with one bad job now loads the good ones + quarantines the bad one, where today it would return empty.
- Depends on: nothing. Complements `add-daily-state-backup`.
