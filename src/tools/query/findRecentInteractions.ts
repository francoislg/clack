import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { getSessionsDir } from "../../config.js";
import { fileExists } from "../../fs.js";
import { getChannelInfo } from "../../slack/channelCache.js";

/** Cap on how many session directories are loaded per query.
 *  Sessions older than MAX_AGE_DAYS (30) are already pruned by cleanup, but this
 *  protects against the tool slowing down if a sudden burst of sessions accumulates. */
const SCAN_LIMIT = 500;

export interface FindRecentInteractionsDeps {
  readdir: (path: string) => Promise<string[]>;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  fileExists: typeof fileExists;
  getSessionsDir: typeof getSessionsDir;
  statMtimeMs: (path: string) => Promise<number>;
  /** Resolve channel privacy. Returns true/false if known, undefined when it can't be determined.
   *  Unknown is treated as private by the visibility filter to avoid leaking data. */
  getChannelPrivacy: (channelId: string) => Promise<boolean | undefined>;
}

export const defaultDeps: FindRecentInteractionsDeps = {
  readdir: (path) => readdir(path),
  readFile,
  fileExists,
  getSessionsDir,
  statMtimeMs: async (path) => (await stat(path)).mtimeMs,
  // Default has no Slack client — strict fallback (all cross-user channels treated as private).
  getChannelPrivacy: async () => undefined,
};

interface PersistedSession {
  sessionId: string;
  channelId: string;
  channelName?: string;
  triggerType?: string;
  userId: string;
  displayName?: string;
  createdAt: number;
  originalQuestion: string;
  refinements?: string[];
  lastAnswer?: string;
}

export interface InteractionResult {
  sessionId: string;
  channelName?: string;
  triggerType?: string;
  userId: string;
  displayName?: string;
  createdAt: number;
  question: string;
  refinements: string[];
  answer: string;
}

/** True when the channel is definitively known to be a non-private public channel.
 *  C-prefixed IDs can be EITHER public or private in modern Slack — prefix alone is unsafe.
 *  G = legacy private group, D = DM, U = user. Only C channels can possibly be public.
 *  privacyMap carries the authoritative answer from conversations.info. */
function isKnownPublic(channelId: string, privacyMap: Map<string, boolean | undefined>): boolean {
  if (!channelId.startsWith("C")) return false;
  return privacyMap.get(channelId) === false;
}

function isVisible(
  session: PersistedSession,
  callerUserId: string,
  privacyMap: Map<string, boolean | undefined>,
): boolean {
  if (session.userId === callerUserId) return true;
  return isKnownPublic(session.channelId, privacyMap);
}

function matchesType(
  session: PersistedSession,
  type: "all" | "dm" | "public_channels",
  callerUserId: string,
  privacyMap: Map<string, boolean | undefined>,
): boolean {
  if (type === "all") return true;
  if (type === "public_channels") return isKnownPublic(session.channelId, privacyMap);
  // "dm": DM channels owned by the caller
  return session.channelId.startsWith("D") && session.userId === callerUserId;
}

function matchesKeywords(session: PersistedSession, keywords: string): boolean {
  const needle = keywords.toLowerCase();
  if (session.originalQuestion.toLowerCase().includes(needle)) return true;
  if (session.refinements?.some((r) => r.toLowerCase().includes(needle))) return true;
  if (session.lastAnswer?.toLowerCase().includes(needle)) return true;
  return false;
}

