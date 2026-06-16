import { randomBytes } from "node:crypto";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { SdkMcpToolDefinition, AnyZodRawShape } from "@anthropic-ai/claude-agent-sdk";

import type {
  StagedIntent,
  ToolCallRecord,
  SubmitResponsePayload,
  ResponseSnapshot,
  ClackToolsResult,
  ClackQueryToolsResult,
  ClackWorkerToolsResult,
  ToolBuildContext,
  QueryToolContext,
  WorkerToolContext,
  DeliverToChannelFn,
} from "./types.js";
import { postAnswerToChannel } from "../slack/handlers/dmActions.js";
import { extractDisplayText } from "../slack/blockText.js";
import { errorMessage } from "../errors.js";
import { meetsMinimumRole } from "../permissions.js";
import { getLoadedPlugins } from "../plugins/state.js";
import { logger } from "../logger.js";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { asSlackBlocks } from "../slack/blocks.js";
import type { SlackBlocks } from "../slack/blocks.js";
import { updateSession, getSession, registerThreadSession } from "../sessions.js";
import type { SessionContext, AttentionLevel, DeliveryMode } from "../sessions.js";
import { canRequestChanges, canEditConfig, canAccessMemory } from "../permissions.js";
import { createRememberTool } from "./query/remember.js";
import { createRecallTool } from "./query/recall.js";
import { createForgetTool } from "./query/forget.js";

// Query tools
import { createListRepositoriesTool } from "./query/listRepositories.js";
import { createFindSessionsTool } from "./query/findSessions.js";
import { createFindChangesTool } from "./query/findChanges.js";
import { createFindPullRequestsTool } from "./query/findPullRequests.js";
import { createResolveReviewThreadTool } from "./query/resolveReviewThread.js";
import { createListConfigFilesTool } from "./query/listConfigFiles.js";
import { createReadConfigFileTool } from "./query/readConfigFile.js";
import { createGitLogTool } from "./query/gitLog.js";
import { createDeepenHistoryTool } from "./query/deepenHistory.js";
import { createFindUserTool } from "./query/findUser.js";
import { createFindEmojiTool } from "./query/findEmoji.js";
import { createFetchSlackMessageTool } from "./query/fetchSlackMessage.js";
import { createStopTrackingTool } from "./query/stopTracking.js";
import { createFetchChannelMessagesTool } from "./query/fetchChannelMessages.js";
import { createViewSlackImageTool } from "./query/viewSlackImage.js";
import { createViewSlackFileTool } from "./query/viewSlackFile.js";
import { createUploadFileTool } from "./query/uploadFile.js";
import { createAddReactionTool } from "./query/addReaction.js";
import { createFindChannelTool } from "./query/findChannel.js";
import { createRemoveReactionTool } from "./query/removeReaction.js";
import { createGetSessionTraceTool } from "./query/getSessionTrace.js";
import { createAttachIntegrationTool } from "./query/attachIntegration.js";
import { createListSkillPackSkillsTool } from "./query/listSkillPackSkills.js";
import { createLoadSkillTool } from "./query/loadSkill.js";
import { createRandomRollTool } from "./query/randomRoll.js";
import { createUsersCache } from "../slack/usersCache.js";
import { createEmojiCache } from "../slack/emojiCache.js";
import { createChannelsCache } from "../slack/channelsCache.js";

// Action tools
import { createProposeChangeTool } from "./actions/proposeChange.js";
import { createProposeConfigUpdateTool } from "./actions/proposeConfigUpdate.js";
import { createProposeSkillCreateTool } from "./actions/proposeSkillCreate.js";
import { createProposeSkillUpdateTool } from "./actions/proposeSkillUpdate.js";
import { createProposeSkillDisableTool } from "./actions/proposeSkillDisable.js";
import { createProposeSkillRestoreTool } from "./actions/proposeSkillRestore.js";
import { createListUserSkillsTool } from "./query/listUserSkills.js";
import { createRequestUpdateTool } from "./actions/requestUpdate.js";
import { createScheduleReminderTool } from "./actions/scheduleReminder.js";
import { createCancelReminderTool } from "./actions/cancelReminder.js";
import { createCreateScheduledMessageTool } from "./actions/createScheduledMessage.js";
import { createCancelScheduledMessageTool } from "./actions/cancelScheduledMessage.js";
import { createRunScheduledMessageNowTool } from "./actions/runScheduledMessageNow.js";
import { createUpdateScheduledMessageTool } from "./actions/updateScheduledMessage.js";
import { createCancelWorkerRunTool } from "./actions/cancelWorkerRun.js";
import { createAddAutoRespondRuleTool } from "./actions/addAutoRespondRule.js";
import { createUpdateAutoRespondRuleTool } from "./actions/updateAutoRespondRule.js";
import { createToggleAutoRespondRuleTool } from "./actions/toggleAutoRespondRule.js";
import { createDeleteAutoRespondRuleTool } from "./actions/deleteAutoRespondRule.js";
import { createListAutoRespondRulesTool } from "./query/listAutoRespondRules.js";

