import type { App } from "@slack/bolt";
import { getConfig } from "../../config.js";
import { logger } from "../../logger.js";
import { t } from "../../i18n/t.js";
import { extractAttachments, type ExtractedAttachments } from "../fileExtractor.js";
import { processMessage } from "./core.js";
import { matchesInlineStopEmoji } from "../stopEmoji.js";
import { stopThread, type StopResult } from "../stopPipeline.js";

export interface ClassicDmDeps {
  getConfig: () => {
    directMessages: { enabled: boolean; dmType: "assistant" | "classic" };
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

  await deps.processMessage({
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
