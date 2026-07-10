# Design

## Decision 0 — A dedicated scheduler, NOT a cron job

The backup runs on its own lightweight timer in `src/stateBackup.ts`, not as an entry in `cron-jobs.json`. Reasons:

- **Independence from the thing it protects.** The cron-job system is exactly the surface that failed on 07-06. A backup that depends on loading `cron-jobs.json` could be disabled by the same corruption. The backup must run even if every other state file is unreadable.
- **No Claude involved.** The cron scheduler drives Claude-powered prompts; a file copy needs none of that machinery.

Implementation: on boot compute the next local-midnight instant in `backup.timezone`, `setTimeout` to fire, run the backup, then recompute+reschedule (never a fixed 24h interval, so DST shifts don't drift the fire time). **Reuse the existing `cron-parser` dependency for the DST-aware next-midnight math** — `CronExpressionParser.parse("0 0 * * *", { tz }).next().toDate()` — exactly as `src/cronScheduler.ts` computes fire times, rather than hand-rolling timezone arithmetic. Production code may use `Date`/timers freely (the ban is workflow-scripts/tests only); tests use fake timers and an injected clock/path.

## Decision 1 — Config shape (fail-fast zod, boot config)

```jsonc
"backup": {
  "enabled": true,                // default true; false → feature fully inert
  "folders": ["state"],           // paths relative to data/; default ["state"]
  "timezone": "America/Montreal"  // for computing midnight and the {date} label; default
}
```

`backup` is boot config, so it is parsed **fail-fast** following the established config pattern: add a `backupZod` validator to `src/configSchemas.ts` (modeled on `cronCatchUpZod`) and wire it via `parseOrThrow(backupZod, c.backup)` in `src/configZod.ts` `validateConfig`. Add a `BackupConfig` interface to `src/config.ts`. An absent `backup` block means defaults: `enabled: true`, `folders: ["state"]`, `timezone: "America/Montreal"` (the user's working zone — see Decision 2).

`backupZod` enforces at boot (fail-fast, throw a formatted error):
- **`timezone`** is a valid IANA zone. Validate by constructing `new Intl.DateTimeFormat("en-CA", { timeZone })` (or a `cron-parser` parse with `tz`) and rejecting on throw — an invalid zone fails boot rather than silently firing in UTC.
- **`folders`** entries are safe relative paths: reject `""`, `"."`, absolute paths, and any entry that resolves to `data/backups` or an ancestor of it (guards against a folder that would recurse into the backup tree). See Decision 6.

`folders` is the extensibility hinge: the copy routine iterates the list, so future folders (`configuration`, `worktree-sessions`, …) are added by editing config. This change ships `["state"]`.

## Decision 2 — Destination layout and date label

```
data/backups/2026-07-10/state/roles.json
data/backups/2026-07-10/state/cron-jobs.json
data/backups/2026-07-10/state/...
```

`{date}` = `YYYY-MM-DD` computed in `backup.timezone` (default `America/Montreal`, the user's working zone; the label reflects the configured zone, not UTC). **Reuse the existing date-key logic** rather than reimplementing it: `src/cronScheduler.ts` already has `dateKeysInTimezone(now, timezone)` (private, `Intl.DateTimeFormat("en-CA", …)` → `YYYY-MM-DD`). Extract it to a small shared module (e.g. `src/dateKeys.ts`) and import it in both `cronScheduler` and `stateBackup` so there is one source of truth for timezone-aware date formatting.

All backup paths are built from the existing `getDataDir()` accessor (`src/config.ts`) — `resolve(getDataDir(), "backups", date, folder)` — never a hardcoded `process.cwd() + "data"`. Each configured folder is reproduced under the dated dir preserving its relative structure (`state/` → `backups/<date>/state/`).

## Decision 3 — Atomic directory via staging + rename

A run first removes any pre-existing `data/backups/.<date>.partial/` (a stale remnant from an earlier crashed same-day run), copies fresh into it, and on success renames it to `data/backups/<date>/` (removing any existing same-day dir immediately before the rename — a re-run for the same day produces a fresh complete snapshot). A crash mid-copy leaves only the `.<date>.partial` dir; because it is never renamed, no consumer mistakes it for a complete backup, and the next run replaces it. Rename within the same filesystem is atomic. (Removing our own transient `.partial` staging dir is not a "deletion" in the never-delete sense — that rule protects completed backups and live state, not this run's own scratch dir.)

## Decision 4 — Additive only; NO retention/pruning

The routine never deletes anything: not old backups, not the live state, not `.partial` remnants from other days (only its own current-day partial is replaced). Automatic deletion of old backups is deliberately excluded — unbounded growth of small JSON snapshots is cheap, and silent deletion of recovery artifacts is exactly the failure mode this whole effort exists to prevent. Retention, if ever wanted, is a separate explicit decision with its own options (keep-N-days vs keep-all vs size cap) — not baked in here.

## Decision 5 — Boot catch-up

On startup, if `enabled` and `data/backups/<today>/` does not already exist, run one backup immediately (then schedule the next midnight normally). This mirrors the `src/cronCatchUp.ts` philosophy: a deploy or downtime spanning midnight should not silently skip that day's snapshot. At most one catch-up backup per boot.

**Single-run-in-flight guard.** A module-level "run in flight" flag serializes backups: a scheduled-midnight fire that would overlap a still-running catch-up (or vice versa) is skipped rather than run concurrently, and because a completed same-day dir is checked/replaced atomically, the worst case is one good snapshot, never two interleaved copies. The catch-up existence check (`<today>/` present → skip) already prevents a redundant second backup on the catch-up day.

## Decision 6 — Copy semantics

For each configured folder, recursively copy **regular files and directories only** — special files (sockets, FIFOs, devices) are skipped and symlinks are **not followed** (neither the link nor its target is copied). State dirs hold JSON today; copying all regular files keeps it general and avoids per-extension logic. The `data/backups/` tree itself is never a backup source (guarded at config parse per Decision 1). Copy is read-only w.r.t. the source.

**Missing source folder.** A configured folder whose `data/<folder>` does not exist is skipped with a warning; the run proceeds and backs up the folders that do exist (realistic during early deployment or when a newly-added folder hasn't been created yet). It is not an error.

## Decision 9 — Failure isolation: a backup error never crashes the process

A backup run is best-effort and fully isolated. Any I/O error during a run (disk full, unwritable mount, a file vanishing mid-copy) is caught and logged; the run aborts without promoting its `.partial` to a complete dated dir (so a failed run never masquerades as a good backup), and the scheduler/process is unaffected — the next scheduled run retries from scratch. The backup must never be able to take down boot or the scheduler. (A future enhancement could DM the owner on repeated failures; out of scope here — logging is the contract.)

## Decision 7 — Lifecycle wiring

The scheduler follows the exact pattern the other schedulers use in `src/lifecycle.ts`: export `startStateBackupScheduler()` / `stopStateBackupScheduler()` from `src/stateBackup.ts` (a module-level handle holds the pending `setTimeout` for cancellation), add both to the `LifecycleDeps` interface + `defaultLifecycleDeps` (`src/lifecycle.ts`), and call them from `startSchedulers` / `stopSchedulers` so they participate in boot, shutdown, and soft-restart alongside the cron/sync/cleanup schedulers. No-op cleanly when `enabled` is false. This keeps the backup lifecycle consistent with `startCronScheduler`/`stopCronScheduler` and cancellable the same way.

## Decision 8 — GCP / non-root permission model

In production the container runs as `USER clack` (uid 1001, group nodejs) with `/app` chowned to it; the persisted data disk mounts at `/app/data`. The backup routine writes as that **same** process into that **same** mount, so backup files/dirs inherit identical ownership to the live state — no ownership handling is needed. But two rules make it correct and GCP-friendly rather than umask-dependent:

- **Never `chown`.** A non-root process cannot change file ownership; a `chown` call would throw `EPERM` on the VM. The routine MUST NOT attempt to set ownership — it relies on the process identity, exactly as the existing state writers do.
- **Preserve modes explicitly, don't trust umask.** State files are sensitive (roles, prefs, auth-adjacent) and are `600` on disk; the state dir is `700`. `fs.copyFile` sets the destination to a default-created mode (then umask), NOT the source mode, so the routine SHALL `chmod` each copied file to its **source** mode and SHALL create every backup directory with mode `0o700`. This keeps a `600` state file `600` in the backup regardless of the container umask, so a backup never widens the permissions of the data it copies.

`mkdir` uses `{ recursive: true, mode: 0o700 }`; per-file: `copyFile` then `chmod(dest, srcStat.mode)`. No assumption is made about uid/gid, and no host-side setup is required beyond the existing data-disk mount.
