import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import type { App } from "@slack/bolt";
import { getSessionsDir } from "../../config.js";
import { fileExists } from "../../fs.js";
import { parseSessionId } from "../../sessions.js";
import { getChannelInfo } from "../../slack/channelCache.js";
import { getUserInfo } from "../../slack/userCache.js";

/**
 * Who and where a failed session came from, resolved to the identifiers a report needs to
 * render each as a Slack link: `<#channelId>` for the channel, a profile link built from
 * `userId` for the person, and `messageLink` for the post itself.
 *
 * Every field is optional. A session directory may have been pruned (error reports outlive
 * sessions), a channelless cron fire has no channel or human author, and a scheduled trigger
 * has no message to link to.
 */
export interface ErrorReportAttribution {
  channelId?: string;
  channelName?: string;
  userId?: string;
  displayName?: string;
  triggerType?: string;
  /** Permalink to the message that triggered the failed session. */
  messageLink?: string;
}

/** Graceful reader over a persisted session's `context.json` — an unexpected shape degrades to
 *  no attribution rather than failing the tool call. */
const sessionAttributionZod = z.object({
  channelId: z.string().optional(),
  channelName: z.string().optional(),
  userId: z.string().optional(),
  displayName: z.string().optional(),
  triggerType: z.string().optional(),
  messageTs: z.string().optional(),
  trigger: z
    .object({
      type: z.string().optional(),
      messageTs: z.string().optional(),
    })
    .optional(),
});

type SessionAttribution = z.infer<typeof sessionAttributionZod>;

export interface ErrorReportAttributionDeps {
  fileExists: typeof fileExists;
  readFile: (path: string, encoding: BufferEncoding) => Promise<string>;
  getSessionsDir: typeof getSessionsDir;
  getChannelName: (channelId: string) => Promise<string | undefined>;
  getDisplayName: (userId: string) => Promise<string | undefined>;
  getPermalink: (channelId: string, messageTs: string) => Promise<string | undefined>;
}

/** Without a Slack client nothing can be resolved live — the session file is the only source. */
export const offlineDeps: ErrorReportAttributionDeps = {
  fileExists,
  readFile,
  getSessionsDir,
  getChannelName: async () => undefined,
  getDisplayName: async () => undefined,
  getPermalink: async () => undefined,
};

export function buildAttributionDeps(
  slackClient: App["client"] | undefined,
): ErrorReportAttributionDeps {
  if (!slackClient) return offlineDeps;
  return {
    ...offlineDeps,
    getChannelName: async (channelId) => (await getChannelInfo(slackClient, channelId))?.name,
    getDisplayName: async (userId) => (await getUserInfo(slackClient, userId))?.displayName,
    getPermalink: async (channelId, messageTs) => {
      try {
        const res = await slackClient.chat.getPermalink({
          channel: channelId,
          message_ts: messageTs,
        });
        return res.permalink;
      } catch {
        return undefined;
      }
    },
  };
}

async function readSessionAttribution(
  sessionId: string,
  deps: ErrorReportAttributionDeps,
): Promise<SessionAttribution | null> {
  const contextPath = resolve(deps.getSessionsDir(), sessionId, "context.json");
  if (!(await deps.fileExists(contextPath))) return null;
  try {
    const parsed = sessionAttributionZod.safeParse(
      JSON.parse(await deps.readFile(contextPath, "utf-8")),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the channel, author, and triggering message behind a failed session.
 *
 * The session's own `context.json` is authoritative; when it has been pruned the sessionId
 * itself still encodes the channel, message ts, and user, so attribution survives.
 */
export async function resolveErrorReportAttribution(
  sessionId: string,
  deps: ErrorReportAttributionDeps,
): Promise<ErrorReportAttribution> {
  const session = await readSessionAttribution(sessionId, deps);
  const fromId = parseSessionId(sessionId);

  const channelId = session?.channelId ?? fromId?.channelId;
  const userId = session?.userId ?? fromId?.userId;
  const triggerType = session?.trigger?.type ?? session?.triggerType;
  // A scheduled fire has no triggering message, yet its sessionId still carries the synthetic
  // ts the id was minted from — linking to that would point at nothing.
  const messageTs =
    session?.trigger?.messageTs ??
    session?.messageTs ??
    (triggerType === "scheduled" ? undefined : fromId?.messageTs);

  const [channelName, displayName, messageLink] = await Promise.all([
    session?.channelName ?? (channelId ? deps.getChannelName(channelId) : undefined),
    session?.displayName ?? (userId ? deps.getDisplayName(userId) : undefined),
    channelId && messageTs ? deps.getPermalink(channelId, messageTs) : undefined,
  ]);

  return {
    ...(channelId ? { channelId } : {}),
    ...(channelName ? { channelName } : {}),
    ...(userId ? { userId } : {}),
    ...(displayName ? { displayName } : {}),
    ...(triggerType ? { triggerType } : {}),
    ...(messageLink ? { messageLink } : {}),
  };
}
