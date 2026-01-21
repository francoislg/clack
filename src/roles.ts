import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import type { App } from "@slack/bolt";
import { logger } from "./logger.js";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export interface RolesConfig {
  owner: string | null;
  admins: string[];
  devs: string[];
}

export type UserRole = "owner" | "admin" | "dev" | "member";

const DEFAULT_ROLES: RolesConfig = {
  owner: null,
  admins: [],
  devs: [],
};

let cachedRoles: RolesConfig | null = null;

function getStateDir(): string {
  return resolve(process.cwd(), "data", "state");
}

function getRolesPath(): string {
  return resolve(getStateDir(), "roles.json");
}

export async function loadRoles(): Promise<RolesConfig> {
  if (cachedRoles) {
    return cachedRoles;
  }

  const rolesPath = getRolesPath();

  if (!(await exists(rolesPath))) {
    cachedRoles = { ...DEFAULT_ROLES };
    return cachedRoles;
  }

  try {
    const content = await readFile(rolesPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<RolesConfig>;

    // Ensure all fields exist with defaults
    cachedRoles = {
      owner: parsed.owner ?? null,
      admins: parsed.admins ?? [],
      devs: parsed.devs ?? [],
    };

    return cachedRoles;
  } catch (error) {
    logger.error("Failed to load roles:", error);
    cachedRoles = { ...DEFAULT_ROLES };
    return cachedRoles;
  }
}

export async function saveRoles(roles: RolesConfig): Promise<void> {
  const stateDir = getStateDir();
  const rolesPath = getRolesPath();

  // Ensure state directory exists
  if (!(await exists(stateDir))) {
    await mkdir(stateDir, { recursive: true });
  }

  await writeFile(rolesPath, JSON.stringify(roles, null, 2));
  cachedRoles = roles;
  logger.debug("Roles saved successfully");
}

export async function isOwner(userId: string): Promise<boolean> {
  const roles = await loadRoles();
  return roles.owner === userId;
}

export async function isAdmin(userId: string): Promise<boolean> {
  const roles = await loadRoles();
  // Owner is implicitly an admin
  return roles.owner === userId || roles.admins.includes(userId);
}

export async function isDev(userId: string): Promise<boolean> {
  const roles = await loadRoles();
  // Owner and admins are implicitly devs
  return (
    roles.owner === userId ||
    roles.admins.includes(userId) ||
    roles.devs.includes(userId)
  );
}

export async function getRole(userId: string): Promise<UserRole> {
  const roles = await loadRoles();

  if (roles.owner === userId) {
    return "owner";
  }
  if (roles.admins.includes(userId)) {
    return "admin";
  }
  if (roles.devs.includes(userId)) {
    return "dev";
  }
  return "member";
}

export async function hasOwner(): Promise<boolean> {
  const roles = await loadRoles();
  return roles.owner !== null;
}

export async function setOwner(userId: string): Promise<void> {
  const roles = await loadRoles();
  const previousOwner = roles.owner;

  roles.owner = userId;

  // If there was a previous owner, demote them to admin
  if (previousOwner && previousOwner !== userId) {
    if (!roles.admins.includes(previousOwner)) {
      roles.admins.push(previousOwner);
    }
  }

  // Remove new owner from admins/devs if present (they're now owner)
  roles.admins = roles.admins.filter((id) => id !== userId);
  roles.devs = roles.devs.filter((id) => id !== userId);

  await saveRoles(roles);
  logger.info(`User ${userId} is now the owner`);
}

export async function addAdmin(userId: string): Promise<{ success: boolean; error?: string }> {
  const roles = await loadRoles();

  // Cannot add owner as admin (they already have higher privileges)
  if (roles.owner === userId) {
    return { success: false, error: "Owner is already an admin" };
  }

  // Already an admin
  if (roles.admins.includes(userId)) {
    return { success: false, error: "User is already an admin" };
  }

  roles.admins.push(userId);

  // Remove from devs if present (promoted)
  roles.devs = roles.devs.filter((id) => id !== userId);

  await saveRoles(roles);
  logger.info(`User ${userId} added as admin`);
  return { success: true };
}

export async function removeAdmin(userId: string): Promise<{ success: boolean; error?: string }> {
  const roles = await loadRoles();

  // Cannot remove owner via admin removal
  if (roles.owner === userId) {
    return { success: false, error: "Cannot remove owner. Use transfer ownership instead." };
  }

  if (!roles.admins.includes(userId)) {
    return { success: false, error: "User is not an admin" };
  }

  roles.admins = roles.admins.filter((id) => id !== userId);
  await saveRoles(roles);
  logger.info(`User ${userId} removed as admin`);
  return { success: true };
}

export async function addDev(userId: string): Promise<{ success: boolean; error?: string }> {
  const roles = await loadRoles();

  // Cannot add owner or admin as dev (they already have higher privileges)
  if (roles.owner === userId || roles.admins.includes(userId)) {
    return { success: false, error: "User already has higher privileges" };
  }

  // Already a dev
  if (roles.devs.includes(userId)) {
    return { success: false, error: "User is already a dev" };
  }

  roles.devs.push(userId);
  await saveRoles(roles);
  logger.info(`User ${userId} added as dev`);
  return { success: true };
}

export async function removeDev(userId: string): Promise<{ success: boolean; error?: string }> {
  const roles = await loadRoles();

  if (!roles.devs.includes(userId)) {
    return { success: false, error: "User is not a dev" };
  }

  roles.devs = roles.devs.filter((id) => id !== userId);
  await saveRoles(roles);
  logger.info(`User ${userId} removed as dev`);
  return { success: true };
}

export async function isUserDisabled(
  client: App["client"],
  userId: string
): Promise<boolean> {
  try {
    const result = await client.users.info({ user: userId });
    return result.user?.deleted === true;
  } catch (error) {
    logger.error(`Failed to check if user ${userId} is disabled:`, error);
    // Assume not disabled on error
    return false;
  }
}

export async function claimOwnershipFromDisabled(
  client: App["client"],
  claimingUserId: string
): Promise<{ success: boolean; error?: string }> {
  const roles = await loadRoles();

  if (!roles.owner) {
    // No owner, just claim directly
    await setOwner(claimingUserId);
    return { success: true };
  }

  // Check if current owner is disabled
  const ownerDisabled = await isUserDisabled(client, roles.owner);
  if (!ownerDisabled) {
    return { success: false, error: "Current owner is still active" };
  }

  // Check if claiming user is an admin
  if (!roles.admins.includes(claimingUserId)) {
    return { success: false, error: "Only admins can claim ownership from disabled owner" };
  }

  // Remove old owner completely (they're disabled)
  const oldOwner = roles.owner;
  roles.owner = claimingUserId;
  roles.admins = roles.admins.filter((id) => id !== claimingUserId && id !== oldOwner);
  roles.devs = roles.devs.filter((id) => id !== claimingUserId && id !== oldOwner);

  await saveRoles(roles);
  logger.info(`User ${claimingUserId} claimed ownership from disabled user ${oldOwner}`);
  return { success: true };
}

export async function transferOwnership(
  client: App["client"],
  currentOwnerId: string,
  newOwnerId: string
): Promise<{ success: boolean; error?: string }> {
  const roles = await loadRoles();

  // Verify current user is owner
  if (roles.owner !== currentOwnerId) {
    return { success: false, error: "Only the owner can transfer ownership" };
  }

  // Check if target is disabled
  const targetDisabled = await isUserDisabled(client, newOwnerId);
  if (targetDisabled) {
    return { success: false, error: "Cannot transfer ownership to a disabled user" };
  }

  // Transfer ownership
  await setOwner(newOwnerId);
  return { success: true };
}

// Clear cache (useful for testing)
export function clearRolesCache(): void {
  cachedRoles = null;
}
