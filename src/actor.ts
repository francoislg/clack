import { getRole, type UserRole } from "./roles.js";
import type { CronJob } from "./cronJobs.js";

export type Actor =
  | { kind: "user"; userId: string; role: UserRole }
  | { kind: "system"; source: string };

export interface ActorDeps {
  getRole: (userId: string) => Promise<UserRole>;
}

const defaultDeps: ActorDeps = { getRole };

/**
 * Resolve a cron job into its actor identity.
 *
 * - `createdBy: null` → system actor; the `systemActor` field carries the source.
 * - `createdBy: string` → user actor; role is resolved via `getRole`.
 *
 * Throws if a job claims `createdBy: null` without a `systemActor`. That is an
 * invariant violation — the boot migration and `reconcileCronJobs` both
 * guarantee the field is present for system-owned rows.
 */
export async function resolveJobActor(job: CronJob, deps: ActorDeps = defaultDeps): Promise<Actor> {
  if (job.createdBy === null) {
    if (!job.systemActor) {
      throw new Error(
        `Cron job ${job.id} has createdBy: null but no systemActor — data invariant violated`,
      );
    }
    return { kind: "system", source: job.systemActor };
  }
  const role = await deps.getRole(job.createdBy);
  return { kind: "user", userId: job.createdBy, role };
}

export function actorRole(actor: Actor): UserRole {
  return actor.kind === "system" ? "system" : actor.role;
}

/** Returns the Slack user ID to DM, or null when the actor has no human DM target. */
export function actorDmTarget(actor: Actor): string | null {
  return actor.kind === "system" ? null : actor.userId;
}

/** Slack-safe display string. For users, `<@U…>` mention. For system, a literal label. */
export function actorDisplay(actor: Actor): string {
  if (actor.kind === "system") {
    // Translate "plugin:trivia" → "System (plugin: trivia)" for readability.
    const colonIdx = actor.source.indexOf(":");
    if (colonIdx > 0) {
      const kind = actor.source.slice(0, colonIdx);
      const name = actor.source.slice(colonIdx + 1);
      return `System (${kind}: ${name})`;
    }
    return `System (${actor.source})`;
  }
  return `<@${actor.userId}>`;
}
