import type { App } from "@slack/bolt";
import { getConfig, type DmType } from "../../config.js";
import { logger } from "../../logger.js";
import { t } from "../../i18n/t.js";
import { extractAttachments, type ExtractedAttachments } from "../fileExtractor.js";
import { processMessage } from "./core.js";
import { matchesInlineStopEmoji } from "../stopEmoji.js";
import { stopThread, type StopResult } from "../stopPipeline.js";

export interface ClassicDmDeps {
  getConfig: () => {
    directMessages: { enabled: boolean; dmType: DmType };
    reactions?: { stop?: string | null };
  };
  stopThread: (
    channelId: string,
    threadTs: string,
    triggeredByUserId: string,
    reason: string,
  ) => Promise<StopResult>;
  processMessage: typeof processMessage;
  extractAttachments: (files: unknown[] | undefined) => ExtractedAttachments;
}

/**
 * Optional per-turn lifecycle hooks, fired only once a message has cleared every filter
 * (real user DM, has content, not a stop command) and is about to be processed. The agent
 * DM mode supplies these to drive the side-panel status + thread title via
 * `assistant.threads.*`; the classic mode supplies none. Both are best-effort — implementers
 * own their errors so a hook can never fail or delay the turn.
 */
export interface DmTurnHooks {
  onTurnStart?: (ctx: {
    client: App["client"];
    channel: string;
    threadRoot: string;
  }) => Promise<void>;
  onTurnEnd?: (ctx: {
    client: App["client"];
    channel: string;
    threadRoot: string;
    messageText: string;
    /** True on the opening turn of a thread (no inbound `thread_ts`) — used to title once. */
    isThreadStart: boolean;
    /** Claude-authored thread label from `submit_response.thread_title`, when present. */
    threadTitle?: string;
  }) => Promise<void>;
}

export const defaultClassicDmDeps: ClassicDmDeps = {
  getConfig,
  processMessage,
  extractAttachments,
  stopThread,
};

interface RawMessageEvent {
  bot_id?: unknown;
  subtype?: unknown;
  channel_type?: unknown;
  channel?: unknown;
  user?: unknown;
  ts?: unknown;
  text?: unknown;
  thread_ts?: unknown;
  files?: unknown;
  action_token?: unknown;
}

interface ClassicDmMessage {
  channel: string;
  user: string;
  ts: string;
  text?: string;
  thread_ts?: string;
  files?: object[];
  /** Slack `action_token` for bot-token search; present on message events, absent otherwise. */
  actionToken?: string;
}

function toClassicDmMessage(value: unknown): ClassicDmMessage | null {
  if (!value || typeof value !== "object") return null;
  const e = value as RawMessageEvent;
  if (e.bot_id !== undefined) return null;
  if (e.subtype !== undefined) return null;
  if (e.channel_type !== "im") return null;
  if (typeof e.channel !== "string") return null;
  if (typeof e.ts !== "string") return null;
  if (typeof e.user !== "string") return null;
  return {
    channel: e.channel,
    user: e.user,
    ts: e.ts,
    text: typeof e.text === "string" ? e.text : undefined,
    thread_ts: typeof e.thread_ts === "string" ? e.thread_ts : undefined,
    actionToken: typeof e.action_token === "string" ? e.action_token : undefined,
    files: Array.isArray(e.files) ? (e.files as object[]) : undefined,
  };
}

/**
 * Pure handler — given a raw Slack message event and a client, run the classic
 * DM filtering + routing logic. Exported so tests can drive it directly without
 * mocking Bolt's `app.event` registration.
 */
export async function handleClassicDmEvent(
  event: unknown,
  client: App["client"],
  deps: ClassicDmDeps = defaultClassicDmDeps,
  hooks?: DmTurnHooks,
): Promise<void> {
  if (!deps.getConfig().directMessages.enabled) return;

  const msg = toClassicDmMessage(event);
  if (!msg) return;

  const attachments = deps.extractAttachments(msg.files);
  const hasText = !!msg.text;
  const hasImages = !!attachments.imageFiles?.length;
  if (!hasText && !hasImages) return;

  const config = deps.getConfig();
  if (matchesInlineStopEmoji(msg.text, config.reactions?.stop)) {
    const threadTs = msg.thread_ts || msg.ts;
    logger.info(
      `Inline stop emoji in classic DM from ${msg.user} in ${msg.channel} (thread ${threadTs})`,
    );
    await deps.stopThread(msg.channel, threadTs, msg.user, "stopped via inline emoji");
    return;
  }

  const messageText = hasText ? msg.text! : t("assistant.fallback_image_only");
  const threadRoot = msg.thread_ts || msg.ts;

  await hooks?.onTurnStart?.({ client, channel: msg.channel, threadRoot });
  let result: Awaited<ReturnType<typeof deps.processMessage>> | undefined;
  try {
    result = await deps.processMessage({
      client,
      userId: msg.user,
      channelId: msg.channel,
      messageTs: msg.ts,
      messageText,
      threadTs: msg.thread_ts,
      triggerType: "directMessages",
      actionToken: msg.actionToken,
      ...attachments,
    });
  } finally {
    await hooks?.onTurnEnd?.({
      client,
      channel: msg.channel,
      threadRoot,
      messageText,
      isThreadStart: !msg.thread_ts,
      threadTitle: result?.response?.thread_title,
    });
  }
}

export function registerClassicDmHandlers(
  app: App,
  deps: ClassicDmDeps = defaultClassicDmDeps,
): void {
  app.event("message", async ({ event, client }) => {
    await handleClassicDmEvent(event, client, deps);
  });

  logger.debug("Registered classic DM handler");
}
