import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getSessionsDir } from "../../../config.js";
import { fileExists } from "../../../fs.js";
import { logger } from "../../../logger.js";
import { createAccumulators, finalize, foldSession, normalizeSession } from "./aggregate.js";
import type { StatsBundle } from "./types.js";

/** Concurrent reads kept in flight — bounds peak memory to roughly this many session files. */
const READ_AHEAD = 8;

export interface ScanWindow {
  from: number | null;
  to: number | null;
}

export interface ConversationStatsDeps {
  readdir: (path: string) => Promise<string[]>;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  fileExists: typeof fileExists;
  getSessionsDir: typeof getSessionsDir;
  now: () => number;
}

export const defaultDeps: ConversationStatsDeps = {
  readdir: (path) => readdir(path),
  readFile,
  fileExists,
  getSessionsDir,
  now: () => Date.now(),
};

/** Creation time is the trailing numeric segment of the sessionId; null when it doesn't parse. */
function createdAtFromId(sessionId: string): number | null {
  const match = sessionId.match(/-(\d+)$/);
  return match ? Number(match[1]) : null;
}

/** Half-open [from, to): an unparseable id passes so a windowed query still reads it. */
function inWindow(sessionId: string, window: ScanWindow): boolean {
  if (window.from === null && window.to === null) return true;
  const createdAt = createdAtFromId(sessionId);
  if (createdAt === null) return true;
  if (window.from !== null && createdAt < window.from) return false;
  if (window.to !== null && createdAt >= window.to) return false;
  return true;
}

export async function computeConversationStats(
  window: ScanWindow,
  deps: ConversationStatsDeps,
): Promise<StatsBundle> {
  const acc = createAccumulators(deps.now());
  const sessionsDir = deps.getSessionsDir();

  if (!(await deps.fileExists(sessionsDir))) {
    return withRange(finalize(acc), window);
  }

  const ids = (await deps.readdir(sessionsDir)).filter((id) => inWindow(id, window));

  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= ids.length) return;
      const contextPath = resolve(sessionsDir, ids[index], "context.json");
      let raw: string;
      try {
        raw = await deps.readFile(contextPath, "utf-8");
      } catch {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        logger.warn(`conversation-stats: skipping unparseable session ${ids[index]}`);
        continue;
      }
      const session = normalizeSession(parsed as Parameters<typeof normalizeSession>[0]);
      if (session) foldSession(acc, session);
    }
  };

  const workerCount = Math.max(1, Math.min(READ_AHEAD, ids.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return withRange(finalize(acc), window);
}

function withRange(bundle: StatsBundle, window: ScanWindow): StatsBundle {
  bundle.range.from = window.from;
  bundle.range.to = window.to;
  return bundle;
}
