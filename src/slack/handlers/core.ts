import type { App } from "@slack/bolt";
import type { SessionContext, SessionMessage, SessionTrigger } from "../../sessions.js";
import {
  findSessionByThread,
  createSession,
  getSession,
  updateSession,
  updateThreadContext,
  appendUserMessage,
} from "../../sessions.js";
import { getConfig, type Config } from "../../config.js";
import { logger } from "../../logger.js";
import { activeSessions } from "../activeSessions.js";
import { fetchThreadContext } from "../messagesApi.js";
import { transformUserMentions, getUserInfo } from "../userCache.js";
import { getChannelInfo } from "../channelCache.js";
import { openDmChannel } from "../channelResolver.js";
import { resolveChannelLabel, resolveUserLabel, slackLink } from "../logContext.js";
import { getClaudeOptions } from "./changeWorkflowHelper.js";
import { getReactionDelivery } from "../../userPreferences.js";
import { getForChannelMessage as getActiveRunForChannelMessage } from "../activeRuns.js";
import { addDeliveryReactions } from "../messageReactions.js";
import { storeDmCoordinates } from "../dmResponse.js";
import { executeAndDeliver } from "./handlerResponse.js";
import type { TriggerType } from "../../changes/types.js";
import type { SlackImageFile, SlackFile } from "../slackFileBase.js";
import type { AskClaudeOptions, ClaudeResponse } from "../../claude/index.js";
import type { SessionInfo } from "../activeSessions.js";

/**
 * Default emoji applied to a user message when their follow-up is appended onto an
 * in-flight Claude run via `handle.sendUpdate`. Overridable via `config.reactions.queuedFollowup`
 * (set to `null` or empty to disable).
 */
const DEFAULT_QUEUED_FOLLOWUP_REACTION = "eyes";

function resolveQueuedFollowupReaction(config: Config): string | null {
  // `undefined` => not set in config => use default; `null`/empty => explicitly disabled.
  const configured = config.reactions?.queuedFollowup;
  if (configured === null) return null;
  if (configured === undefined) return DEFAULT_QUEUED_FOLLOWUP_REACTION;
  return configured || null;
}

export interface CoreDeps {
  findSessionByThread: (channelId: string, threadTs: string) => Promise<SessionContext | null>;
  createSession: (params: Parameters<typeof createSession>[0]) => Promise<SessionContext>;
  getSession: (sessionId: string) => Promise<SessionContext | null>;
  updateSession: (
    sessionId: string,
    updates: Partial<SessionContext>,
  ) => Promise<SessionContext | null>;
  updateThreadContext: (sessionId: string, context: unknown[]) => Promise<SessionContext | null>;
  getConfig: () => Config;
  setSessionInfo: (sessionId: string, info: SessionInfo) => void;
  fetchThreadContext: typeof fetchThreadContext;
  transformUserMentions: (client: App["client"], text: string) => Promise<string>;
  getUserInfo: typeof getUserInfo;
  getChannelInfo: typeof getChannelInfo;
  resolveChannelLabel: typeof resolveChannelLabel;
  resolveUserLabel: typeof resolveUserLabel;
  slackLink: typeof slackLink;
  getClaudeOptions: (userId: string, triggerType: TriggerType) => Promise<AskClaudeOptions>;
  getReactionDelivery: (userId: string) => Promise<string>;
  storeDmCoordinates: typeof storeDmCoordinates;
  executeAndDeliver: typeof executeAndDeliver;
  appendUserMessage: typeof appendUserMessage;
}

export const defaultCoreDeps: CoreDeps = {
  findSessionByThread,
  createSession,
  getSession,
  updateSession: updateSession as never,
  updateThreadContext: updateThreadContext as never,
  getConfig,
  setSessionInfo: (sessionId, info) => activeSessions.set(sessionId, info),
  fetchThreadContext,
  transformUserMentions,
  getUserInfo,
  getChannelInfo,
  resolveChannelLabel,
  resolveUserLabel,
  slackLink,
  getClaudeOptions,
  getReactionDelivery,
  storeDmCoordinates,
  executeAndDeliver,
  appendUserMessage,
};