// Admin tools
import { createAdminReadFileTool } from "./admin/adminReadFile.js";
import { createAdminWriteFileTool } from "./admin/adminWriteFile.js";
import { createAdminDescribeConfigFileTool } from "./admin/adminDescribeConfigFile.js";
import { createAdminRestartAppTool } from "./admin/adminRestartApp.js";
import { createAdminSetEnvTool } from "./admin/adminSetEnv.js";
import { createAdminListEnvTool } from "./admin/adminListEnv.js";
import { createAdminSetRoleTool } from "./admin/adminSetRole.js";
import { createAdminDeleteMessageTool } from "./admin/adminDeleteMessage.js";
import { createListErrorReportsTool } from "./admin/listErrorReports.js";
import { createReadErrorReportTool } from "./admin/readErrorReport.js";

// Scheduled message query tools
import { createListRemindersTool } from "./query/listReminders.js";
import { createListScheduledMessagesTool } from "./query/listScheduledMessages.js";
import { createGetScheduledMessageTool } from "./query/getScheduledMessage.js";
import { createGetScheduledMessageRunsTool } from "./query/getScheduledMessageRuns.js";
import { createFindRecentInteractionsTool } from "./query/findRecentInteractions.js";
import { createFindSessionTranscriptTool } from "./query/findSessionTranscript.js";

// Presentation tool
import { createSubmitResponseTool } from "./presentation/submitResponse.js";
import { createSwitchDeliveryContextTool } from "./query/switchDeliveryContext.js";

// Worker tools
import { createGitPushTool } from "./worker/gitPush.js";
import { createAwaitCiTool } from "./worker/awaitCi.js";
import { createEnsurePRTool } from "./worker/ensurePR.js";
import { createMergePRTool } from "./worker/mergePR.js";
import { createClosePRTool } from "./worker/closePR.js";
import { createReportStatusTool } from "./worker/reportStatus.js";
import { createProposeSpinoffTool } from "./worker/proposeSpinoff.js";
import { createLoadSkillTool as createWorkerLoadSkillTool } from "./worker/loadSkill.js";
import { isChannellessChannelId } from "../channelless.js";

// ============================================================================
// Staged Intent Store
// ============================================================================

export function generateRefId(): string {
  return randomBytes(6).toString("hex");
}

export interface IntentStore {
  stage: (intent: StagedIntent) => string;
  resolve: (ref: string) => StagedIntent | undefined;
  getAll: () => Map<string, StagedIntent>;
}

export function createIntentStore(): IntentStore {
  const intents = new Map<string, StagedIntent>();

  return {
    stage(intent: StagedIntent): string {
      const ref = generateRefId();
      intents.set(ref, intent);
      return ref;
    },

    resolve(ref: string): StagedIntent | undefined {
      return intents.get(ref);
    },

    getAll(): Map<string, StagedIntent> {
      return new Map(intents);
    },
  };
}

// ============================================================================
// Tool Call Recorder
// ============================================================================

export interface ToolCallRecorder {
  record: (tool: string, args: object, result: object) => void;
  getHistory: () => ToolCallRecord[];
}

export function createToolCallRecorder(): ToolCallRecorder {
  const history: ToolCallRecord[] = [];

  return {
    record(tool: string, args: object, result: object): void {
      history.push({ tool, args, result, timestamp: Date.now() });
    },

    getHistory(): ToolCallRecord[] {
      return [...history];
    },
  };
}

