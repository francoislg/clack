import { chmod, copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { CronExpressionParser } from "cron-parser";

import { getBackupConfig, getBackupsDir, getDataDir, type BackupConfig } from "./config.js";
import { dateKeysInTimezone } from "./dateKeys.js";
import { fileExists } from "./fs.js";
import { logger } from "./logger.js";

export interface BackupLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface StateBackupDeps {
  getBackupConfig: () => BackupConfig;
  /** Base `data/` directory the configured `folders` are resolved against. */
  dataDir: string;
  /** `data/backups/` — where dated snapshots and `.partial` staging dirs live. */
  backupsDir: string;
  now: () => Date;
  logger: BackupLogger;
}

export function defaultStateBackupDeps(): StateBackupDeps {
  return {
    getBackupConfig,
    dataDir: getDataDir(),
    backupsDir: getBackupsDir(),
    now: () => new Date(),
    logger,
  };
}

/**
 * Recursively copy regular files and directories from `srcDir` to `destDir`. Symlinks are NOT
 * followed (neither the link nor its target is copied) and special files (sockets, FIFOs,
 * devices) are skipped. Directories are created `0o700` and each copied file is `chmod`'d to
 * its source mode so sensitive `600` state files are never widened. No `chown` (would EPERM
 * under the non-root container user).
 */
async function copyTree(srcDir: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true, mode: 0o700 });
  const entries = await readdir(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const srcPath = join(srcDir, entry.name);
    const destPath = join(destDir, entry.name);
    if (entry.isDirectory()) {
      await copyTree(srcPath, destPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
      const st = await stat(srcPath);
      await chmod(destPath, st.mode);
    }
  }
}

/**
 * Copy the configured `folders` into `data/backups/<date>/` via a `.partial` staging dir that
 * is renamed on success (atomic promotion). Best-effort — a failure is logged and the partial is
 * left in place unpromoted, so a failed run never masquerades as a complete backup. No-op when
 * the feature is disabled. Never deletes live state or prior-day backups.
 */
export async function runStateBackup(
  deps: StateBackupDeps = defaultStateBackupDeps(),
): Promise<void> {
  const cfg = deps.getBackupConfig();
  if (!cfg.enabled) return;

  let date: string;
  try {
    date = dateKeysInTimezone(deps.now(), cfg.timezone).ymd;
  } catch (error) {
    deps.logger.error(`State backup: invalid timezone "${cfg.timezone}" — skipping run:`, error);
    return;
  }

  const finalDir = join(deps.backupsDir, date);
  const partialDir = join(deps.backupsDir, `.${date}.partial`);

  try {
    await rm(partialDir, { recursive: true, force: true });
    await mkdir(partialDir, { recursive: true, mode: 0o700 });

    for (const folder of cfg.folders) {
      const src = join(deps.dataDir, folder);
      if (!(await fileExists(src))) {
        deps.logger.warn(`State backup: source folder "${folder}" does not exist — skipping it`);
        continue;
      }
      await copyTree(src, join(partialDir, folder));
    }

    await rm(finalDir, { recursive: true, force: true });
    await rename(partialDir, finalDir);
    deps.logger.info(`State backup written: ${finalDir}`);
  } catch (error) {
    deps.logger.error(`State backup failed for ${date} — leaving staging dir unpromoted:`, error);
  }
}

/**
 * Run one backup at boot IF today's snapshot is missing, so downtime or a deploy spanning
 * midnight doesn't skip the day. No-op when disabled or today's dir already exists.
 */
export async function maybeBackupOnBoot(
  deps: StateBackupDeps = defaultStateBackupDeps(),
): Promise<void> {
  const cfg = deps.getBackupConfig();
  if (!cfg.enabled) return;

  let date: string;
  try {
    date = dateKeysInTimezone(deps.now(), cfg.timezone).ymd;
  } catch {
    return;
  }
  if (await fileExists(join(deps.backupsDir, date))) return;

  deps.logger.info("State backup: today's snapshot is missing at boot — running catch-up");
  await runGuarded(deps);
}

/** Next local-midnight instant in `tz` strictly after `after`, via cron-parser (DST-aware). */
export function computeNextBackupTime(after: Date, tz: string): Date {
  return CronExpressionParser.parse("0 0 * * *", { currentDate: after, tz }).next().toDate();
}

// ---------------------------------------------------------------------------
// Scheduler — single module-level timer + run-in-flight guard
// ---------------------------------------------------------------------------

let timer: ReturnType<typeof setTimeout> | null = null;
let runInFlight = false;
// True between start and stop. Guards scheduleNext so a fire's queued `.finally(scheduleNext)`
// cannot re-arm a timer after stop has run (stop clears the timer but can't unqueue the finally).
let active = false;

async function runGuarded(deps: StateBackupDeps): Promise<void> {
  if (runInFlight) {
    deps.logger.warn("State backup skipped: a run is already in flight");
    return;
  }
  runInFlight = true;
  try {
    await runStateBackup(deps);
  } finally {
    runInFlight = false;
  }
}

function scheduleNext(deps: StateBackupDeps): void {
  if (!active) return;
  const cfg = deps.getBackupConfig();
  if (!cfg.enabled) return;

  let fireAt: Date;
  try {
    fireAt = computeNextBackupTime(deps.now(), cfg.timezone);
  } catch (error) {
    deps.logger.error(
      `State backup scheduler: invalid timezone "${cfg.timezone}" — not scheduling:`,
      error,
    );
    return;
  }

  const delay = Math.max(0, fireAt.getTime() - deps.now().getTime());
  timer = setTimeout(() => {
    timer = null;
    runGuarded(deps)
      .catch((error) => deps.logger.error("State backup run error:", error))
      .finally(() => scheduleNext(deps));
  }, delay);
  deps.logger.info(`State backup scheduled for ${fireAt.toISOString()} (${cfg.timezone})`);
}

export function startStateBackupScheduler(deps: StateBackupDeps = defaultStateBackupDeps()): void {
  // Always clear any prior generation's timer first, so a double-start (e.g. two soft restarts)
  // can never leak an orphaned timer.
  stopStateBackupScheduler();
  if (!deps.getBackupConfig().enabled) {
    deps.logger.info("State backup disabled — scheduler not started");
    return;
  }
  active = true;
  // Arm the next-midnight timer synchronously, then run boot catch-up independently. The
  // run-in-flight guard and per-day idempotency keep the two from colliding.
  scheduleNext(deps);
  maybeBackupOnBoot(deps).catch((error) =>
    deps.logger.error("State backup boot catch-up error:", error),
  );
}

export function stopStateBackupScheduler(): void {
  active = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
