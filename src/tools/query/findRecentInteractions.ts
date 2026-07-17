import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { getSessionsDir } from "../../config.js";
import { fileExists } from "../../fs.js";
import { getChannelInfo } from "../../slack/channelCache.js";
import { extractDisplayText } from "../../slack/blockText.js";
import type { SessionMessage, SessionTrigger } from "../../sessions.js";
import { synthesizeMessagesFromLegacy } from "../../sessions.js";
import { addUsage, ZERO_USAGE, type SessionUsage } from "../../claude/usage.js";
import type { TriggerType } from "../../changes/types.js";

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
  triggerType?: TriggerType;
  userId: string;
  displayName?: string;
  createdAt: number;
  lastActivity?: number;
  /** DM-first delivered sessions carry the channel where the reaction originated. */
  originChannel?: string;
  /** Post-split sessions carry a structured trigger; pre-split sessions rely on
   *  legacy fields (originalQuestion + triggerType) that the synthesizer converts. */
  trigger?: SessionTrigger;
  messageTs?: string;
  /** Unified conversation log. */
  messages?: SessionMessage[];
  /** Legacy fields — still on-disk for pre-migration sessions. */
  originalQuestion?: string;
  refinements?: string[];
  lastAnswer?: string;
  /** Cumulative token + cost usage, absent on sessions persisted before usage tracking. */
  usage?: SessionUsage;
}

