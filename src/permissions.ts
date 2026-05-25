import { getRole, type UserRole } from "./roles.js";

/**
 * Centralized permission checks.
 * Role-based functions take a UserRole and are synchronous.
 * User-based functions take a userId, resolve the role, and are async.
 */

export function canEditConfig(role: UserRole): boolean {
  return meetsMinimumRole(role, "admin");
}

export function canCreateUserSkill(role: UserRole): boolean {
  return meetsMinimumRole(role, "member");
}

export function canEditUserSkill(
  role: UserRole,
  ownerUserId: string,
  callerUserId: string,
): boolean {
  if (meetsMinimumRole(role, "admin")) return true;
  return ownerUserId === callerUserId;
}

export function canRequestChanges(role: UserRole): boolean {
  return meetsMinimumRole(role, "dev");
}

export function canManageRoles(role: UserRole): boolean {
  return meetsMinimumRole(role, "admin");
}

// Literal `=== "owner"` on purpose — excludes the internal `"system"` tier.
export function canTransferOwnership(role: UserRole): boolean {
  return role === "owner";
}

const ROLE_HIERARCHY: UserRole[] = ["member", "dev", "admin", "owner", "system"];

/** Check whether a user's role meets or exceeds a minimum role threshold */
export function meetsMinimumRole(userRole: UserRole, minRole: UserRole): boolean {
  return ROLE_HIERARCHY.indexOf(userRole) >= ROLE_HIERARCHY.indexOf(minRole);
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
