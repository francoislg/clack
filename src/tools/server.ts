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
} from "./types.js";
import { meetsMinimumRole } from "../permissions.js";
import { getLoadedPlugins } from "../plugins/state.js";
import { logger } from "../logger.js";
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { asSlackBlocks } from "../slack/blocks.js";
import type { SlackBlocks } from "../slack/blocks.js";
import { updateSession, getSession } from "../sessions.js";
import type { SessionContext } from "../sessions.js";
import { canRequestChanges, canEditConfig } from "../permissions.js";

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
import { createUsersCache } from "../slack/usersCache.js";
import { createEmojiCache } from "../slack/emojiCache.js";
import { createChannelsCache } from "../slack/channelsCache.js";

// Action tools
import { createProposeChangeTool } from "./actions/proposeChange.js";
import { createProposeConfigUpdateTool } from "./actions/proposeConfigUpdate.js";
import { createRequestUpdateTool } from "./actions/requestUpdate.js";
import { createScheduleReminderTool } from "./actions/scheduleReminder.js";
import { createCancelReminderTool } from "./actions/cancelReminder.js";
import { createCreateScheduledMessageTool } from "./actions/createScheduledMessage.js";
import { createCancelScheduledMessageTool } from "./actions/cancelScheduledMessage.js";
import { createUpdateScheduledMessageTool } from "./actions/updateScheduledMessage.js";
import { createCancelWorkerRunTool } from "./actions/cancelWorkerRun.js";

// Admin tools
import { createAdminReadFileTool } from "./admin/adminReadFile.js";
import { createAdminWriteFileTool } from "./admin/adminWriteFile.js";
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
import { createGetScheduledMessageRunsTool } from "./query/getScheduledMessageRuns.js";
import { createFindRecentInteractionsTool } from "./query/findRecentInteractions.js";
import { createFindSessionTranscriptTool } from "./query/findSessionTranscript.js";

// Presentation tool
import { createSubmitResponseTool } from "./presentation/submitResponse.js";

// Worker tools
import { createGitPushTool } from "./worker/gitPush.js";
import { createEnsurePRTool } from "./worker/ensurePR.js";
import { createMergePRTool } from "./worker/mergePR.js";
import { createClosePRTool } from "./worker/closePR.js";
import { createReportStatusTool } from "./worker/reportStatus.js";

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
  setDisengaged: () => void;
  setPostedTopLevel: () => void;
  isSkipped: () => boolean;
  isDisengaged: () => boolean;
  isPostedTopLevel: () => boolean;
}

