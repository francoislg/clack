import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext, SubmitResponsePayload, ToolCallRecord } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getSessionsDir } from "../../config.js";
import { fileExists } from "../../fs.js";
import { getChannelInfo } from "../../slack/channelCache.js";
import type { SessionMessage, SessionTrigger } from "../../sessions.js";
import { synthesizeMessagesFromLegacy } from "../../sessions.js";
import type { SlackImageFile } from "../../slack/slackFileBase.js";
import type { TriggerType } from "../../changes/types.js";

export interface FindSessionTranscriptDeps {
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  fileExists: typeof fileExists;
  getSessionsDir: typeof getSessionsDir;
  /** Resolve channel privacy. Returns true/false if known, undefined when it can't be determined.
   *  Unknown is treated as private by the visibility filter to avoid leaking data. */
  getChannelPrivacy: (channelId: string) => Promise<boolean | undefined>;
}

export const defaultDeps: FindSessionTranscriptDeps = {
  readFile,
  fileExists,
  getSessionsDir,
  getChannelPrivacy: async () => undefined,
};

interface PersistedSession {
  sessionId: string;
  channelId: string;
  channelName?: string;
  triggerType?: TriggerType;
  userId: string;
  messageTs?: string;
  displayName?: string;
  createdAt: number;
  lastActivity?: number;
  /** Post-split shape: structured trigger metadata. */
  trigger?: SessionTrigger;
  /** Unified conversation log. Present on migrated sessions. */
  messages?: SessionMessage[];
  /** Legacy fields — still on-disk for pre-split sessions. */
  originalQuestion?: string;
  refinements?: string[];
  lastAnswer?: string;
  lastResponse?: SubmitResponsePayload;
  toolCallHistory?: ToolCallRecord[];
  imageFiles?: SlackImageFile[];
}

export interface TranscriptResult {
  sessionId: string;
  channelId: string;
  channelName?: string;
  triggerType?: TriggerType;
  userId: string;
  displayName?: string;
  createdAt: number;
  lastActivity: number;
  trigger: SessionTrigger;
  totalMessages: number;
  messages: SessionMessage[];
}

async function loadSession(
  sessionId: string,
  sessionsDir: string,
  deps: FindSessionTranscriptDeps,
): Promise<PersistedSession | null> {
  const contextPath = resolve(sessionsDir, sessionId, "context.json");
  if (!(await deps.fileExists(contextPath))) return null;

  try {
    const content = await deps.readFile(contextPath, "utf-8");
    const parsed = JSON.parse(content);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.channelId !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.createdAt !== "number"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Resolve a session's `{ trigger, messages[] }`, synthesizing from legacy fields when the
 *  on-disk file predates the trigger split. Post-split sessions return trigger + messages
 *  untouched. Pre-split sessions (either pure legacy or first-wave unified-log) synthesize. */
function resolveTriggerAndMessages(session: PersistedSession): {
  trigger: SessionTrigger;
  messages: SessionMessage[];
} {
  if (session.trigger) {
    return { trigger: session.trigger, messages: session.messages ?? [] };
  }
  return synthesizeMessagesFromLegacy({
    originalQuestion: session.originalQuestion,
    refinements: session.refinements,
    lastAnswer: session.lastAnswer,
    lastResponse: session.lastResponse,
    toolCallHistory: session.toolCallHistory,
    imageFiles: session.imageFiles,
    messages: session.messages,
    triggerType: session.triggerType,
    userId: session.userId,
    messageTs: session.messageTs,
    createdAt: session.createdAt,
    lastActivity: session.lastActivity ?? session.createdAt,
  });
}

/** True when the channel is definitively known to be a non-private public channel.
 *  Mirrors `findRecentInteractions.isKnownPublic` — C channels can be public OR private
 *  in modern Slack, so prefix alone is unsafe. */
function isKnownPublic(channelId: string, privacyMap: Map<string, boolean | undefined>): boolean {
  if (!channelId.startsWith("C")) return false;
  return privacyMap.get(channelId) === false;
}

export interface FetchArgs {
  sessionId: string;
  offset: number;
  limit: number;
}

export async function fetchSessionTranscript(
  ctx: QueryToolContext,
  args: FetchArgs,
  deps: FindSessionTranscriptDeps,
): Promise<TranscriptResult | { error: string }> {
  const sessionsDir = deps.getSessionsDir();

  const session = await loadSession(args.sessionId, sessionsDir, deps);
  if (!session) {
    return { error: `Session not found: ${args.sessionId}` };
  }

  // Privacy gate — owner always; non-owner requires a known-public channel.
  const callerUserId = ctx.userId;
  if (session.userId !== callerUserId) {
    const privacyMap = new Map<string, boolean | undefined>();
    if (session.channelId.startsWith("C")) {
      privacyMap.set(session.channelId, await deps.getChannelPrivacy(session.channelId));
    }
    if (!isKnownPublic(session.channelId, privacyMap)) {
      return { error: "session not visible" };
    }
  }

  const { trigger, messages } = resolveTriggerAndMessages(session);
  const totalMessages = messages.length;
  const paginated = messages.slice(args.offset, args.offset + args.limit);

  return {
    sessionId: session.sessionId,
    channelId: session.channelId,
    channelName: session.channelName,
    triggerType: session.triggerType ?? trigger.type,
    userId: session.userId,
    displayName: session.displayName,
    trigger,
    createdAt: session.createdAt,
    lastActivity: session.lastActivity ?? session.createdAt,
    totalMessages,
    messages: paginated,
  };
}

export function createFindSessionTranscriptTool(
  ctx: QueryToolContext,
  depsOverride?: FindSessionTranscriptDeps,
) {
  const slackClient = ctx.slackClient;
  const deps: FindSessionTranscriptDeps =
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
    "find_session_transcript",
    "Fetch the paginated full transcript of a Clack session by sessionId. Returns every user and assistant turn with payload, tool calls, skip/disengage flags, and errors. Use this after `find_recent_interactions` surfaces a relevant session and you need the full conversation detail.",
    {
      sessionId: z
        .string()
        .min(1)
        .describe(
          "The session ID (directory name under data/sessions) to fetch the transcript for.",
        ),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .default(0)
        .describe("Number of messages to skip from the start of the transcript. Defaults to 0."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .optional()
        .default(20)
        .describe("Maximum number of messages to return. Defaults to 20, capped at 100."),
    },
    async ({ sessionId, offset, limit }) => {
      const result = await fetchSessionTranscript(ctx, { sessionId, offset, limit }, deps);
      if ("error" in result) {
        return errorResult(result.error);
      }
      return textResult(result);
    },
  );
}