/**
 * Wrap a tool handler so every invocation is recorded under its full MCP-visible name
 * (`mcp__<server>__<tool>`). Used for both clack core tools and plugin tools so the recorder
 * sees a uniform history — this is what the `submit_response` required-tools gate reads.
 * The wrapper forwards the original return value on success and, on exception, records the
 * error outcome and rethrows so the SDK sees the original error. Exported for direct unit
 * testing.
 */
export function wrapToolForRecording<Schema extends AnyZodRawShape>(
  toolDef: SdkMcpToolDefinition<Schema>,
  fullName: string,
  recorder: ToolCallRecorder,
): SdkMcpToolDefinition<Schema> {
  const originalHandler = toolDef.handler;
  return {
    ...toolDef,
    handler: async (args, extra) => {
      try {
        const result = await originalHandler(args, extra);
        recorder.record(fullName, { ...args }, { ...result });
        return result;
      } catch (err) {
        recorder.record(
          fullName,
          { ...args },
          { error: err instanceof Error ? err.message : String(err) },
        );
        throw err;
      }
    },
  };
}

// ============================================================================
// Response Capture
// ============================================================================

export interface ResponseCapture {
  set: (payload: SubmitResponsePayload, renderedBlocks: SlackBlocks) => void;
  get: () => SubmitResponsePayload | null;
  getRenderedBlocks: () => SlackBlocks | null;
  setSkipped: () => void;
  setAttentionLevel: (level: AttentionLevel) => void;
  setDeliveryMode: (mode: DeliveryMode) => void;
  setPostedTopLevel: () => void;
  isSkipped: () => boolean;
  /** The attention level Claude set via `submit_response.attention_level`, or null if unset. */
  getAttentionLevel: () => AttentionLevel | null;
  /** The delivery mode Claude set via `submit_response.default_delivery_mode`, or null if unset. */
  getDeliveryMode: () => DeliveryMode | null;
  isPostedTopLevel: () => boolean;
}

export function createResponseCapture(): ResponseCapture {
  let result: SubmitResponsePayload | null = null;
  let blocks: SlackBlocks | null = null;
  let skipped = false;
  let attentionLevel: AttentionLevel | null = null;
  let deliveryMode: DeliveryMode | null = null;
  let postedTopLevel = false;

  return {
    set(payload: SubmitResponsePayload, renderedBlocks: SlackBlocks): void {
      result = payload;
      blocks = renderedBlocks;
    },

    get(): SubmitResponsePayload | null {
      return result;
    },

    getRenderedBlocks(): SlackBlocks | null {
      return blocks;
    },

    setSkipped(): void {
      skipped = true;
    },

    setAttentionLevel(level: AttentionLevel): void {
      attentionLevel = level;
    },

    setDeliveryMode(mode: DeliveryMode): void {
      deliveryMode = mode;
    },

    setPostedTopLevel(): void {
      postedTopLevel = true;
    },

    isSkipped(): boolean {
      return skipped;
    },

    getAttentionLevel(): AttentionLevel | null {
      return attentionLevel;
    },

    getDeliveryMode(): DeliveryMode | null {
      return deliveryMode;
    },

    isPostedTopLevel(): boolean {
      return postedTopLevel;
    },
  };
}

// ============================================================================
// Trigger-type gating for submit_response schema features
// ============================================================================

type TriggerType = SessionContext["triggerType"];

/** Skip is meaningful only for triggers where the system expects optional silence. */
export function shouldAllowSkip(triggerType: TriggerType): boolean {
  return triggerType === "autoRespond" || triggerType === "threadReply";
}

/**
 * Decide whether to expose `skip_response` on `submit_response` for this run.
 *
 * Precedence (highest to lowest):
 * 1. `submitResponseMode === "always"` → `allowSkip = false`. Explicit no-skip override.
 * 2. `submitResponseMode === "optional"` → `allowSkip = true`. Explicit skip-available override.
 * 3. `submitResponseMode === "skipped"` → `allowSkip = true`. The downstream schema variant
 *    (chosen separately) enforces that skip is REQUIRED.
 * 4. Mode unset → today's auto-derivation: `shouldAllowSkip(triggerType)` OR
 *    `triggerType === "scheduled" && skipConditions is non-empty`.
 *
 * The schema-variant selection (which decides whether the skipped-only schema is used) reads
 * the mode directly; this function returns only the `allowSkip` boolean.
 */
