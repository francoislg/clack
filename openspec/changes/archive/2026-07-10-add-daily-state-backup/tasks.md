## 1. Config

- [x] 1.1 Add a `BackupConfig` interface to `src/config.ts` and a `backupZod` validator to `src/configSchemas.ts` (modeled on `cronCatchUpZod`), wired via `parseOrThrow(backupZod, c.backup)` in `src/configZod.ts` `validateConfig`. Fields: `enabled` (boolean, default `true`), `folders` (string[], default `["state"]`, relative to `data/`), `timezone` (string, default `"America/Montreal"`). Absent block → defaults.
- [x] 1.2 Fail-fast validation in `backupZod`: reject an invalid IANA `timezone` (construct `new Intl.DateTimeFormat("en-CA", { timeZone })` and reject on throw); reject unsafe `folders` entries (`""`, `"."`, absolute paths, or any path resolving to `data/backups` or an ancestor of it).
- [x] 1.3 Add a thin `getBackupConfig()` accessor to `src/config.ts` returning the parsed `BackupConfig` (or the defaults when config is unloaded), following the pattern of `getCronCatchUpDelayMinutes()` / `getAdditionalAdminWords()`.

## 2. Shared date util (reuse, don't reimplement)

- [x] 2.1 Extract the existing `dateKeysInTimezone(now, timezone)` (`src/cronScheduler.ts`, private, `Intl.DateTimeFormat("en-CA", …)` → `YYYY-MM-DD`) into a small shared module (e.g. `src/dateKeys.ts`); import it in both `cronScheduler` and `stateBackup` so date-key formatting has one source of truth. Keep `cronScheduler` behavior byte-identical.

## 3. Backup routine (`src/stateBackup.ts`)

- [x] 3.1 `runBackup(now)`: compute `{date}` via the shared date util in `backup.timezone`; build all paths from `getDataDir()` (`resolve(getDataDir(), "backups", …)`), never hardcoded `process.cwd()`. Remove any stale `data/backups/.<date>.partial/`, then for each configured folder recursively copy regular files + dirs from `data/<folder>` into the staging dir; on success remove any existing same-day dir and rename staging → `data/backups/<date>/`.
- [x] 3.2 Copy semantics: regular files and directories only (skip special files); do NOT follow symlinks; a configured folder whose `data/<folder>` is absent is skipped with a logged warning (not an error); never delete source or prior backups.
- [x] 3.3 Non-root/GCP permission safety: create every backup dir with `mkdir({ recursive: true, mode: 0o700 })`; after each `copyFile`, `chmod` the destination to the source file's mode so a `600` state file stays `600`. Never call `chown` (would `EPERM` as the non-root container user). No uid/gid assumptions.
- [x] 3.4 Failure isolation: wrap the run so any I/O error is caught and logged, the `.partial` is NOT promoted to a complete dated dir, and neither boot nor the scheduler is affected (next run retries from scratch).
- [x] 3.5 Inject the base data dir and a clock so the routine is unit-testable without touching real `data/`.

## 4. Scheduler + lifecycle

- [x] 4.1 `startStateBackupScheduler()` / `stopStateBackupScheduler()` in `src/stateBackup.ts`: if `enabled`, compute the next local-midnight instant via `cron-parser` (`CronExpressionParser.parse("0 0 * * *", { tz }).next().toDate()`), `setTimeout` → `runBackup` → recompute+reschedule (DST-safe). A module-level handle holds the pending timeout for cancellation. A single-run-in-flight flag serializes runs (a fire overlapping an in-flight run is skipped).
- [x] 4.2 Boot catch-up: on start, if `enabled` and `data/backups/<today>/` is missing, run one backup immediately (at most once per boot), then arm the next-midnight timer.
- [x] 4.3 Wire into `src/lifecycle.ts` following the existing scheduler pattern: add both functions to the `LifecycleDeps` interface + `defaultLifecycleDeps`, and call them from `startSchedulers` / `stopSchedulers`. No-op cleanly when `enabled` is false; cancel the pending timeout on shutdown/soft-restart so timers don't leak.

## 5. Tests (`src/stateBackup.test.ts` — fake timers, injected data dir + clock)

- [x] 5.1 A backup at midnight produces `data/backups/<date>/state/*.json` with content byte-equal to the source; the source is untouched.
- [x] 5.2 Atomicity: a run stages under `.<date>.partial` and renames; a pre-existing same-day dir is replaced by a fresh complete copy; a pre-existing stale `.<date>.partial` from a prior crash is removed before staging (not merged).
- [x] 5.3 Additivity: a second day's run leaves the prior day's dir intact; nothing is pruned.
- [x] 5.4 Boot catch-up: missing today's dir at boot triggers exactly one immediate backup; present dir triggers none.
- [x] 5.5 Disabled config: no scheduler armed, no writes.
- [x] 5.6 Extensibility: with `folders: ["state","configuration"]`, both trees are reproduced; a configured-but-absent folder is skipped with a warning, run still succeeds.
- [x] 5.7 Permissions: a source file with mode `600` is backed up as `600` (not widened); backup dirs are `0o700`; no `chown` is attempted.
- [x] 5.8 Failure isolation: a copy error mid-run is caught+logged, leaves no complete `data/backups/<date>/`, and the scheduler stays armed.
- [x] 5.9 Symlink/special-file handling: a symlink in the source is not followed and not copied; regular files still back up.
- [x] 5.10 Config fail-fast (in the config test suite): an invalid `backup.timezone` and an unsafe `backup.folders` entry each throw at `validateConfig`.

## 6. Ops / housekeeping

- [x] 6.1 Add `data/backups/` to `.gitignore`.
- [x] 6.2 Document in the **Data Directory Layout** section of `CLAUDE.md` that `data/backups/{date}/` holds daily state snapshots, and how to restore from one.

## 7. Green gate

- [x] 7.1 `npx tsc` clean
- [x] 7.2 `npx oxlint` + `npx oxfmt` clean on changed files
- [x] 7.3 `npm test` (vitest) green
- [x] 7.4 `graphify update .` (coordinate timing before staging `graphify-out/`)
