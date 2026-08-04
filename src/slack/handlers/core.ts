import type { App } from "@slack/bolt";
import type {
  SessionContext,
  SessionMessage,
  SessionTrigger,
  SettableAttentionLevel,
} from "../../sessions.js";
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
import { isQuiescing } from "../../shutdown.js";
import { t } from "../../i18n/t.js";
import { activeSessions } from "../activeSessions.js";
import { fetchThreadContext } from "../messagesApi.js";
import { transformUserMentions, getUserInfo } from "../userCache.js";
import { getChannelInfo } from "../channelCache.js";
import { openDmChannel } from "../channelResolver.js";
import { isChannellessChannelId } from "../../channelless.js";
import { resolveChannelLabel, resolveUserLabel, slackLink } from "../logContext.js";
import { getClaudeOptions, type GetClaudeOptionsArgs } from "./changeWorkflowHelper.js";
import { mergeBuiltinTopics } from "../../claude/builtinTopics.js";
import { getReactionDelivery } from "../../userPreferences.js";
import {
  getForChannelMessage as getActiveRunForChannelMessage,
  withThreadLock,
} from "../activeRuns.js";
import { addDeliveryReactions } from "../messageReactions.js";
import { storeDmCoordinates } from "../dmResponse.js";
import { executeAndDeliver } from "./handlerResponse.js";
import type { TriggerType } from "../../changes/types.js";
import type { SlackImageFile, SlackFile } from "../slackFileBase.js";
import type { AskClaudeOptions, ClaudeResponse } from "../../claude/index.js";
import type { SessionInfo } from "../activeSessions.js";
import type { UserRole } from "../../roles.js";

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
  getClaudeOptions: (
    userId: string,
    triggerType: TriggerType,
    options?: GetClaudeOptionsArgs,
  ) => Promise<AskClaudeOptions>;
  getReactionDelivery: (userId: string) => Promise<string>;
  storeDmCoordinates: typeof storeDmCoordinates;
  executeAndDeliver: typeof executeAndDeliver;
  appendUserMessage: typeof appendUserMessage;
  withThreadLock: typeof withThreadLock;
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
  withThreadLock,
};

/**
 * Optional per-round hook for split investigations: when a session follows threads, this
 * drains them and rebuilds its investigation delivery context before the turn. Registered by
 * the investigations engine at boot (a nullable seam so core carries no static dependency on
 * the feature). Null → no-op.
 */
type InvestigationSessionRefresher = (
  session: SessionContext,
  client: App["client"],
) => Promise<SessionContext>;

let investigationSessionRefresher: InvestigationSessionRefresher | null = null;

export function setInvestigationSessionRefresher(fn: InvestigationSessionRefresher | null): void {
  investigationSessionRefresher = fn;
}