export interface ProcessMessageParams {
  client: App["client"];
  userId: string;
  channelId: string;
  messageTs: string;
  messageText: string;
  threadTs?: string;
  triggerType: TriggerType;
  /** When true, hints Claude to propose a change with auto-execute */
  workMode?: boolean;
  /** Channel the user is viewing in the assistant panel */
  assistantChannelId?: string;
  /** Image files from the triggering message */
  imageFiles?: SlackImageFile[];
  /** Non-image file attachments from the triggering message */
  files?: SlackFile[];
  /** Extra context from the auto-respond rule */
  additionalSystemPrompt?: string;
  /** When true, skip streaming UX and post the final result directly */
  silentThinking?: boolean;
  /**
   * Fully-qualified MCP tool names (e.g., `mcp__trivia__submit_answers`) that must be called during
   * this run before `submit_response` will be accepted. Populated by callers like the cron scheduler.
   */
  requiredTools?: string[];
  /**
   * Free-form conditions to evaluate at the start of a scheduled run. When non-empty, the prompt
   * builder injects a pre-check section and the `submit_response` tool schema exposes
   * `skip_response` so Claude can decline delivery. Only meaningful for `triggerType: "scheduled"`.
   */
  skipConditions?: string;
  /** Pre-analysis verdict from the autoRespond gate. Forwarded onto the session trigger at
   *  creation (autoRespond only) AND onto each assistant message appended during this run. */
  preAnalysis?: string;
  /** Cron job ID for scheduled triggers — recorded on the session's trigger. */
  jobId?: string;
  /** Emoji name (no colons) for reactions triggers — recorded on the trigger. */
  reactionEmoji?: string;
  /** autoRespond rule name — propagated onto the trigger when a rule matched. */
  autoRespondRuleName?: string;
}

interface ProcessingContext {
  readonly client: App["client"];
  readonly config: Config;
  readonly userId: string;
  readonly channelId: string;
  readonly messageTs: string;
  readonly messageText: string;
  readonly threadTs?: string;
  readonly effectiveThreadTs: string;
  readonly triggerType: TriggerType;
  /** When true, hints Claude to propose a change with auto-execute */
  readonly workMode: boolean;
  readonly additionalSystemPrompt?: string;
  readonly requiredTools?: string[];
  readonly skipConditions?: string;
  /** Image files from the triggering Slack message (stored on the trigger). */
  readonly imageFiles?: SlackImageFile[];
  /** Pre-analysis verdict from the autoRespond gate. Stamped onto the session's trigger
   *  at creation (autoRespond only) AND onto each assistant message appended during this run. */
  readonly preAnalysis?: string;
  /** Cron job ID for scheduled triggers — carried onto the trigger for provenance. */
  readonly jobId?: string;
  /** Reactions trigger — the emoji that was reacted with. */
  readonly reactionEmoji?: string;
  /** autoRespond rule name — propagated onto the trigger when a rule matched. */
  readonly autoRespondRuleName?: string;
}

/** Construct a `SessionTrigger` from the inputs we have at handler time. The switch on
 *  `triggerType` picks the right discriminated-union variant and omits fields that don't
 *  apply to that variant. */
function buildTriggerFromParams(params: {
  triggerType: TriggerType;
  userId: string;
  messageTs: string;
  messageText: string;
  imageFiles?: SlackImageFile[];
  preAnalysis?: string;
  jobId?: string;
  reactionEmoji?: string;
  autoRespondRuleName?: string;
}): SessionTrigger {
  switch (params.triggerType) {
    case "scheduled":
      return {
        type: "scheduled",
        prompt: params.messageText,
        ...(params.jobId !== undefined ? { jobId: params.jobId } : {}),
        ...(params.preAnalysis !== undefined ? { preAnalysis: params.preAnalysis } : {}),
      };
    case "reactions":
      return {
        type: "reactions",
        userId: params.userId,
        emoji: params.reactionEmoji ?? "",
        messageTs: params.messageTs,
        messageText: params.messageText,
        ...(params.imageFiles !== undefined ? { imageFiles: params.imageFiles } : {}),
      };
    case "autoRespond":
    case "threadReply":
      // A threadReply event here only happens when there was NO existing session found — in
      // practice that's almost always an autoRespond-created session in a thread. Model as
      // autoRespond for the new trigger union (threadReply is NOT a session-creating type).
      return {
        type: "autoRespond",
        userId: params.userId,
        messageTs: params.messageTs,
        messageText: params.messageText,
        ...(params.autoRespondRuleName !== undefined
          ? { ruleName: params.autoRespondRuleName }
          : {}),
        ...(params.imageFiles !== undefined ? { imageFiles: params.imageFiles } : {}),
        ...(params.preAnalysis !== undefined ? { preAnalysis: params.preAnalysis } : {}),
      };
    case "directMessages":
      return {
        type: "directMessages",
        userId: params.userId,
        messageTs: params.messageTs,
        messageText: params.messageText,
        ...(params.imageFiles !== undefined ? { imageFiles: params.imageFiles } : {}),
      };
    case "mentions":
    default:
      return {
        type: "mentions",
        userId: params.userId,
        messageTs: params.messageTs,
        messageText: params.messageText,
        ...(params.imageFiles !== undefined ? { imageFiles: params.imageFiles } : {}),
      };
  }
}