async function loadSession(
  sessionId: string,
  sessionsDir: string,
  deps: FindRecentInteractionsDeps,
): Promise<PersistedSession | null> {
  const contextPath = resolve(sessionsDir, sessionId, "context.json");
  if (!(await deps.fileExists(contextPath))) return null;

  try {
    const content = await deps.readFile(contextPath, "utf-8");
    const parsed = JSON.parse(content) as PersistedSession;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !parsed.sessionId ||
      !parsed.originalQuestion ||
      !parsed.channelId ||
      !parsed.userId ||
      !parsed.createdAt
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export interface SearchArgs {
  keywords?: string;
  type?: "all" | "dm" | "public_channels";
  includeAutoRespond?: boolean;
  limit?: number;
  offset?: number;
}

export async function searchRecentInteractions(
  ctx: QueryToolContext,
  args: SearchArgs,
  deps: FindRecentInteractionsDeps,
): Promise<InteractionResult[]> {
  const sessionsDir = deps.getSessionsDir();

  if (!(await deps.fileExists(sessionsDir))) {
    return [];
  }

  const sessionIds = await deps.readdir(sessionsDir);

  // Cap scan to the most-recently-modified SCAN_LIMIT directories to avoid reading
  // every persisted session on every query.
  const withMtime = await Promise.all(
    sessionIds.map(async (id) => {
      const mtimeMs = await deps.statMtimeMs(resolve(sessionsDir, String(id))).catch(() => 0);
      return { id: String(id), mtimeMs };
    }),
  );
  withMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const scanIds = withMtime.slice(0, SCAN_LIMIT).map((e) => e.id);

  const loaded = (
    await Promise.all(scanIds.map((id) => loadSession(id, sessionsDir, deps)))
  ).filter((s): s is PersistedSession => s !== null);

  loaded.sort((a, b) => b.createdAt - a.createdAt);

  const type = args.type ?? "all";
  const callerUserId = ctx.userId;
  const includeAutoRespond = args.includeAutoRespond ?? false;

  // Resolve privacy for C-prefixed channels not owned by the caller. Owner-owned sessions
  // are always visible regardless of privacy, so we can skip those channels.
  const channelsNeedingPrivacyCheck = new Set<string>();
  for (const s of loaded) {
    if (s.userId !== callerUserId && s.channelId.startsWith("C")) {
      channelsNeedingPrivacyCheck.add(s.channelId);
    }
  }
  const privacyMap = new Map<string, boolean | undefined>();
  await Promise.all(
    [...channelsNeedingPrivacyCheck].map(async (channelId) => {
      privacyMap.set(channelId, await deps.getChannelPrivacy(channelId));
    }),
  );

  let filtered = loaded.filter(
    (s) =>
      isVisible(s, callerUserId, privacyMap) &&
      matchesType(s, type, callerUserId, privacyMap) &&
      (includeAutoRespond || s.triggerType !== "autoRespond"),
  );

  if (args.keywords) {
    filtered = filtered.filter((s) => matchesKeywords(s, args.keywords!));
  }

  const paginated = filtered.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 10));

  return paginated.map((s) => ({
    sessionId: s.sessionId,
    channelName: s.channelName,
    triggerType: s.triggerType,
    userId: s.userId,
    displayName: s.displayName,
    createdAt: s.createdAt,
    question: s.originalQuestion,
    refinements: s.refinements ?? [],
    answer: s.lastAnswer ?? "",
  }));
}

export function createFindRecentInteractionsTool(
  ctx: QueryToolContext,
  depsOverride?: FindRecentInteractionsDeps,
) {
  const slackClient = ctx.slackClient;
  const deps: FindRecentInteractionsDeps =
    depsOverride ??
    (slackClient
      ? {
          ...defaultDeps,
          getChannelPrivacy: async (channelId) => {
            const info = await getChannelInfo(slackClient, channelId);
            return info?.isPrivate;
          },
        }
      : defaultDeps);

  return tool(
    "find_recent_interactions",
    "Search Clack's recent interaction history. Use this when the user references something you may have previously said or sent, or when you're unsure what context they're referring to. Searches across the question, user follow-ups, and Clack's responses.",
    {
      keywords: z
        .string()
        .optional()
        .describe(
          "Case-insensitive keyword filter. Matches against the original question, follow-up messages, and Clack's response.",
        ),
      type: z
        .enum(["all", "dm", "public_channels"])
        .optional()
        .default("all")
        .describe(
          'Filter by interaction type: "all" (default) returns public channels + your own DMs; "public_channels" returns only public channel interactions; "dm" returns only your own DM interactions.',
        ),
      include_auto_respond: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Whether to include auto-respond sessions (passive thread monitoring) in results. Defaults to false — most recall queries are about intentional Q&A sessions.",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .default(10)
        .describe("Maximum number of results to return (default: 10)."),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Number of results to skip (for paginating further back in history)."),
    },
    async ({ include_auto_respond, ...rest }) => {
      const results = await searchRecentInteractions(
        ctx,
        { ...rest, includeAutoRespond: include_auto_respond },
        deps,
      );
      return textResult(results);
    },
  );
}