export interface ProcessMessageParams {
  client: App["client"];
  userId: string;
  /**
   * Slack channel ID. For channelless plugin-managed cron jobs, the dispatch layer
   * synthesizes a `channelless:<jobId>` sentinel via `makeChannellessChannelId(jobId)`
   * — detect it with `isChannellessChannelId(channelId)`. Slack-API call sites MUST
   * guard against the sentinel; sessions still store it for lookup symmetry but no
   * real channel exists.
   */
  channelId: string;
  messageTs: string;
  messageText: string;
  threadTs?: string;
  triggerType: TriggerType;
  /** When true, hints Claude to propose a change with auto-execute */
  workMode?: boolean;
  /** Channel the user is viewing in the assistant panel */
  assistantChannelId?: string;
  /**
   * Slack `action_token` from the triggering `message`/`app_mention` event. Enables
   * `search_messages` (bot-token `assistant.search.context`). Absent for reaction/cron
   * triggers. Threaded onto the Claude options, never persisted to the session.
   */
  actionToken?: string;
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
  /**
   * Declarative override of `submit_response` schema/gating behavior. Threaded from the cron
   * scheduler when the originating job declares a mode. See `CronJob.submitResponseMode` for
   * the contract. Only meaningful for `triggerType: "scheduled"`.
   */
  submitResponseMode?: "always" | "optional" | "optional-post-to" | "skipped";
  /**
   * When true, suppress ALL Slack output for this run — the primary `submit_response` delivery,
   * the worker `report_status` posts, and change-lifecycle status posts. Change auto-execution
   * still runs against the real channel and GitHub-side effects are unaffected. Threaded from the
   * cron scheduler when the originating job declares `silent`. See the `silent-change-execution`
   * capability. Only meaningful for `triggerType: "scheduled"`.
   */
  silent?: boolean;
  /** Pre-analysis verdict from the autoRespond gate. Forwarded onto the session trigger at
   *  creation (autoRespond only) AND onto each assistant message appended during this run. */
  preAnalysis?: string;
  /** Initial attention level seeded onto a NEW session from the trigger source (auto-respond
   *  rule or cron job). Ignored when reusing an existing thread session. Defaults to `"medium"`. */
  attentionLevel?: SettableAttentionLevel;
  /** Cron job ID for scheduled triggers — recorded on the session's trigger. */
  jobId?: string;
  /** True when the firing cron job is plugin-managed (`pluginManaged: true`). Gates the
   *  skill catalogs out of the prompt for scheduled fires; absent → fail open (catalogs
   *  render). See the `lazy-skill-loading` capability. */
  pluginManagedJob?: boolean;
  /** Emoji name (no colons) for reactions triggers — recorded on the trigger. */
  reactionEmoji?: string;
  /** autoRespond rule name — propagated onto the trigger when a rule matched. */
  autoRespondRuleName?: string;
  /**
   * Explicit role override that bypasses `getRole(userId)`. Used by the cron
   * scheduler for plugin-managed jobs so they run as `"system"` instead of
   * resolving the synthetic actor userId through `getRole` (which would return
   * the default "member" tier and silently filter out plugin tools).
   */
  roleOverride?: UserRole;
  /**
   * Effective "now" for time-sensitive tools. Threaded onto the Claude session/tool context
   * so tools (e.g. `process_reveal_answers`) can read it instead of relying on the
   * system-prompt REPLAY CONTEXT block. Populated by the cron scheduler on replay runs.
   */
  asOf?: Date;
  /**
   * Topic names to pre-attach for this session — surfaces `topics/<topic>/*.md` instruction
   * files (including plugin virtual defaults registered via `sdk.addTopicInstruction`) in
   * the system prompt from the first turn. Populated by the cron scheduler when the
   * originating job's `attachedTopics` field is set. Only meaningful for scheduled triggers.
   * See the `plugin-topic-instructions` capability.
   */
  preAttachedTopics?: string[];
  /**
   * Explicit session to continue instead of resolving by thread. Set by the ephemeral
   * channel-conversation path (`triggerType: "channelReply"`): the incoming message is
   * top-level (no `thread_ts`), but the turn must resume the anchor session — its record,
   * its `sdkSessionId` — so Claude keeps the conversation's context.
   */
  resumeSessionId?: string;
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
  /** Slack `action_token` from the triggering event — see `ProcessMessageParams.actionToken`. */
  readonly actionToken?: string;
  readonly requiredTools?: string[];
  readonly skipConditions?: string;
  /** Declarative submit_response mode override from the originating cron job. */
  readonly submitResponseMode?: "always" | "optional" | "optional-post-to" | "skipped";
  /** When true, suppress all Slack output for this run. See `ProcessMessageParams.silent`. */
  readonly silent?: boolean;
  /** Effective "now" for time-sensitive tools (replay support). Threaded into Claude options. */
  readonly asOf?: Date;
  /** Image files from the triggering Slack message (stored on the trigger). */
  readonly imageFiles?: SlackImageFile[];
  /** Pre-analysis verdict from the autoRespond gate. Stamped onto the session's trigger
   *  at creation (autoRespond only) AND onto each assistant message appended during this run. */
  readonly preAnalysis?: string;
  /** Initial attention level seeded onto a NEW session (auto-respond rule / cron). */
  readonly attentionLevel?: SettableAttentionLevel;
  /** Cron job ID for scheduled triggers — carried onto the trigger for provenance. */
  readonly jobId?: string;
  /** Plugin-managed firing job — see ProcessMessageParams.pluginManagedJob. */
  readonly pluginManagedJob?: boolean;
  /** Reactions trigger — the emoji that was reacted with. */
  readonly reactionEmoji?: string;
  /** autoRespond rule name — propagated onto the trigger when a rule matched. */
  readonly autoRespondRuleName?: string;
  /** Explicit role override (system jobs run as "system"; see ProcessMessageParams). */
  readonly roleOverride?: UserRole;
  /** Topic names pre-attached for the session — see ProcessMessageParams.preAttachedTopics. */
  readonly preAttachedTopics?: string[];
  /** Explicit session to continue — see ProcessMessageParams.resumeSessionId. */
  readonly resumeSessionId?: string;
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
    case "channelReply":
      // A threadReply/channelReply event here only happens when there was NO existing session
      // found (for channelReply: the anchor session vanished and the turn falls back to a
      // fresh session). Model as autoRespond for the trigger union — neither is a
      // session-creating type in its own right.
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

  let session = ctx.resumeSessionId
    ? await deps.getSession(ctx.resumeSessionId)
    : threadTs
      ? await deps.findSessionByThread(channelId, threadTs)
      : null;

  // Resolve user and channel info for session attribution. For channelless cron
  // dispatch (synthetic `channelless:<jobId>` sentinel), skip the Slack lookup —
  // the channel doesn't exist as a real Slack resource. See `src/channelless.ts`.
  const userInfo = await deps.getUserInfo(client, userId);
  const channelInfo = isChannellessChannelId(channelId)
    ? null
    : await deps.getChannelInfo(client, channelId);

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
      attentionLevel: ctx.attentionLevel,
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