interface DmCoordinates {
  dmChannel: string;
  dmThreadTs?: string;
}

// ============================================================
// SESSION SETUP
// ============================================================

async function setupSession(ctx: ProcessingContext, deps: CoreDeps): Promise<SessionContext> {
  const { client, config, userId, channelId, messageTs, messageText, threadTs, effectiveThreadTs } =
    ctx;

  const authResult = await client.auth.test();
  const botUserId = authResult.user_id || "";

  const threadContext = threadTs
    ? await deps.fetchThreadContext(client, channelId, threadTs, botUserId, {
        fetchUserNames: config.slack.fetchAndStoreUsername,
      })
    : [];

  // Skip mention resolution for scheduled triggers — their "message text" is a prompt,
  // not a real Slack message, and may contain example mention syntax like <@U123>.
  const processedMessageText =
    config.slack.fetchAndStoreUsername && ctx.triggerType !== "scheduled"
      ? await deps.transformUserMentions(client, messageText)
      : messageText;

  let session = threadTs ? await deps.findSessionByThread(channelId, threadTs) : null;

  // Resolve user and channel info for session attribution
  const userInfo = await deps.getUserInfo(client, userId);
  const channelInfo = await deps.getChannelInfo(client, channelId);

  if (!session) {
    const trigger = buildTriggerFromParams({
      triggerType: ctx.triggerType,
      userId,
      messageTs,
      messageText: processedMessageText,
      imageFiles: ctx.imageFiles,
      preAnalysis: ctx.preAnalysis,
    });
    session = await deps.createSession({
      channelId,
      messageTs,
      threadTs: effectiveThreadTs,
      userId,
      trigger,
      threadContext,
      username: userInfo?.username,
      displayName: userInfo?.displayName,
      additionalSystemPrompt: ctx.additionalSystemPrompt,
      channelName: channelInfo?.name,
    });
    logger.debug(`Created session ${session.sessionId}`);
  } else {
    await deps.updateThreadContext(session.sessionId, threadContext);
    // Append every reuse as a user continuation. messages[0] is always an assistant turn;
    // follow-up user messages (thread replies, edits, etc.) append with source: "reply".
    // The trigger on the session is immutable after creation.
    const updatedMessages: SessionMessage[] = [
      ...session.messages,
      { role: "user", source: "reply", text: processedMessageText, ts: Date.now() },
    ];
    const updates: Partial<SessionContext> = {
      messages: updatedMessages,
      triggerType: ctx.triggerType,
    };
    if (!session.username && userInfo?.username) updates.username = userInfo.username;
    if (!session.displayName && userInfo?.displayName) updates.displayName = userInfo.displayName;
    if (!session.channelName && channelInfo?.name) updates.channelName = channelInfo.name;
    await deps.updateSession(session.sessionId, updates);
    session = (await deps.getSession(session.sessionId))!;
  }

  deps.setSessionInfo(session.sessionId, {
    channelId,
    threadTs: effectiveThreadTs,
    userId,
    triggerType: ctx.triggerType,
  });

  return session;
}

// ============================================================
// DM SETUP (reaction DM-first mode)
// ============================================================

