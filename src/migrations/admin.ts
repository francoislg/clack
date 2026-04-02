import { loadRoles } from "../roles.js";
import { getSlackClient } from "../slack/app.js";
import { logger } from "../logger.js";
import type { MigrationError } from "./types.js";

/**
 * Get the admin user ID: owner first, then first admin.
 * Returns null if no admin is configured.
 */
export async function getAdmin(): Promise<string | null> {
  const roles = await loadRoles();

  if (roles.owner) {
    return roles.owner;
  }

  if (roles.admins.length > 0) {
    return roles.admins[0];
  }

  return null;
}

/**
 * Send a DM to the admin. Returns true if sent successfully.
 */
export async function dmAdmin(message: string): Promise<boolean> {
  const adminId = await getAdmin();
  if (!adminId) {
    logger.warn("No admin configured for migration DM");
    return false;
  }

  const client = getSlackClient();
  if (!client) {
    logger.warn("Slack client not available for migration DM");
    return false;
  }

  try {
    const dm = await client.conversations.open({ users: adminId });
    if (!dm.channel?.id) {
      logger.warn("Could not open DM channel with admin");
      return false;
    }

    await client.chat.postMessage({
      channel: dm.channel.id,
      text: message,
    });

    return true;
  } catch (error) {
    logger.warn("Failed to DM admin:", error);
    return false;
  }
}

// Module-level migration error state for home tab display
let migrationErrors: MigrationError[] = [];

export function addMigrationError(error: MigrationError): void {
  migrationErrors.push(error);
}

export function getMigrationErrors(): MigrationError[] {
  return migrationErrors;
}

export function clearMigrationErrors(): void {
  migrationErrors = [];
}

/**
 * Handle a migration failure: DM admin, fall back to home tab error state.
 */
export async function handleMigrationFailure(
  migrationName: string,
  version: number,
  error: string,
): Promise<void> {
  const errorRecord: MigrationError = {
    migrationName,
    version,
    error,
    timestamp: Date.now(),
  };

  // Try to DM admin
  const dmSent = await dmAdmin(
    `:warning: *Migration failed: ${migrationName}* (v${version})\n\n${error}\n\nCheck the logs for details and restart Clack after resolving the issue.`,
  );

  if (!dmSent) {
    logger.warn(`Could not DM admin about migration failure. Error will be shown on home tab.`);
  }

  // Always store for home tab banner
  addMigrationError(errorRecord);
}
