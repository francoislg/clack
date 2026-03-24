import { randomBytes } from "node:crypto";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";

import type {
  StagedIntent,
  ToolCallRecord,
  SubmitResponsePayload,
  ResponseSnapshot,
  ClackToolsResult,
  ToolBuildContext,
  QueryToolContext,
  WorkerToolContext,
} from "./types.js";
import { updateSession, getSession } from "../sessions.js";
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
import { createFetchSlackMessageTool } from "./query/fetchSlackMessage.js";
import { createFetchChannelMessagesTool } from "./query/fetchChannelMessages.js";
import { createViewSlackImageTool } from "./query/viewSlackImage.js";
import { createViewSlackFileTool } from "./query/viewSlackFile.js";
import { createUploadFileTool } from "./query/uploadFile.js";
import { createUsersCache } from "../slack/usersCache.js";

// Action tools
import { createProposeChangeTool } from "./actions/proposeChange.js";
import { createProposeConfigUpdateTool } from "./actions/proposeConfigUpdate.js";
import { createRequestUpdateTool } from "./actions/requestUpdate.js";

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
  record: (tool: string, args: Record<string, unknown>, result: Record<string, unknown>) => void;
  getHistory: () => ToolCallRecord[];
}

export function createToolCallRecorder(): ToolCallRecorder {
  const history: ToolCallRecord[] = [];

  return {
    record(tool: string, args: Record<string, unknown>, result: Record<string, unknown>): void {
      history.push({ tool, args, result, timestamp: Date.now() });
    },

    getHistory(): ToolCallRecord[] {
      return [...history];
    },
  };
}

// ============================================================================
// Response Capture
// ============================================================================

export interface ResponseCapture {
  set: (payload: SubmitResponsePayload, renderedBlocks: Record<string, unknown>[]) => void;
  get: () => SubmitResponsePayload | null;
  getRenderedBlocks: () => Record<string, unknown>[] | null;
}

export function createResponseCapture(): ResponseCapture {
  let result: SubmitResponsePayload | null = null;
  let blocks: Record<string, unknown>[] | null = null;

  return {
    set(payload: SubmitResponsePayload, renderedBlocks: Record<string, unknown>[]): void {
      result = payload;
      blocks = renderedBlocks;
    },

    get(): SubmitResponsePayload | null {
      return result;
    },

    getRenderedBlocks(): Record<string, unknown>[] | null {
      return blocks;
    },
  };
}

// ============================================================================
// Build Clack Tools (MCP Server)
// ============================================================================

function buildQueryTools(ctx: QueryToolContext): ClackToolsResult {
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
    tools.push(createFetchSlackMessageTool(ctx));
    tools.push(createFetchChannelMessagesTool(ctx));
    tools.push(createUploadFileTool(ctx));
  }

  if (canRequestChanges(ctx.role)) {
    tools.push(createFindSessionsTool(ctx));
    tools.push(createFindChangesTool(ctx));
    tools.push(createFindPullRequestsTool(ctx));
    tools.push(createResolveReviewThreadTool(ctx));
  }

  if (canEditConfig(ctx.role)) {
    tools.push(createListConfigFilesTool(ctx));
    tools.push(createReadConfigFileTool(ctx));
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
    tools.push(createProposeChangeTool(ctx, intentStore, recorder));
    tools.push(createRequestUpdateTool(ctx, intentStore, recorder));
  }

  if (canEditConfig(ctx.role)) {
    tools.push(createProposeConfigUpdateTool(ctx, intentStore, recorder));
  }

  // --- Presentation tool ---
  const persistSnapshot = async (id: string, snapshot: ResponseSnapshot): Promise<void> => {
    const session = await getSession(ctx.session.sessionId);
    if (!session) return;
    const snapshots = { ...session.snapshots, [id]: snapshot };
    await updateSession(ctx.session.sessionId, { snapshots });
  };
  tools.push(createSubmitResponseTool({
    intentStore,
    responseCapture,
    recorder,
    sessionId: ctx.session.sessionId,
    deliver: ctx.deliver,
    persistSnapshot,
  }));

  const toolNames = tools.map((t) => t.name);

  const mcpServer = createSdkMcpServer({
    name: "clack",
    version: "1.0.0",
    tools,
  });

  return {
    mcpServer,
    toolNames,
    getResult: () => responseCapture.get(),
    getRenderedBlocks: () => responseCapture.getRenderedBlocks(),
    getStagedIntents: () => intentStore.getAll(),
    getToolCallHistory: () => recorder.getHistory(),
  };
}

function buildWorkerTools(ctx: WorkerToolContext): ClackToolsResult {
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
  };
}

/**
 * Build a fresh clack MCP tool server.
 * Dispatches to query or worker tool set based on the context mode.
 */
export function buildClackTools(ctx: ToolBuildContext): ClackToolsResult {
  if (ctx.mode === "query") {
    return buildQueryTools(ctx);
  }
  return buildWorkerTools(ctx);
}