/**
 * Set up DM delivery for reaction triggers: open DM, post parent message, store coordinates.
 * Returns DM coordinates if setup succeeded, null to fall back to thread mode.
 */
async function setupDmDelivery(
  ctx: ProcessingContext,
  session: SessionContext,
  deps: CoreDeps,
): Promise<DmCoordinates | null> {
  const dmChannel = await openDmChannel(ctx.client, ctx.userId);
  if (!dmChannel) {
    logger.warn("DM delivery failed, falling back to thread mode");
    return null;
  }

  // Get permalink for the original message
  let permalink: string | undefined;
  try {
    const result = await ctx.client.chat.getPermalink({
      channel: ctx.channelId,
      message_ts: ctx.messageTs,
    });
    permalink = result.permalink;
  } catch {
    // Non-critical — fall back to channel mention only
  }

  // Post a thread parent in the DM so subsequent replies are threaded
  const linkText = permalink
    ? `<${permalink}|this message> in <#${ctx.channelId}>`
    : `a message in <#${ctx.channelId}>`;
  const parent = await ctx.client.chat.postMessage({
    channel: dmChannel,
    text: `_Looking into ${linkText}..._`,
  });
  const dmThreadTs = parent.ts ?? undefined;

  // Store DM coordinates in the session
  await deps.storeDmCoordinates(
    session.sessionId,
    dmChannel,
    dmThreadTs || ctx.effectiveThreadTs,
    ctx.channelId,
    ctx.effectiveThreadTs,
  );

  return { dmChannel, dmThreadTs };
}

// ============================================================
// ASSISTANT CONTEXT
// ============================================================

/**
 * Store the assistant panel's current channel on the session.
 * Sets originChannelId on first use so follow-ups know where the conversation started.
 */
