import { errorMessage } from "../errors.js";
import { logger } from "../logger.js";
import { loadConfig } from "../config.js";
import { migrations } from "./index.js";
import { readVersion, writeVersion } from "./version.js";
import { getPendingMigrations, executeMigration } from "./engine.js";
import { handleMigrationFailure } from "./admin.js";

/**
 * Run blocking migrations before Clack starts.
 * Exits the process if a blocking migration fails.
 */
export async function runBlockingMigrations(): Promise<void> {
  const currentVersion = await readVersion();
  const pending = getPendingMigrations(currentVersion, migrations);
  const blocking = pending.filter((m) => m.priority === "blocking");

  if (blocking.length === 0) {
    logger.debug("No pending blocking migrations");
    return;
  }

  logger.info(`Running ${blocking.length} blocking migration(s)...`);

  let touchedConfig = false;

  for (const migration of blocking) {
    try {
      await executeMigration(migration);
      await writeVersion(migration.version);
      logger.info(`Migration "${migration.name}" (v${migration.version}) complete`);

      if (migration.files.some((f) => f.includes("config.json"))) {
        touchedConfig = true;
      }
    } catch (error) {
      const errMsg = errorMessage(error);
      logger.error(`Blocking migration "${migration.name}" failed:`, error);

      // Try to notify admin (Slack may not be started yet for blocking migrations)
      await handleMigrationFailure(migration.name, migration.version, errMsg);

      // Blocking migration failure is fatal
      process.exit(1);
    }
  }

  // Reload config so the rest of boot uses the migrated version
  if (touchedConfig) {
    loadConfig(undefined, true);
    logger.info("Config reloaded after blocking migrations");
  }
}

/**
 * Run enhancement migrations asynchronously after boot.
 * Does not block Clack operation. Reloads config after migrations that touch config files.
 */
export async function runEnhancementMigrations(): Promise<void> {
  const currentVersion = await readVersion();
  const pending = getPendingMigrations(currentVersion, migrations);
  const enhancements = pending.filter((m) => m.priority === "enhancement");

  if (enhancements.length === 0) {
    logger.debug("No pending enhancement migrations");
    return;
  }

  logger.info(`Running ${enhancements.length} enhancement migration(s) in background...`);

  for (const migration of enhancements) {
    try {
      await executeMigration(migration);
      await writeVersion(migration.version);
      logger.info(`Enhancement migration "${migration.name}" (v${migration.version}) complete`);

      // Hot-reload config if migration touched config files
      const touchesConfig = migration.files.some((f) => f.includes("config.json"));
      if (touchesConfig) {
        try {
          loadConfig(undefined, true);
          logger.info("Config reloaded after enhancement migration");
        } catch (reloadError) {
          logger.warn("Failed to reload config after migration:", reloadError);
        }
      }
    } catch (error) {
      const errMsg = errorMessage(error);
      logger.error(`Enhancement migration "${migration.name}" failed:`, error);
      await handleMigrationFailure(migration.name, migration.version, errMsg);
      // Enhancement failures don't stop other migrations
    }
  }
}
