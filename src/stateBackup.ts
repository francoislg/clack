import { chmod, copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  createDailyScheduler,
  type DailyJob,
  type DailySchedulerLogger,
} from "./dailyScheduler.js";
import { getBackupConfig, getBackupsDir, getDataDir, type BackupConfig } from "./config.js";
import { dateKeysInTimezone } from "./dateKeys.js";
import { fileExists } from "./fs.js";
import { logger } from "./logger.js";

export interface StateBackupDeps {
  getBackupConfig: () => BackupConfig;
  /** Base `data/` directory the configured `folders` are resolved against. */
  dataDir: string;
  /** `data/backups/` — where dated snapshots and `.partial` staging dirs live. */
  backupsDir: string;
  now: () => Date;
  logger: DailySchedulerLogger;
}

const scheduler = createDailyScheduler("State backup");

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
  await scheduler.runGuarded(backupJob(deps));
}

function backupJob(deps: StateBackupDeps): DailyJob {
  return {
    run: () => runStateBackup(deps),
    now: deps.now,
    timezone: () => deps.getBackupConfig().timezone,
    enabled: () => deps.getBackupConfig().enabled,
    logger: deps.logger,
  };
}

export function startStateBackupScheduler(deps: StateBackupDeps = defaultStateBackupDeps()): void {
  scheduler.stop();
  if (!deps.getBackupConfig().enabled) {
    deps.logger.info("State backup disabled — scheduler not started");
    return;
  }
  // The run-in-flight guard and per-day idempotency keep the boot catch-up and the
  // next-midnight timer from colliding.
  scheduler.start(backupJob(deps), () => maybeBackupOnBoot(deps));
}

export function stopStateBackupScheduler(): void {
  scheduler.stop();
}