async function storeAssistantContext(
  session: SessionContext,
  assistantChannelId: string,
  deps: CoreDeps,
): Promise<SessionContext> {
  const currentSession = await deps.getSession(session.sessionId);
  const updates: Partial<SessionContext> = {
    assistantCurrentChannelId: assistantChannelId,
  };
  if (!currentSession?.assistantOriginChannelId) {
    updates.assistantOriginChannelId = assistantChannelId;
  }
  const updated = await deps.updateSession(session.sessionId, updates);
  return updated ?? session;
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

export async function processMessage(
  params: ProcessMessageParams,
  deps: CoreDeps = defaultCoreDeps,
): Promise<ClaudeResponse> {
  const {
    client,
    userId,
    channelId,
    messageTs,
    messageText,
    threadTs,
    triggerType,
    workMode = false,
    silentThinking = false,
  } = params;

  const config = deps.getConfig();

  // Resolve DM delivery for reaction triggers based on user preference
  let isDm = false;
  if (triggerType === "reactions") {
    const delivery = await deps.getReactionDelivery(userId);
    isDm = delivery === "dm";
  }

  const effectiveThreadTs = threadTs || messageTs;

  // Active-runs queueing per the original spec: if a Claude run is already in flight for
  // this conversation, push the new message into it via `handle.sendUpdate(text)`. The
  // handle's first-result-wins semantics deliver the queued text to the model only if it
  // arrives before the live run produces its first `result`. On rejection (run settled
  // between the lookup and the push), fall through to the normal fresh-spawn path.
  // Skip empty/whitespace text — pushing "" into the live SDK stream is not useful.
  const existingRun = getActiveRunForChannelMessage(channelId, effectiveThreadTs, userId);
  if (existingRun && messageText.trim().length > 0) {
    try {
      await existingRun.sendUpdate(messageText);
      logger.debug(
        `processMessage: appended follow-up to active run for ${channelId}:${effectiveThreadTs}`,
      );
      // Persist the follow-up into the session's `messages[]` so debug-session and
      // find_session_transcript see it. Without this, the SDK JSONL records the new user
      // turn but the Clack session log stays out of sync — the assistant's combined
      // response would appear to come from nowhere. Best-effort: a session miss just means
      // we couldn't attribute the follow-up (rare; the run wouldn't be in the registry
      // without an owning session).
      const followupSession = await deps.findSessionByThread(channelId, effectiveThreadTs);
      if (followupSession) {
        await deps.appendUserMessage(followupSession.sessionId, {
          role: "user",
          source: "reply",
          text: messageText,
          ts: Date.now(),
        });
      } else {
        logger.warn(
          `processMessage: in-flight run for ${channelId}:${effectiveThreadTs} has no session — follow-up text not persisted to messages[]`,
        );
      }
      // Visible ack so the user sees their follow-up was accepted into the running
      // conversation. Configurable via `reactions.queuedFollowup` (null/empty disables).
      const ackEmoji = resolveQueuedFollowupReaction(config);
      if (ackEmoji) {
        await addDeliveryReactions(client, channelId, messageTs, [ackEmoji]);
      }
      return { success: true, skipped: true, answer: "" };
    } catch (err) {
      logger.debug(
        `processMessage: existing run rejected sendUpdate (${err instanceof Error ? err.message : String(err)}); spawning a fresh run`,
      );
      // fall through
    }
  }

  const ctx: ProcessingContext = {
    client,
    config,
    userId,
    channelId,
    messageTs,
    messageText,
    threadTs,
    effectiveThreadTs,
    triggerType,
    workMode,
    additionalSystemPrompt: params.additionalSystemPrompt,
    requiredTools: params.requiredTools,
    skipConditions: params.skipConditions,
    imageFiles: params.imageFiles,
    preAnalysis: params.preAnalysis,
    jobId: params.jobId,
    reactionEmoji: params.reactionEmoji,
    autoRespondRuleName: params.autoRespondRuleName,
  };

  const userLabel = await deps.resolveUserLabel(client, userId);
  const channelLabel = await deps.resolveChannelLabel(client, channelId);
  logger.debug(
    `Processing message from ${userLabel} in ${channelLabel} (trigger: ${triggerType}${isDm ? ", dm" : ""})${await deps.slackLink(client, channelId, effectiveThreadTs)}`,
  );

  // 1. Set up or retrieve session
  let session = await setupSession(ctx, deps);

  // 2. DM setup for reaction triggers (before executeAndDeliver sees sessionInfo)
  let dmCoords: DmCoordinates | null = null;
  if (isDm) {
    dmCoords = await setupDmDelivery(ctx, session, deps);
    if (!dmCoords) {
      isDm = false;
    }
  }

  // 3. Store assistant channel context on session before Claude runs
  if (params.assistantChannelId) {
    session = await storeAssistantContext(session, params.assistantChannelId, deps);
  }

  // 4. Update sessionInfo with DM coordinates (if set)
  const sessionInfo = {
    channelId,
    threadTs: effectiveThreadTs,
    userId,
    triggerType,
    ...(dmCoords?.dmChannel && { dmChannel: dmCoords.dmChannel }),
    ...(dmCoords?.dmThreadTs && { dmThreadTs: dmCoords.dmThreadTs }),
  };
  deps.setSessionInfo(session.sessionId, sessionInfo);

  // 5. Collect available images + files from triggering message + thread context
  const imageMap = new Map<string, SlackImageFile>();
  if (params.imageFiles) {
    for (const img of params.imageFiles) imageMap.set(img.id, img);
  }
  const fileMap = new Map<string, SlackFile>();
  if (params.files) {
    for (const f of params.files) fileMap.set(f.id, f);
  }
  for (const msg of session.threadContext) {
    if (msg.imageFiles) {
      for (const img of msg.imageFiles) imageMap.set(img.id, img);
    }
    if (msg.files) {
      for (const f of msg.files) fileMap.set(f.id, f);
    }
  }
  const availableImages = imageMap;
  const availableFiles = fileMap;

  // 6. Build Claude options and execute. The active-runs registry replaces the previous
  // in-flight tracking wrapper — `askClaude` registers itself under (channelId, threadTs)
  // when the run is constructed and deregisters via the handle's `onTerminal` hook.
  const claudeOptions = await deps.getClaudeOptions(userId, triggerType);
  const abortController = new AbortController();

  return deps.executeAndDeliver({
    client,
    session,
    sessionInfo,
    claudeOptions: {
      ...claudeOptions,
      workMode,
      availableImages,
      availableFiles,
      requiredTools: ctx.requiredTools,
      skipConditions: ctx.skipConditions,
    },
    abortController,
    silentThinking,
    preAnalysis: ctx.preAnalysis,
  });
}
