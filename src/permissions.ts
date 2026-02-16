import { getRole, type UserRole } from "./roles.js";

/**
 * Centralized permission checks.
 * Role-based functions take a UserRole and are synchronous.
 * User-based functions take a userId, resolve the role, and are async.
 */

/** Admin or owner can edit configuration/instruction files */
export function canEditConfig(role: UserRole): boolean {
  return role === "admin" || role === "owner";
}

/** Dev, admin, or owner can request code changes */
export function canRequestChanges(role: UserRole): boolean {
  return role === "dev" || role === "admin" || role === "owner";
}

/** Admin or owner can manage roles (add/remove admins and devs) */
export function canManageRoles(role: UserRole): boolean {
  return role === "admin" || role === "owner";
}

/** Only the owner can transfer ownership */
export function canTransferOwnership(role: UserRole): boolean {
  return role === "owner";
}

// ---- userId-based wrappers ----

export async function userCanEditConfig(userId: string): Promise<boolean> {
  const role = await getRole(userId);
  return canEditConfig(role);
}

export async function userCanManageRoles(userId: string): Promise<boolean> {
  const role = await getRole(userId);
  return canManageRoles(role);
}
