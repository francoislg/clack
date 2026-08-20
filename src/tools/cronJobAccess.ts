/**
 * Cron job access-control predicates for scheduled-message tools and the Home Tab.
 *
 * These functions are the SINGLE source of truth for every access check.
 * Do NOT inline ownership or role checks elsewhere; import and call the appropriate predicate.
 */

import type { CronJob } from "../cronJobs.js";
import { canManageRoles } from "../permissions.js";
import type { UserRole } from "../roles.js";

export interface Viewer {
  userId: string;
  role: UserRole;
}

/**
 * True when the viewer can see the full details of the job.
 * Available to: admins, the creator, anyone when editableByAnyone is set, and anyone for plugin-managed jobs.
 */
export function canViewFull(job: CronJob, viewer: Viewer): boolean {
  if (canManageRoles(viewer.role)) return true;
  if (job.createdBy === viewer.userId) return true;
  if (job.editableByAnyone === true) return true;
  if (job.pluginManaged === true) return true;
  return false;
}

/**
 * True when the viewer can edit/disable/run the job.
 * Available to: admins, the creator, or anyone when editableByAnyone is set.
 * Note: plugin-managed jobs are never editable by non-admins, even if editableByAnyone is true.
 */
export function canEdit(job: CronJob, viewer: Viewer): boolean {
  if (canManageRoles(viewer.role)) return true;
  if (job.pluginManaged === true) return false;
  if (job.createdBy === viewer.userId) return true;
  if (job.editableByAnyone === true) return true;
  return false;
}

/**
 * True when the viewer can remove the job.
 * Available only to: admins or the creator.
 * editableByAnyone does NOT grant removal permission.
 */
export function canDelete(job: CronJob, viewer: Viewer): boolean {
  if (canManageRoles(viewer.role)) return true;
  if (job.createdBy === viewer.userId) return true;
  return false;
}

/**
 * True when the viewer may set or clear the job's editableByAnyone flag.
 * Restricted to admins and the creator — a shared job's other editors cannot
 * change its sharing policy. Private-target jobs (DM-delivered or channelless
 * user-created) are never sharable; sharing such a surface is meaningless and
 * would expose a private delivery path to unintended audiences.
 */
export function canToggleShared(job: CronJob, viewer: Viewer): boolean {
  if (isPrivateTarget(job)) return false;
  if (canManageRoles(viewer.role)) return true;
  if (job.createdBy === viewer.userId) return true;
  return false;
}

/**
 * True when the job is private to its creator or the system.
 * DM-targeted jobs and channelless non-plugin jobs are considered private.
 * Channelless plugin-managed jobs stay public.
 */
export function isPrivateTarget(job: CronJob): boolean {
  if (job.channel !== undefined && job.channel.startsWith("D")) return true;
  if (job.channel === undefined && job.pluginManaged !== true) return true;
  return false;
}