export function computeAllowSkip(
  triggerType: TriggerType,
  skipConditions?: string,
  submitResponseMode?: "always" | "optional" | "optional-post-to" | "skipped",
): boolean {
  if (submitResponseMode === "always") return false;
  if (
    submitResponseMode === "optional" ||
    submitResponseMode === "optional-post-to" ||
    submitResponseMode === "skipped"
  ) {
    return true;
  }
  if (shouldAllowSkip(triggerType)) return true;
  return triggerType === "scheduled" && !!skipConditions && skipConditions.length > 0;
}

/**
 * The `attention_level` dial is meaningful wherever thread auto-respond tracking has runtime
 * effect — the skippable triggers plus channel mentions, where Claude can raise/lower the
 * thread's eagerness or set `"off"` to disengage ("thanks, you're done").
 */
export function shouldAllowAttentionLevel(triggerType: TriggerType): boolean {
  return (
    triggerType === "autoRespond" || triggerType === "threadReply" || triggerType === "mentions"
  );
}

/**
 * Post-top-level is meaningful for triggers that have a surrounding channel where the
 * response could plausibly go top-level instead of in a thread. Excludes DMs (no channel
 * top-level) and scheduled (already posts top-level by design — uses the separate
 * `topLevelDeliveryChannel` mechanism).
 */
export function shouldAllowPostTopLevel(triggerType: TriggerType): boolean {
  return (
    triggerType === "autoRespond" ||
    triggerType === "threadReply" ||
    triggerType === "mentions" ||
    triggerType === "reactions"
  );
}

// ============================================================================
// Build Clack Tools (MCP Server)
// ============================================================================

