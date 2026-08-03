/**
 * Single-writer store for `data/state/investigations.json`: the admin-configured
 * investigations channel plus the open-investigations routing index (one entry per followed
 * thread). Graceful zod reader — on a parse/shape mismatch it logs and serves the in-memory
 * default without overwriting the on-disk file (the file is replaced only on the next
 * legitimate write). All mutations flow through this module, which persists to disk and then
 * updates the in-memory cache, so the index never drifts from disk.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { logger } from "../logger.js";
import { fileExists } from "../fs.js";
import { getStateDir } from "../config.js";
import {
  followedThreadKey,
  type InvestigationsState,
  type InvestigationSummary,
  type OpenInvestigationEntry,
} from "./types.js";

export interface InvestigationsStateDeps {
  readFile(path: string, encoding: "utf-8"): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  mkdir(path: string, opts: { recursive: boolean }): Promise<string | undefined>;
  fileExists(path: string): Promise<boolean>;
}

const defaultDeps: InvestigationsStateDeps = { readFile, writeFile, mkdir, fileExists };

let deps: InvestigationsStateDeps = defaultDeps;

export function setInvestigationsStateDeps(d: InvestigationsStateDeps): void {
  deps = d;
}

export function resetInvestigationsStateDeps(): void {
  deps = defaultDeps;
}

const openEntryZod: z.ZodType<OpenInvestigationEntry> = z.object({
  sessionId: z.string(),
  mainChannel: z.string(),
  mainThreadTs: z.string(),
  surface: z.enum(["channel", "dm"]),
  startedBy: z.string(),
  subject: z.string().optional(),
});

const stateZod: z.ZodType<InvestigationsState> = z.object({
  channel: z.string().nullable(),
  open: z.record(z.string(), openEntryZod),
});

function emptyState(): InvestigationsState {
  return { channel: null, open: {} };
}

/** In-memory cache — starts empty so sync getters are safe before the boot load runs. */
let cache: InvestigationsState = emptyState();

function getStatePath(): string {
  return resolve(getStateDir(), "investigations.json");
}

/** Serialize read-modify-write cycles so concurrent mutations can't clobber the file. */
let writeChain: Promise<void> = Promise.resolve();

function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Load the state file from disk into the in-memory cache. Call once at boot before any Slack
 * handler is registered so event routing sees a populated index. Graceful: a missing or
 * malformed file leaves the default in memory and does not touch the disk.
 */
export async function loadInvestigationsState(): Promise<InvestigationsState> {
  const path = getStatePath();
  if (!(await deps.fileExists(path))) {
    cache = emptyState();
    return cache;
  }
  try {
    const content = await deps.readFile(path, "utf-8");
    const parsed = stateZod.safeParse(JSON.parse(content));
    if (parsed.success) {
      cache = parsed.data;
      return cache;
    }
    logger.warn(
      `investigations.json failed to parse (${parsed.error.issues[0]?.message ?? "shape mismatch"}); serving defaults without overwriting the file`,
    );
  } catch (error) {
    logger.warn(`investigations.json unreadable (${String(error)}); serving defaults`);
  }
  cache = emptyState();
  return cache;
}

async function persist(next: InvestigationsState): Promise<void> {
  const stateDir = getStateDir();
  if (!(await deps.fileExists(stateDir))) {
    await deps.mkdir(stateDir, { recursive: true });
  }
  await deps.writeFile(getStatePath(), JSON.stringify(next, null, 2));
  cache = next;
}

// ============================================================================
// Reads (sync, off the in-memory cache)
// ============================================================================

export function getInvestigationsChannel(): string | null {
  return cache.channel;
}

/** O(1) routing/dedup lookup: which open investigation follows this thread, if any. */
export function findInvestigationByFollowedThread(
  channel: string,
  threadTs: string,
): OpenInvestigationEntry | undefined {
  return cache.open[followedThreadKey(channel, threadTs)];
}

/** One row per open investigation, deduped across its followed-thread keys. */
export function listOpenInvestigations(): InvestigationSummary[] {
  const bySession = new Map<string, InvestigationSummary>();
  for (const entry of Object.values(cache.open)) {
    const existing = bySession.get(entry.sessionId);
    if (existing) {
      existing.followedCount += 1;
    } else {
      bySession.set(entry.sessionId, {
        sessionId: entry.sessionId,
        mainChannel: entry.mainChannel,
        mainThreadTs: entry.mainThreadTs,
        surface: entry.surface,
        startedBy: entry.startedBy,
        ...(entry.subject ? { subject: entry.subject } : {}),
        followedCount: 1,
      });
    }
  }
  return [...bySession.values()];
}

// ============================================================================
// Writes (serialized, persist-then-cache)
// ============================================================================

export function setInvestigationsChannel(channel: string | null): Promise<void> {
  return withWriteLock(async () => {
    await persist({ ...cache, channel });
  });
}

export interface OpenInvestigationParams {
  sessionId: string;
  mainChannel: string;
  mainThreadTs: string;
  surface: OpenInvestigationEntry["surface"];
  startedBy: string;
  subject?: string;
  /** Threads this investigation follows at creation (at least the origin thread). */
  followed: Array<{ channel: string; threadTs: string }>;
}

/** Register a new investigation, indexing every followed thread it starts with. */
export function openInvestigation(params: OpenInvestigationParams): Promise<void> {
  return withWriteLock(async () => {
    const entry: OpenInvestigationEntry = {
      sessionId: params.sessionId,
      mainChannel: params.mainChannel,
      mainThreadTs: params.mainThreadTs,
      surface: params.surface,
      startedBy: params.startedBy,
      ...(params.subject ? { subject: params.subject } : {}),
    };
    const open = { ...cache.open };
    for (const { channel, threadTs } of params.followed) {
      open[followedThreadKey(channel, threadTs)] = entry;
    }
    await persist({ ...cache, open });
  });
}

/**
 * Add one followed thread to an existing investigation's index, cloning the routing
 * projection from any entry already registered for the session. No-op if the session has no
 * open investigation.
 */
export function addFollowedThread(
  sessionId: string,
  channel: string,
  threadTs: string,
): Promise<void> {
  return withWriteLock(async () => {
    const template = Object.values(cache.open).find((e) => e.sessionId === sessionId);
    if (!template) {
      logger.warn(`addFollowedThread: no open investigation for session ${sessionId}`);
      return;
    }
    const open = { ...cache.open, [followedThreadKey(channel, threadTs)]: template };
    await persist({ ...cache, open });
  });
}

/** Remove a single followed thread from the routing index. */
export function removeFollowedThread(channel: string, threadTs: string): Promise<void> {
  return withWriteLock(async () => {
    const key = followedThreadKey(channel, threadTs);
    if (!(key in cache.open)) return;
    const { [key]: _omit, ...open } = cache.open;
    await persist({ ...cache, open });
  });
}

/** Close an investigation: drop every followed-thread key pointing at its session. */
export function closeInvestigation(sessionId: string): Promise<void> {
  return withWriteLock(async () => {
    const open: Record<string, OpenInvestigationEntry> = {};
    for (const [key, entry] of Object.entries(cache.open)) {
      if (entry.sessionId !== sessionId) open[key] = entry;
    }
    await persist({ ...cache, open });
  });
}

/** Test-only: reset the in-memory cache to empty. */
export function resetInvestigationsCache(): void {
  cache = emptyState();
}