export interface InteractionResult {
  sessionId: string;
  channelId: string;
  channelName?: string;
  triggerType?: string;
  userId: string;
  displayName?: string;
  createdAt: number;
  lastActivity?: number;
  firstQuestion: string;
  latestAssistantText?: string;
  messageCount: number;
  assistantTurnCount: number;
  skippedTurnCount: number;
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

/** Return the raw trigger text for scanning (messageText for user-first, prompt for scheduled). */
function triggerTextOf(session: PersistedSession): string {
  if (session.trigger) {
    return session.trigger.type === "scheduled"
      ? session.trigger.prompt
      : session.trigger.messageText;
  }
  return session.originalQuestion ?? "";
}

function matchesKeywords(session: PersistedSession, keywords: string): boolean {
  const needle = keywords.toLowerCase();
  // Trigger text is the first thing to scan — post-split, it holds the user's first message.
  if (triggerTextOf(session).toLowerCase().includes(needle)) return true;
  if (session.messages && session.messages.length > 0) {
    for (const m of session.messages) {
      if (m.role === "user" && m.text.toLowerCase().includes(needle)) return true;
      if (m.role === "assistant") {
        if (m.text && m.text.toLowerCase().includes(needle)) return true;
        if (m.payload?.message && m.payload.message.toLowerCase().includes(needle)) return true;
        if (m.payload?.blocks) {
          const rendered = extractDisplayText(m.payload.blocks).toLowerCase();
          if (rendered.includes(needle)) return true;
        }
      }
    }
    return false;
  }
  // Legacy fallback for pre-migration files on disk.
  if (session.refinements?.some((r) => r.toLowerCase().includes(needle))) return true;
  if (session.lastAnswer?.toLowerCase().includes(needle)) return true;
  return false;
}

/** Summarize a session's unified log into count + latest-assistant-text.
 *  Falls back to legacy fields when `messages` is absent. */
function summarize(session: PersistedSession): {
  firstQuestion: string;
  latestAssistantText?: string;
  messageCount: number;
  assistantTurnCount: number;
  skippedTurnCount: number;
} {
  const firstQuestion = triggerTextOf(session);
  if (session.messages && session.messages.length > 0) {
    const messages = session.messages;
    let latest: string | undefined;
    let assistantTurnCount = 0;
    let skippedTurnCount = 0;
    for (const m of messages) {
      if (m.role === "assistant") {
        assistantTurnCount += 1;
        if (m.skipped) skippedTurnCount += 1;
        if (m.text) latest = m.text;
        else if (m.payload?.message) latest = m.payload.message;
      }
    }
    return {
      firstQuestion,
      latestAssistantText: latest,
      messageCount: messages.length,
      assistantTurnCount,
      skippedTurnCount,
    };
  }
  // Legacy fallback — derived counts from the old shape.
  const messageCount = 1 + (session.refinements?.length ?? 0) + (session.lastAnswer ? 1 : 0);
  return {
    firstQuestion,
    latestAssistantText: session.lastAnswer,
    messageCount,
    assistantTurnCount: session.lastAnswer ? 1 : 0,
    skippedTurnCount: 0,
  };
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
    const parsed: PersistedSession = JSON.parse(content);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !parsed.sessionId ||
      !parsed.channelId ||
      !parsed.userId ||
      !parsed.createdAt
    ) {
      return null;
    }
    // Post-split sessions carry a structured trigger; pre-split sessions synthesize one
    // on read so every downstream consumer sees a uniform shape.
    if (!parsed.trigger) {
      const synth = synthesizeMessagesFromLegacy({
        triggerType: parsed.triggerType,
        userId: parsed.userId,
        messageTs: parsed.messageTs,
        createdAt: parsed.createdAt,
        lastActivity: parsed.lastActivity ?? parsed.createdAt,
        originalQuestion: parsed.originalQuestion,
        refinements: parsed.refinements,
        lastAnswer: parsed.lastAnswer,
        messages: parsed.messages,
      });
      parsed.trigger = synth.trigger;
      if (!parsed.messages || parsed.messages.length === 0) {
        parsed.messages = synth.messages;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export const INCLUDE_SECTION_ENUM = z.enum(["entries", "usage"]);
export type IncludeSection = z.infer<typeof INCLUDE_SECTION_ENUM>;

export interface SearchArgs {
  keywords?: string;
  type?: "all" | "dm" | "public_channels";
  includeAutoRespond?: boolean;
  limit?: number;
  offset?: number;
  /** Filter by specific channel ID. Matches either `channelId` or `originChannel`
   *  (DM-first sessions record the channel where the reaction originated). */
  channel?: string;
  /** Filter by trigger type (reactions, directMessages, mentions, autoRespond, etc.). */
  triggerType?: string;
  /** Filter to sessions created by a plugin's own scheduled jobs — matches the
   *  `plugin:<name>` system actor persisted as the session's userId. Catches both
   *  channel'd and channelless fires, unlike a channel filter. */
  plugin?: string;
  /** Epoch-ms lower bound on `createdAt`. Only sessions created at or after this are returned. */
  since?: number;
  /** Relative lower bound: sessions created within the last N hours. The cutoff is computed
   *  server-side from the current clock, so callers never do epoch arithmetic. Ignored when
   *  `since` is also provided. */
  sinceHours?: number;
  /** Which sections to compute and return. Empty/absent is treated as `["entries"]`. */
  include?: IncludeSection[];
}

/** A search result, projected to the requested `include` sections.
 *  `entries` is the paginated per-session summaries; `totalUsage` is the usage aggregate over the
 *  FULL matched set (pre-pagination). Each key is present only when its section was requested. */
export interface SearchResult {
  entries?: InteractionResult[];
  totalUsage?: SessionUsage;
}

/** An empty or absent `include` is treated as `["entries"]`. */
function resolveSections(include: IncludeSection[] | undefined): {
  wantEntries: boolean;
  wantUsage: boolean;
} {
  const sections: IncludeSection[] = include && include.length > 0 ? include : ["entries"];
  return { wantEntries: sections.includes("entries"), wantUsage: sections.includes("usage") };
}

export async function searchRecentInteractions(
  ctx: QueryToolContext,
  args: SearchArgs,
  deps: FindRecentInteractionsDeps,
): Promise<SearchResult> {
  const sessionsDir = deps.getSessionsDir();
  const { wantEntries, wantUsage } = resolveSections(args.include);

  if (!(await deps.fileExists(sessionsDir))) {
    return {
      ...(wantEntries ? { entries: [] } : {}),
      ...(wantUsage ? { totalUsage: { ...ZERO_USAGE } } : {}),
    };
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

  if (args.channel) {
    const channel = args.channel;
    filtered = filtered.filter((s) => s.channelId === channel || s.originChannel === channel);
  }

  if (args.triggerType) {
    const triggerType = args.triggerType;
    filtered = filtered.filter((s) => s.triggerType === triggerType);
  }

  if (args.plugin) {
    const actor = `plugin:${args.plugin}`;
    filtered = filtered.filter((s) => s.userId === actor);
  }

  if (args.keywords) {
    filtered = filtered.filter((s) => matchesKeywords(s, args.keywords!));
  }

  const since =
    args.since ??
    (args.sinceHours !== undefined ? Date.now() - args.sinceHours * 60 * 60 * 1000 : undefined);
  if (since !== undefined) {
    filtered = filtered.filter((s) => s.createdAt >= since);
  }

  const result: SearchResult = {};

  if (wantUsage) {
    // Aggregate over the FULL matched set, before pagination, so a window-scoped query reports
    // the window's true total regardless of limit/offset.
    result.totalUsage = filtered.reduce<SessionUsage>((acc, s) => addUsage(acc, s.usage), {
      ...ZERO_USAGE,
    });
  }

  // Skip building entry summaries entirely when only usage was requested — a usage-only query
  // stays bounded no matter how large the matched sessions' prompts are.
  if (wantEntries) {
    const paginated = filtered.slice(args.offset ?? 0, (args.offset ?? 0) + (args.limit ?? 10));
    result.entries = paginated.map((s) => {
      const summary = summarize(s);
      return {
        sessionId: s.sessionId,
        channelId: s.channelId,
        channelName: s.channelName,
        triggerType: s.triggerType,
        userId: s.userId,
        displayName: s.displayName,
        createdAt: s.createdAt,
        lastActivity: s.lastActivity,
        firstQuestion: summary.firstQuestion,
        latestAssistantText: summary.latestAssistantText,
        messageCount: summary.messageCount,
        assistantTurnCount: summary.assistantTurnCount,
        skippedTurnCount: summary.skippedTurnCount,
      };
    });
  }

  return result;
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
    "Search Clack's recent interaction history. Use this when the user references something you may have previously said or sent, or when you're unsure what context they're referring to. Searches across the question, user follow-ups, and Clack's responses. Returns an object projected to the requested `include` sections (`{ entries }` by default).",
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
      channel: z
        .string()
        .optional()
        .describe(
          "Filter by a specific Slack channel ID. Matches both the session's primary channel and, for DM-first-delivered sessions, the channel where the triggering reaction originated. Standard privacy rules still apply.",
        ),
      trigger_type: z
        .enum([
          "reactions",
          "directMessages",
          "mentions",
          "autoRespond",
          "threadReply",
          "scheduled",
        ])
        .optional()
        .describe(
          'Filter by how the session was triggered. Valid values: "reactions", "directMessages", "mentions", "autoRespond", "threadReply", "scheduled".',
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
      since: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Epoch-millisecond lower bound on session creation time. Only sessions created at or after this are returned. Prefer `since_hours` unless you have an exact epoch timestamp from another tool result — never compute epoch values yourself.",
        ),
      plugin: z
        .string()
        .optional()
        .describe(
          'Filter to sessions created by a plugin\'s own scheduled jobs (system actor "plugin:<name>"). Example: "idler". Matches both channel-bound and channelless fires — prefer this over `channel` when tallying a plugin\'s own activity or spend.',
        ),
      since_hours: z
        .number()
        .positive()
        .optional()
        .describe(
          'Relative lower bound: only sessions created within the last N hours. The cutoff is computed server-side from the current clock — use this instead of `since` for windows like "the last 24 hours". Ignored when `since` is also provided.',
        ),
      include: z
        .array(INCLUDE_SECTION_ENUM)
        .optional()
        .default(["entries"])
        .describe(
          'Which sections to return, as a projected object. "entries" (default) → the paginated per-session summaries; "usage" → a `totalUsage` object summing token + cost usage across ALL matched sessions (the full set, independent of limit/offset). Request `["usage"]` alone to tally spend over a window without pulling back entries — a bounded result that will not hit the tool-result size cap. An empty array is treated as `["entries"]`.',
        ),
    },
    async ({ include_auto_respond, trigger_type, since_hours, include, ...rest }) => {
      const result = await searchRecentInteractions(
        ctx,
        {
          ...rest,
          includeAutoRespond: include_auto_respond,
          triggerType: trigger_type,
          sinceHours: since_hours,
          include,
        },
        deps,
      );
      return textResult(result);
    },
  );
}
