import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { App } from "@slack/bolt";
import { z } from "zod";
import { logger } from "../logger.js";
import { fileExists } from "../fs.js";
import { upsertRosterMembers, type RosterMember } from "../userRegistry.js";

// How long a full-roster sync is considered fresh before `find_user` triggers another. Distinct
// from the per-user display-name TTL — roster membership churns on a different cadence than names.
const ROSTER_SYNC_TTL_MS = 6 * 60 * 60 * 1000;

// ============================================================================
// Dependency Injection
// ============================================================================

export interface RosterSyncDeps {
  readFile: (path: string, encoding: "utf-8") => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string, options: { recursive: boolean }) => Promise<string | undefined>;
  fileExists: (path: string) => Promise<boolean>;
  upsertRosterMembers: (members: RosterMember[]) => Promise<void>;
  now: () => number;
}

export const defaultRosterSyncDeps: RosterSyncDeps = {
  readFile,
  writeFile,
  mkdir,
  fileExists,
  upsertRosterMembers,
  now: () => Date.now(),
};

let deps: RosterSyncDeps = defaultRosterSyncDeps;

export function setRosterSyncDeps(d: Partial<RosterSyncDeps>): void {
  deps = { ...defaultRosterSyncDeps, ...d };
}

export function resetRosterSyncDeps(): void {
  deps = defaultRosterSyncDeps;
}

// ============================================================================
// Marker persistence
// ============================================================================

const markerZod = z.object({ syncedAt: z.number() });

function getStateDir(): string {
  return resolve(process.cwd(), "data", "state");
}

function getMarkerPath(): string {
  return resolve(getStateDir(), "roster-sync.json");
}

async function readSyncedAt(): Promise<number | null> {
  const path = getMarkerPath();
  if (!(await deps.fileExists(path))) return null;
  try {
    const result = markerZod.safeParse(JSON.parse(await deps.readFile(path, "utf-8")));
    return result.success ? result.data.syncedAt : null;
  } catch (error) {
    logger.debug(`roster-sync marker unreadable, treating as cold: ${error}`);
    return null;
  }
}

async function writeSyncedAt(syncedAt: number): Promise<void> {
  const stateDir = getStateDir();
  if (!(await deps.fileExists(stateDir))) {
    await deps.mkdir(stateDir, { recursive: true });
  }
  await deps.writeFile(getMarkerPath(), JSON.stringify({ syncedAt }, null, 2));
}

// ============================================================================
// Sync
// ============================================================================

function isRealMember(member: { deleted?: boolean; is_bot?: boolean; id?: string }): boolean {
  return !member.deleted && !member.is_bot && member.id !== "USLACKBOT";
}

function toRosterMember(member: {
  id?: string;
  name?: string;
  profile?: {
    display_name?: string;
    real_name?: string;
    image_original?: string;
    image_512?: string;
  };
}): RosterMember {
  return {
    userId: member.id ?? "",
    username: member.name ?? "",
    displayName: member.profile?.display_name || member.profile?.real_name || "",
    avatarUrl: member.profile?.image_original || member.profile?.image_512 || "",
  };
}

// Coalesce concurrent syncs so two stale-triggered searches issue at most one `users.list` sweep.
let inFlight: Promise<void> | null = null;

async function runSync(client: App["client"]): Promise<void> {
  const members: RosterMember[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.users.list({ limit: 1000, cursor });
    if (!result.ok || !result.members) {
      logger.error(`Roster sync: users.list failed: ${result.error}`);
      return;
    }
    for (const member of result.members) {
      if (isRealMember(member)) members.push(toRosterMember(member));
    }
    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  await deps.upsertRosterMembers(members);
  await writeSyncedAt(deps.now());
  logger.debug(`Roster sync: upserted ${members.length} members into the registry`);
}

/** Force a full-roster sync now, coalescing with any in-flight sync. */
export function syncRoster(client: App["client"]): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runSync(client).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function triggerBackgroundSync(client: App["client"]): void {
  syncRoster(client).catch((error) => {
    logger.error(`Background roster sync failed: ${error}`);
  });
}

/**
 * TTL-gated lazy trigger called by `find_user`. Cold (no marker) → await a sync so the first search
 * isn't empty. Stale-but-warm → fire a background sync and return immediately (current registry is
 * served). Fresh → no-op. A missing client is a silent no-op.
 */
export async function ensureRosterFresh(client: App["client"] | null): Promise<void> {
  if (!client) return;

  const syncedAt = await readSyncedAt();
  if (syncedAt === null) {
    await syncRoster(client);
    return;
  }
  if (deps.now() - syncedAt > ROSTER_SYNC_TTL_MS) {
    triggerBackgroundSync(client);
  }
}

// Test seam: reset the in-flight coalescing state between cases.
export function clearRosterSyncState(): void {
  inFlight = null;
}
