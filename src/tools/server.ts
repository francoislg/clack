import { randomBytes } from "node:crypto";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import type { SdkMcpToolDefinition } from "@anthropic-ai/claude-agent-sdk";
import type {
  StagedIntent,
  ToolCallRecord,
  SubmitResponsePayload,
  ClackToolsResult,
  ToolContext,
} from "./types.js";
import { canRequestChanges } from "../permissions.js";

// Query tools
import { createListRepositoriesTool } from "./query/listRepositories.js";
import { createFindSessionsTool } from "./query/findSessions.js";
import { createFindChangesTool } from "./query/findChanges.js";
import { createListConfigFilesTool } from "./query/listConfigFiles.js";

// Action tools
import { createProposeChangeTool } from "./actions/proposeChange.js";
import { createProposeConfigUpdateTool } from "./actions/proposeConfigUpdate.js";
import { createRequestReviewTool } from "./actions/requestReview.js";
import { createRequestMergeTool } from "./actions/requestMerge.js";
import { createRequestUpdateTool } from "./actions/requestUpdate.js";
import { createRequestCloseTool } from "./actions/requestClose.js";

// Presentation tool
import { createSubmitResponseTool } from "./presentation/submitResponse.js";

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

/**
 * Build a fresh clack MCP tool server for a single query.
 * Tools are gated by role and context per design decision D8.
 *
 * | Role                    | Query tools       | Action tools                                              | Presentation    |
 * |-------------------------|-------------------|-----------------------------------------------------------|-----------------|
 * | member                  | list_repositories | —                                                         | submit_response |
 * | dev                     | all query tools   | propose_change                                            | submit_response |
 * | dev (in change thread)  | all query tools   | propose_change, request_review/merge/update/close          | submit_response |
 * | admin/owner             | all query tools   | propose_change, propose_config_update                     | submit_response |
 */
export function buildClackTools(ctx: ToolContext): ClackToolsResult {
  const intentStore = createIntentStore();
  const recorder = createToolCallRecorder();
  const responseCapture = createResponseCapture();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: SdkMcpToolDefinition<any>[] = [];

  // --- Query tools ---
  // list_repositories is available to all roles
  tools.push(createListRepositoriesTool(ctx));

  // Remaining query tools available to dev+ roles
  if (canRequestChanges(ctx.role)) {
    tools.push(createFindSessionsTool(ctx));
    tools.push(createFindChangesTool(ctx));
  }

  // list_config_files available to admin/owner
  if (ctx.role === "admin" || ctx.role === "owner") {
    tools.push(createListConfigFilesTool(ctx));
  }

  // --- Action tools ---
  // propose_change available to dev+ when changes workflow is enabled
  if (canRequestChanges(ctx.role) && ctx.changesWorkflowEnabled) {
    tools.push(createProposeChangeTool(ctx, intentStore, recorder));
  }

  // Change thread follow-up tools (only when in a change thread with a session)
  if (ctx.changeSession) {
    tools.push(createRequestReviewTool(ctx, intentStore, recorder));
    tools.push(createRequestMergeTool(ctx, intentStore, recorder));
    tools.push(createRequestUpdateTool(ctx, intentStore, recorder));
    tools.push(createRequestCloseTool(ctx, intentStore, recorder));
  }

  // propose_config_update available to admin/owner
  if (ctx.role === "admin" || ctx.role === "owner") {
    tools.push(createProposeConfigUpdateTool(ctx, intentStore, recorder));
  }

  // --- Presentation tool ---
  // submit_response is always available
  tools.push(createSubmitResponseTool(intentStore, responseCapture, recorder, ctx.session.sessionId));

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