function buildQueryTools(ctx: QueryToolContext): ClackQueryToolsResult {
  const intentStore = createIntentStore();
  const recorder = createToolCallRecorder();
  const responseCapture = createResponseCapture();

  // Tool factories return different SdkMcpToolDefinition<T> generics; `any` required for the heterogeneous array
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: SdkMcpToolDefinition<any>[] = [];

  // --- Query tools ---
  tools.push(createListRepositoriesTool(ctx));
  tools.push(createGitLogTool(ctx));
  tools.push(createDeepenHistoryTool(ctx));
  tools.push(createRandomRollTool());

  // Interactive turns only — the orchestrator provides a `deliveryControl` to swap the live
  // delivery surface. Absent in channelless cron / worker contexts (nothing to switch).
  if (ctx.deliveryControl) {
    tools.push(createSwitchDeliveryContextTool(ctx.deliveryControl));
  }

  if (ctx.slackClient) {
    const usersCache = createUsersCache(ctx.slackClient);
    tools.push(createFindUserTool(ctx, usersCache));
    const emojiCache = createEmojiCache(ctx.slackClient);
    tools.push(createFindEmojiTool(emojiCache));
    tools.push(createFetchSlackMessageTool(ctx));
    tools.push(createFetchChannelMessagesTool(ctx));
    tools.push(createUploadFileTool(ctx));
    tools.push(createStopTrackingTool(ctx));
    tools.push(createAddReactionTool(ctx));
    tools.push(createRemoveReactionTool(ctx));
    const channelsCache = createChannelsCache(ctx.slackClient);
    tools.push(createFindChannelTool(channelsCache));
  }

  // Lazy MCP loading — attach_integration is available whenever the mcpManager is
  // populated (i.e., lazy-loading is wired for this session). Gated so the tool is
  // hidden in contexts that can't support mid-session attachment.
  if (ctx.mcpManager) {
    tools.push(createAttachIntegrationTool(ctx));
  }

  // Lazy skill loading — list_skill_pack_skills and load_skill are available
  // whenever the skillsManager is populated (query mode with lazy-pack registry).
  if (ctx.skillsManager) {
    tools.push(createListSkillPackSkillsTool(ctx));
    tools.push(createLoadSkillTool(ctx));
  }

  // Read-only query tools — available to all roles
  tools.push(createFindRecentInteractionsTool(ctx));
  tools.push(createFindSessionTranscriptTool(ctx));
  tools.push(createFindSessionsTool(ctx));
  tools.push(createFindChangesTool(ctx));
  tools.push(createFindPullRequestsTool(ctx));
  tools.push(createResolveReviewThreadTool(ctx));

  if (canEditConfig(ctx.role)) {
    tools.push(createListConfigFilesTool(ctx));
    tools.push(createReadConfigFileTool(ctx));
    tools.push(createGetSessionTraceTool(ctx));
  }

  // Memory faculty — dev+ (the "system" cron role passes meetsMinimumRole, so the daily
  // review and plugin crons reach these without a special case).
  if (canAccessMemory(ctx.role)) {
    tools.push(createRememberTool());
    tools.push(createRecallTool());
    tools.push(createForgetTool());
  }

  // Always register when images exist OR Slack client is available (fetch tools can discover images mid-query)
  if (ctx.availableImages?.size || ctx.slackClient) {
    tools.push(createViewSlackImageTool(ctx));
  }

  // Register file viewer when files exist OR Slack client is available (fetch tools can discover files mid-query)
  if (ctx.availableFiles?.size || ctx.slackClient) {
    tools.push(createViewSlackFileTool(ctx));
  }

  // --- Action tools (role-only gating, no session state checks) ---
  if (canRequestChanges(ctx.role) && ctx.changesWorkflowEnabled) {
    tools.push(createProposeChangeTool(ctx, intentStore));
    tools.push(createRequestUpdateTool(ctx, intentStore));
    tools.push(createCancelWorkerRunTool(ctx));
  }

  if (canEditConfig(ctx.role)) {
    tools.push(createProposeConfigUpdateTool(ctx, intentStore));
    tools.push(createAdminReadFileTool());
    tools.push(createAdminWriteFileTool());
    tools.push(createAdminDescribeConfigFileTool());
    tools.push(createAdminRestartAppTool());
    tools.push(createAdminSetEnvTool());
    tools.push(createAdminListEnvTool());
    tools.push(createAdminSetRoleTool());
    tools.push(createListErrorReportsTool());
    tools.push(createReadErrorReportTool());
    if (ctx.slackClient) {
      tools.push(createAdminDeleteMessageTool(ctx));
      tools.push(createListAutoRespondRulesTool(ctx));
      tools.push(createAddAutoRespondRuleTool(ctx));
      tools.push(createUpdateAutoRespondRuleTool(ctx));
      tools.push(createToggleAutoRespondRuleTool(ctx));
      tools.push(createDeleteAutoRespondRuleTool(ctx));
    }
  }

  // --- User-created skills (config-gated; permissions enforced at tool layer) ---
  if (ctx.config.userSkills?.enabled) {
    tools.push(createListUserSkillsTool(ctx));
    tools.push(createProposeSkillCreateTool(ctx, intentStore));
    tools.push(createProposeSkillUpdateTool(ctx, intentStore));
    tools.push(createProposeSkillDisableTool(ctx, intentStore));
    tools.push(createProposeSkillRestoreTool(ctx, intentStore));
  }

  // --- Scheduled message tools (no role gating, config-gated) ---
  if (ctx.cronUserSchedules && ctx.slackClient) {
    tools.push(createScheduleReminderTool(ctx));
    tools.push(createListRemindersTool(ctx));
    tools.push(createCancelReminderTool(ctx));
    tools.push(createCreateScheduledMessageTool(ctx));
    tools.push(createListScheduledMessagesTool(ctx));
    tools.push(createGetScheduledMessageTool(ctx));
    tools.push(createGetScheduledMessageRunsTool(ctx));
    tools.push(createCancelScheduledMessageTool(ctx));
    tools.push(createUpdateScheduledMessageTool(ctx));
    tools.push(createRunScheduledMessageNowTool(ctx));
  }

  // --- Plugin tools: per plugin, one always-on SDK server (`mcp__<plugin>__*`) built
  // from tools with no serverKey, plus one SDK server per on-demand handle declared via
  // `sdk.registerMcpServer(key, ...)` (`mcp__<plugin>_<key>__*`) built from tools whose
  // serverKey matches. On-demand servers are registered with McpServerManager so
  // `attach_integration(<plugin>:<key>)` can attach them mid-session; they're also
  // included in the baseline at session start when the integration is already in
  // `session.attachedIntegrations` (resume case — the SDK's restored state expects the
  // server to match `options.mcpServers`).
  const pluginMcpServers: Record<string, McpSdkServerConfigWithInstance> = {};
  const pluginToolFullNames: string[] = [];
  const pluginResults = getLoadedPlugins().results;
  const attachedSnapshot = ctx.session.attachedIntegrations ?? [];
  for (const plugin of pluginResults) {
    const byServerKey = new Map<string | undefined, SdkMcpToolDefinition<AnyZodRawShape>[]>();
    const fullNamesByServerKey = new Map<string | undefined, string[]>();
    for (const registered of plugin.tools) {
      if (!meetsMinimumRole(ctx.role, registered.minRole)) continue;
      const serverKey = registered.serverKey;
      const serverMcpName = serverKey === undefined ? plugin.name : `${plugin.name}_${serverKey}`;
      const collected: SdkMcpToolDefinition<AnyZodRawShape>[] = [];
      registered.pushTo(collected);
      let toolBucket = byServerKey.get(serverKey);
      if (!toolBucket) {
        toolBucket = [];
        byServerKey.set(serverKey, toolBucket);
      }
      let nameBucket = fullNamesByServerKey.get(serverKey);
      if (!nameBucket) {
        nameBucket = [];
        fullNamesByServerKey.set(serverKey, nameBucket);
      }
      for (const toolDef of collected) {
        const fullName = `mcp__${serverMcpName}__${toolDef.name}`;
        nameBucket.push(fullName);
        toolBucket.push(wrapToolForRecording(toolDef, fullName, recorder));
      }
    }

    const defaultTools = byServerKey.get(undefined) ?? [];
    if (defaultTools.length > 0) {
      pluginMcpServers[plugin.name] = createSdkMcpServer({
        name: plugin.name,
        version: "1.0.0",
        tools: defaultTools,
      });
      pluginToolFullNames.push(...(fullNamesByServerKey.get(undefined) ?? []));
    }

    for (const spec of plugin.mcpServers) {
      const toolBucket = byServerKey.get(spec.key) ?? [];
      if (toolBucket.length === 0) continue;
      const serverMcpName = `${plugin.name}_${spec.key}`;
      const server = createSdkMcpServer({
        name: serverMcpName,
        version: "1.0.0",
        tools: toolBucket,
      });
      ctx.mcpManager?.registerIntegrationServer(spec.fullName, server);
      if (spec.autoload || attachedSnapshot.includes(spec.fullName)) {
        pluginMcpServers[serverMcpName] = server;
        pluginToolFullNames.push(...(fullNamesByServerKey.get(spec.key) ?? []));
      }
    }
  }

  // --- Presentation tool ---
  const persistSnapshot = async (id: string, snapshot: ResponseSnapshot): Promise<void> => {
    const session = await getSession(ctx.session.sessionId);
    if (!session) return;
    const snapshots = { ...session.snapshots, [id]: snapshot };
    await updateSession(ctx.session.sessionId, { snapshots });
  };

  // Deliver one `deliver_to` entry to an explicit channel via the SHARED per-channel routine
  // (`postAnswerToChannel`) — the same code path `post_to` auto-execute uses, not a parallel
  // one. Only wired when a Slack client is present (absent in test/verify contexts).
  const slackClient = ctx.slackClient;
  const deliverToChannel: DeliverToChannelFn | undefined = slackClient
    ? async ({ channel, threadTs, payload, attentionLevel, followUpContext, deliveryMode }) => {
        try {
          const snapshot: ResponseSnapshot = {
            text: extractDisplayText(payload.blocks),
            blocks: payload.blocks,
            ...(payload.table && { table: payload.table }),
            ...(payload.actions && payload.actions.length > 0 && { actions: payload.actions }),
            ...(payload.reactions &&
              payload.reactions.length > 0 && { reactions: payload.reactions }),
            ...(payload.suppress_unfurls === true && { suppressUnfurls: true }),
            ...(payload.thread_replies &&
              payload.thread_replies.length > 0 && { thread_replies: payload.thread_replies }),
          };
          const res = await postAnswerToChannel(
            slackClient,
            snapshot,
            channel,
            threadTs,
            undefined,
            {
              sessionId: ctx.session.sessionId,
            },
          );
          // Best-effort, non-fatal: seed an engaged session on the destination thread so human
          // replies there are picked up. Root is the entry's thread_ts, else the posted ts. A
          // seeding failure (or missing root ts) is logged, never surfaced as a delivery error.
          if (attentionLevel && attentionLevel !== "off") {
            const root = threadTs ?? res.ts;
            if (root) {
              try {
                await registerThreadSession(channel, root, {
                  attentionLevel,
                  followUpContext,
                  ...(deliveryMode && { deliveryMode }),
                });
              } catch (err) {
                logger.warn(
                  `deliver_to: failed to seed engaged thread (delivery succeeded): ${err}`,
                );
              }
            } else {
              logger.warn(
                `deliver_to: no root ts to seed engagement on (post succeeded with no ts and no thread_ts) in ${channel}`,
              );
            }
          }
          return { ok: true as const, ts: res.ts };
        } catch (error) {
          return { ok: false as const, error: errorMessage(error) };
        }
      }
    : undefined;

  const recordResponseTs = async (ts: string): Promise<void> => {
    await updateSession(ctx.session.sessionId, { responseTs: ts });
  };

  const triggerType = ctx.session.triggerType;
  tools.push(
    createSubmitResponseTool({
      intentStore,
      responseCapture,
      recorder,
      sessionId: ctx.session.sessionId,
      deliver: ctx.deliver,
      ...(deliverToChannel && { deliverToChannel }),
      recordResponseTs,
      persistSnapshot,
      // In scheduled mode, submit_response delivers top-level to the channel.
      // Pass the channel so post_to validation can reject duplicates.
      topLevelDeliveryChannel: triggerType === "scheduled" ? ctx.session.channelId : undefined,
      sessionChannelId: ctx.session.channelId,
      allowSkip: computeAllowSkip(triggerType, ctx.skipConditions, ctx.submitResponseMode),
      allowAttentionLevel: shouldAllowAttentionLevel(triggerType),
      allowPostTopLevel: shouldAllowPostTopLevel(triggerType),
      // Top-level multi-message fields gated to scheduled (cron) context only. In DM,
      // @mention, reaction, etc. the trigger channel is the user's space and multi-message
      // there is almost never what they want — they'd ask via post_to with an explicit
      // channel. post_to's own multi-message fields are NOT gated by this flag.
      allowMultiMessage: ctx.allowMultiMessage ?? false,
      // Cap on additional_messages.length at every layer (top-level and inside post_to).
      // Sourced from config.submitResponse.maxAdditionalMessages. Falls back to the schema's
      // built-in default when absent (e.g., tests that build deps directly).
      ...(ctx.maxAdditionalMessages !== undefined && {
        maxAdditionalMessages: ctx.maxAdditionalMessages,
      }),
      // Thread context for thread_replies delivery when the primary is not posted top-level
      // (replies go in the existing thread). Not used by additional_messages, which are
      // always top-level channel posts.
      ...(ctx.session.threadTs && { sessionThreadTs: ctx.session.threadTs }),
      // Channelless dispatch (synthetic `channelless:<jobId>` channel id) selects the
      // "optional-post-to"-shape submit_response schema regardless of the persisted
      // submitResponseMode — there's no bound channel for a primary response, but `post_to`
      // (which carries its own explicit channel) is the legitimate delivery path. Backs the
      // `submit-response-mode` capability's channelless rule.
      submitResponseMode: isChannellessChannelId(ctx.session.channelId)
        ? "optional-post-to"
        : ctx.submitResponseMode,
      requiredTools: ctx.requiredTools,
      ...(ctx.hasPendingInput && { hasPendingInput: ctx.hasPendingInput }),
      ...(ctx.consumePendingPushedTexts && {
        consumePendingPushedTexts: ctx.consumePendingPushedTexts,
      }),
    }),
  );

  const coreToolNames = tools.map((t) => t.name);
  const toolNames = [...coreToolNames, ...pluginToolFullNames];

  // Wrap every clack core tool so its invocation lands in the recorder under its full MCP name
  // (`mcp__clack__<tool>`). This gives `submit_response`'s required-tools gate a uniform view of
  // all tools — built-ins, action tools, plugin tools — without relying on each handler to
  // self-record. `submit_response` is skipped because its handler already records itself and
  // the gate needs to observe prior calls when it runs.
  const wrappedCoreTools = tools.map((tool) =>
    tool.name === "submit_response"
      ? tool
      : wrapToolForRecording(tool, `mcp__clack__${tool.name}`, recorder),
  );

  // Diagnostic warning: surface requiredTools entries that don't match any available tool.
  // The gate will still block delivery for these names, but a warning helps the operator
  // catch typos and misconfiguration early.
  if (ctx.requiredTools && ctx.requiredTools.length > 0) {
    const availableFullNames = new Set<string>([
      ...coreToolNames.map((n) => `mcp__clack__${n}`),
      ...pluginToolFullNames,
    ]);
    const unknown = ctx.requiredTools.filter((n) => !availableFullNames.has(n));
    if (unknown.length > 0) {
      logger.warn(
        `Session requiredTools reference unknown tool name(s): ${unknown.join(", ")}. ` +
          `The submit_response gate will block delivery until these are called — verify spelling and plugin activation.`,
      );
    }
  }

  const clackMcpServer = createSdkMcpServer({
    name: "clack",
    version: "1.0.0",
    tools: wrappedCoreTools,
  });

  const mcpServers: Record<string, McpSdkServerConfigWithInstance> = {
    clack: clackMcpServer,
    ...pluginMcpServers,
  };

  return {
    mcpServers,
    toolNames,
    getResult: () => responseCapture.get(),
    getRenderedBlocks: () => {
      const blocks = responseCapture.getRenderedBlocks();
      return blocks ? asSlackBlocks(blocks) : null;
    },
    getStagedIntents: () => intentStore.getAll(),
    getToolCallHistory: () => recorder.getHistory(),
    isSkipped: () => responseCapture.isSkipped(),
    getAttentionLevel: () => responseCapture.getAttentionLevel(),
    getDeliveryMode: () => responseCapture.getDeliveryMode(),
    isPostedTopLevel: () => responseCapture.isPostedTopLevel(),
  };
}

