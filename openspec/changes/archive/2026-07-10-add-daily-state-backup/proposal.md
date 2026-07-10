## Why

The 2026-07-06 cron-job wipe was unrecoverable: `saveState` overwrites `data/state/*.json` in place (no atomic temp+rename, no versioning), there were no stray backup files, and the `clack-data` disk has **zero** GCP snapshots. A single bad write or a too-strict loader can therefore destroy persisted state with no way back.

`harden-cron-job-loading` deep-fixes the one loader that failed, but the same class of loss can hit any state file (`roles.json`, `user-preferences.json`, `auto-respond.json`, sessions, worker pool state, …). We need a **generic, loader-independent safety net**: a daily on-disk snapshot of state that survives an in-place overwrite and gives an operator a known-good file to restore from.

## What Changes

- **Daily backup at midnight.** A core scheduler (independent of the cron-job system, so it can't be taken down by the very fragility it protects against) copies configured state folders into a dated directory: `data/backups/{YYYY-MM-DD}/state/*.json`.
- **Extensible folder set, `state` only for now.** The backed-up folders are config-driven (`backup.folders`, default `["state"]`, paths relative to `data/`). The mechanism copies whatever folders are listed, so adding e.g. `configuration` or `worktree-sessions` later is a config change, not a code change. This change ships with `["state"]`.
- **Additive, never deletes.** Backups accumulate; the routine never prunes old backups and never touches the live state files. Retention/cleanup is deliberately out of scope (see design) and would be an explicit, separately-decided follow-up.
- **Atomic backup directory.** Each run copies into a `.partial` staging dir and renames on completion, so an interrupted run never leaves a half-written dated directory that looks complete.
- **Boot catch-up.** If the process was down at midnight and today's backup dir is missing, one backup runs shortly after boot — so a deploy over midnight doesn't skip a day.
- **Config gate.** `backup.enabled` (default on) turns the whole feature off; absent/disabled → no scheduler, no writes.
- **GCP / non-root safe.** Backups are written by the running process (production container runs as non-root `USER clack`, uid 1001, on the mounted data disk): recursive `mkdir` at mode `0o700`, copied files `chmod`'d to their source mode (a `600` state file stays `600`), and **no `chown`** (which would `EPERM` as non-root). Ownership matches the live state automatically because it's the same process on the same mount.

## Capabilities

### Added Capabilities

- `state-backup`: daily, config-driven, additive snapshots of state folders into `data/backups/{date}/`.

## Impact

- Code: new `src/stateBackup.ts` (scheduler + copy routine), wired into the boot/shutdown lifecycle; `backup` config block added to `src/config.ts` / config schema (fail-fast zod — this is boot config).
- Data: new `data/backups/` tree on the persisted data disk; `data/backups/` added to `.gitignore` (belt-and-suspenders under the already-ignored `data/`).
- Ops: complements attaching a GCP snapshot schedule to `clack-data` (separate ops task) — the daily on-disk backup plus disk snapshots together make state loss recoverable.
- Risk: LOW. Purely additive; reads state, writes a separate tree, deletes nothing. No dependency on the cron-job loader.
- Depends on: nothing. Complements `harden-cron-job-loading`.