  // Split investigations: drain followed threads + refresh delivery context before the turn.
  if (session.followedThreads?.length && investigationSessionRefresher) {
    session = await investigationSessionRefresher(session, ctx.client);
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

  // Graceful-shutdown quiesce gate: once a shutdown drain has begun, refuse to start new
  // runs so the in-flight set only shrinks. User-initiated triggers get an ephemeral
  // "restarting" notice; proactive triggers (autoRespond) and cron fires skip silently.
  if (isQuiescing()) {
    const interactive =
      triggerType === "directMessages" ||
      triggerType === "mentions" ||
      triggerType === "reactions" ||
      triggerType === "threadReply" ||
      triggerType === "channelReply";
    if (interactive) {
      try {
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: t("shutdown.restarting_notice"),
        });
      } catch (err) {
        logger.warn(
          `Quiesce ephemeral notice failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { success: true, skipped: true, answer: "" };
  }

  const config = deps.getConfig();

  // Resolve DM delivery for reaction triggers based on user preference
  let isDm = false;
  if (triggerType === "reactions") {
    const delivery = await deps.getReactionDelivery(userId);
    isDm = delivery === "dm";
  }

  const effectiveThreadTs = threadTs || messageTs;

  // Serialize the consult-then-{sendUpdate|spawn} decision per thread. Without this, the
  // synchronous registry consult below and the slot claim inside `askClaude` (which happens
  // only after session + delivery setup) are separated by a multi-await gap, so two messages
  // on one thread could both observe an empty slot and each spawn a run + streamer. The lock
  // is released (`release`) the instant the spawned run claims its slot — via `onRegistered`,
  // wired into claudeOptions below — so it is held only across setup, not the run's duration;
  // mid-run follow-ups still take the fast `sendUpdate` path.
  return deps.withThreadLock(channelId, effectiveThreadTs, async (release) => {
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
          addDeliveryReactions(client, channelId, messageTs, [ackEmoji]).catch((err) =>
            logger.warn(`addDeliveryReactions threw: ${err}`),
          );
        }
        // Queued onto the existing run — nothing to register, so release the lock now.
        release();
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
      actionToken: params.actionToken,
      requiredTools: params.requiredTools,
      skipConditions: params.skipConditions,
      submitResponseMode: params.submitResponseMode,
      silent: params.silent,
      asOf: params.asOf,
      imageFiles: params.imageFiles,
      preAnalysis: params.preAnalysis,
      attentionLevel: params.attentionLevel,
      jobId: params.jobId,
      pluginManagedJob: params.pluginManagedJob,
      reactionEmoji: params.reactionEmoji,
      autoRespondRuleName: params.autoRespondRuleName,
      roleOverride: params.roleOverride,
      preAttachedTopics: params.preAttachedTopics,
      resumeSessionId: params.resumeSessionId,
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
    const claudeOptions = await deps.getClaudeOptions(userId, triggerType, {
      channelId,
      roleOverride: ctx.roleOverride,
    });
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
        actionToken: ctx.actionToken,
        requiredTools: ctx.requiredTools,
        skipConditions: ctx.skipConditions,
        submitResponseMode: ctx.submitResponseMode,
        asOf: ctx.asOf,
        pluginManagedJob: ctx.pluginManagedJob,
        preAttachedTopics: mergeBuiltinTopics(triggerType, ctx.preAttachedTopics),
        // Releases the per-thread lock the instant this run claims its active-runs slot.
        onRegistered: release,
      },
      abortController,
      // An engaged thread marked `deliveryMode: "invisible"` runs silently; an explicit
      // `silentThinking` (cron) stays silent regardless. This is the single place the
      // per-thread mode reaches delivery, so every engaged-session reuse honors it.
      silentThinking: silentThinking || session.deliveryMode === "invisible",
      silent: ctx.silent,
      preAnalysis: ctx.preAnalysis,
    });
  });
}

/**
 * Backs `sdk.startThreadConversation`. Starts a streamed, session-creating Claude
 * turn in a thread through the normal `processMessage` pipeline — full query
 * toolset, common chat streamer (no `silentThinking`), and an engaged `attentionLevel`
 * so the thread auto-follows. `messageTs` is the thread anchor since there is no
 * distinct triggering message. Bound into `ClackSdkDeps.startThreadConversation`
 * at the `loadAndInstallPlugins` call sites.
 */
export async function startThreadConversation(params: {
  client: App["client"];
  channel: string;
  threadTs: string;
  userId: string;
  prompt: string;
  additionalSystemPrompt?: string;
  attentionLevel?: SettableAttentionLevel;
}): Promise<void> {
  await processMessage({
    client: params.client,
    userId: params.userId,
    channelId: params.channel,
    messageTs: params.threadTs,
    messageText: params.prompt,
    threadTs: params.threadTs,
    triggerType: "autoRespond",
    ...(params.additionalSystemPrompt !== undefined
      ? { additionalSystemPrompt: params.additionalSystemPrompt }
      : {}),
    ...(params.attentionLevel !== undefined ? { attentionLevel: params.attentionLevel } : {}),
  });
}