function buildWorkerTools(ctx: WorkerToolContext): ClackWorkerToolsResult {
  // Worker-side intent store — mirrors query mode (a fresh store per build, drained via
  // getStagedIntents after the run). Today only propose_spinoff stages into it.
  const intentStore = createIntentStore();

  // Tool factories return different SdkMcpToolDefinition<T> generics; `any` required for the heterogeneous array
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: SdkMcpToolDefinition<any>[] = [];

  // report_status is available in all worker modes
  tools.push(createReportStatusTool(ctx));

  tools.push(createGitPushTool(ctx));
  tools.push(createAwaitCiTool(ctx));
  tools.push(createEnsurePRTool(ctx));
  tools.push(createMergePRTool(ctx));
  tools.push(createClosePRTool(ctx));
  tools.push(createResolveReviewThreadTool(ctx));
  tools.push(createProposeSpinoffTool(ctx, intentStore));
  tools.push(createWorkerLoadSkillTool(ctx));

  // Memory faculty — workers tag their task so in-flight work is visible in memory.
  tools.push(createRememberTool());

  const toolNames = tools.map((t) => t.name);

  const mcpServer = createSdkMcpServer({
    name: "clack",
    version: "1.0.0",
    tools,
  });

  return {
    mcpServer,
    toolNames,
    getResult: () => null,
    getRenderedBlocks: () => null,
    getStagedIntents: () => intentStore.getAll(),
    getToolCallHistory: () => [],
    isSkipped: () => false,
    getAttentionLevel: () => null,
    getDeliveryMode: () => null,
    isPostedTopLevel: () => false,
  };
}

/**
 * Build a fresh clack MCP tool server.
 * Dispatches to query or worker tool set based on the context mode.
 */
export function buildClackTools(ctx: QueryToolContext): ClackQueryToolsResult;
export function buildClackTools(ctx: WorkerToolContext): ClackWorkerToolsResult;
export function buildClackTools(ctx: ToolBuildContext): ClackToolsResult;
export function buildClackTools(ctx: ToolBuildContext): ClackToolsResult {
  if (ctx.mode === "query") {
    return buildQueryTools(ctx);
  }
  return buildWorkerTools(ctx);
}