export function createResponseCapture(): ResponseCapture {
  let result: SubmitResponsePayload | null = null;
  let blocks: SlackBlocks | null = null;
  let skipped = false;
  let disengaged = false;
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

    setDisengaged(): void {
      disengaged = true;
    },

    setPostedTopLevel(): void {
      postedTopLevel = true;
    },

    isSkipped(): boolean {
      return skipped;
    },

    isDisengaged(): boolean {
      return disengaged;
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
 * Combines the default policy (`shouldAllowSkip`) with a per-job opt-in for scheduled runs
 * that declare `skipConditions`. Extracted for testability — the override itself is trivial,
 * but it's worth pinning behavior explicitly because the schema changes based on the result.
 */
export function computeAllowSkip(triggerType: TriggerType, skipConditions?: string): boolean {
  if (shouldAllowSkip(triggerType)) return true;
  return triggerType === "scheduled" && !!skipConditions && skipConditions.length > 0;
}

/**
 * Disengage is meaningful wherever `autoResponseActive` has runtime effect — the skippable
 * triggers plus channel mentions, where a user can dismiss Clack ("thanks, you're done")
 * and expect the thread to stop getting auto-respond replies.
 */
export function shouldAllowDisengage(triggerType: TriggerType): boolean {
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
    tools.push(createAdminRestartAppTool());
    tools.push(createAdminSetEnvTool());
    tools.push(createAdminListEnvTool());
    tools.push(createAdminSetRoleTool());
    tools.push(createListErrorReportsTool());
    tools.push(createReadErrorReportTool());
    if (ctx.slackClient) {
      tools.push(createAdminDeleteMessageTool(ctx));
    }
  }

  // --- Scheduled message tools (no role gating, config-gated) ---
  if (ctx.allowScheduledMessages && ctx.slackClient) {
    tools.push(createScheduleReminderTool(ctx));
    tools.push(createListRemindersTool(ctx));
    tools.push(createCancelReminderTool(ctx));
    tools.push(createCreateScheduledMessageTool(ctx));
    tools.push(createListScheduledMessagesTool(ctx));
    tools.push(createGetScheduledMessageRunsTool(ctx));
    tools.push(createCancelScheduledMessageTool(ctx));
    tools.push(createUpdateScheduledMessageTool(ctx));
  }

  // --- Plugin tools: one dedicated MCP server per plugin, with handlers wrapped to auto-record.
  // Tools live in their own namespace (`mcp__<plugin>__<tool>`), so plugin-vs-core and
  // plugin-vs-plugin name collisions are structurally impossible.
  const pluginMcpServers: Record<string, McpSdkServerConfigWithInstance> = {};
  const pluginToolFullNames: string[] = [];
  const pluginResults = getLoadedPlugins().results;
  for (const plugin of pluginResults) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pluginTools: SdkMcpToolDefinition<any>[] = [];
    for (const registered of plugin.tools) {
      if (!meetsMinimumRole(ctx.role, registered.minRole)) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const collected: SdkMcpToolDefinition<any>[] = [];
      registered.pushTo(collected);
      for (const toolDef of collected) {
        const fullName = `mcp__${plugin.name}__${toolDef.name}`;
        pluginToolFullNames.push(fullName);
        pluginTools.push(wrapToolForRecording(toolDef, fullName, recorder));
      }
    }
    if (pluginTools.length === 0) continue;
    pluginMcpServers[plugin.name] = createSdkMcpServer({
      name: plugin.name,
      version: "1.0.0",
      tools: pluginTools,
    });
  }

  // --- Presentation tool ---
  const persistSnapshot = async (id: string, snapshot: ResponseSnapshot): Promise<void> => {
    const session = await getSession(ctx.session.sessionId);
    if (!session) return;
    const snapshots = { ...session.snapshots, [id]: snapshot };
    await updateSession(ctx.session.sessionId, { snapshots });
  };
  const triggerType = ctx.session.triggerType;
  tools.push(
    createSubmitResponseTool({
      intentStore,
      responseCapture,
      recorder,
      sessionId: ctx.session.sessionId,
      deliver: ctx.deliver,
      persistSnapshot,
      // In scheduled mode, submit_response delivers top-level to the channel.
      // Pass the channel so post_to validation can reject duplicates.
      topLevelDeliveryChannel: triggerType === "scheduled" ? ctx.session.channelId : undefined,
      sessionChannelId: ctx.session.channelId,
      allowSkip: computeAllowSkip(triggerType, ctx.skipConditions),
      allowDisengage: shouldAllowDisengage(triggerType),
      allowPostTopLevel: shouldAllowPostTopLevel(triggerType),
      requiredTools: ctx.requiredTools,
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
    isDisengaged: () => responseCapture.isDisengaged(),
    isPostedTopLevel: () => responseCapture.isPostedTopLevel(),
  };
}

function buildWorkerTools(ctx: WorkerToolContext): ClackWorkerToolsResult {
  // Tool factories return different SdkMcpToolDefinition<T> generics; `any` required for the heterogeneous array
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: SdkMcpToolDefinition<any>[] = [];

  // report_status is available in all worker modes
  tools.push(createReportStatusTool(ctx));

  tools.push(createGitPushTool(ctx));
  tools.push(createEnsurePRTool(ctx));
  tools.push(createMergePRTool(ctx));
  tools.push(createClosePRTool(ctx));
  tools.push(createResolveReviewThreadTool(ctx));

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
    getStagedIntents: () => new Map(),
    getToolCallHistory: () => [],
    isSkipped: () => false,
    isDisengaged: () => false,
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
