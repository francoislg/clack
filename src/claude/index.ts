import { type McpServerConfig, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { clackSession } from "./query.js";
import { getConfig, getRepositoriesDir } from "../config.js";
import { ClaudeMessageParser, detectPlatformError } from "./messageParser.js";
import { buildSystemPrompt, buildPrompt } from "./promptBuilder.js";
import { detectRuntime } from "./utilities.js";
import { errorMessage } from "../errors.js";
import { logger } from "../logger.js";
import { loadMcpServers } from "../mcp.js";
import type { UserRole } from "../roles.js";
import type { SessionContext } from "../sessions.js";
import { updateSession } from "../sessions.js";
import type {
  SubmitResponsePayload,
  ToolCallRecord,
  StagedIntent,
  DeliverFn,
  ClackToolsResult,
} from "../tools/types.js";
import type { StreamEvent } from "../streaming/types.js";
import type { SlackImageFile, SlackFile } from "../slack/slackFileBase.js";
import { buildQueryContext } from "../tools/context.js";
import { buildClackTools } from "../tools/server.js";
import { discoverPlugins } from "../plugins.js";

export interface ConversationMessage {
  type: string;
  subtype?: string;
  content: string;
  timestamp: number;
  /** Typed tool call record (for clack tool calls) */
  toolCall?: { tool: string; args: Record<string, unknown>; result: Record<string, unknown> };
}

export interface ErrorRecord {
  timestamp: number;
  errorMessage: string;
  conversationTrace: ConversationMessage[];
}

export interface ClaudeResponse {
  success: boolean;
  answer: string;
  error?: string;
  /** True when the request was aborted via AbortController (not a real error) */
  cancelled?: boolean;
  /** True when Claude chose to skip the response via submit_response skip_response flag */
  skipped?: boolean;
  conversationTrace?: ConversationMessage[];
  /** Structured response from submit_response tool */
  response?: SubmitResponsePayload;
  /** Pre-rendered and validated Slack blocks from submit_response */
  renderedBlocks?: Record<string, unknown>[];
  /** Staged intents from action tools (serializable for session persistence) */
  stagedIntents?: Record<string, StagedIntent>;
  /** Tool call history from this query */
  toolCallHistory?: ToolCallRecord[];
}

export interface AskClaudeOptions {
  role?: UserRole;
  changesWorkflowEnabled?: boolean;
  /** When true, hints Claude to propose a change with auto-execute */
  workMode?: boolean;
  /** Slack WebClient for tools that need Slack API access (e.g., find_user) */
  slackClient?: import("@slack/bolt").App["client"];
  /** AbortController for cancelling in-flight queries */
  abortController?: AbortController;
  /** Callback for real-time streaming events (tool calls, text) */
  onEvent?: (event: StreamEvent) => void | Promise<void>;
  /** Delivery callback — when provided, submit_response delivers to Slack directly */
  deliver?: DeliverFn;
  /** Available Slack images keyed by file ID */
  availableImages?: Map<string, SlackImageFile>;
  /** Available non-image Slack files keyed by file ID */
  availableFiles?: Map<string, SlackFile>;
  /** User's IANA timezone (e.g., "America/New_York") for time-aware prompts */
  userTimezone?: string;
}

function summarizeContentBlocks(content: unknown[]): string {
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
      parts.push(block.text.substring(0, 500));
    }
    if (block && typeof block === "object" && "type" in block) {
      parts.push(`[${block.type}]`);
    }
  }
  return parts.join(" ").substring(0, 1000);
}

function hasProperty<K extends string>(obj: unknown, key: K): obj is Record<K, unknown> {
  return typeof obj === "object" && obj !== null && key in obj;
}

function summarizeMessageContent(message: unknown): string {
  if (hasProperty(message, "message") && hasProperty(message.message, "content")) {
    if (Array.isArray(message.message.content)) {
      return summarizeContentBlocks(message.message.content);
    }
  }

  if (hasProperty(message, "result") && typeof message.result === "string") {
    return message.result.substring(0, 1000);
  }

  if (hasProperty(message, "errors") && Array.isArray(message.errors)) {
    return `Errors: ${message.errors.join(", ")}`;
  }

  return JSON.stringify(message).substring(0, 500);
}

interface QuerySetup {
  reposDir: string;
  systemPrompt: string;
  userPrompt: string;
  model: string | undefined;
  clackTools: ClackToolsResult;
  mcpServers: Record<string, McpServerConfig>;
}

async function buildQuerySetup(
  session: SessionContext,
  options?: AskClaudeOptions,
): Promise<QuerySetup> {
  const config = getConfig();
  const reposDir = getRepositoriesDir();
  const externalMcpServers = await loadMcpServers();

  const systemPrompt = buildSystemPrompt(options);
  const userPrompt = buildPrompt(session, options);

  // Build clack tool server for this query
  const toolCtx = buildQueryContext({
    userId: session.userId,
    role: options?.role ?? "member",
    session,
    config,
    changesWorkflowEnabled: options?.changesWorkflowEnabled ?? false,
    allowScheduledMessages: config.allowScheduledMessages ?? false,
    slackClient: options?.slackClient,
    deliver: options?.deliver,
    availableImages: options?.availableImages,
    availableFiles: options?.availableFiles,
  });
  const clackTools = buildClackTools(toolCtx);

  // Merge external MCP servers with the clack tool server
  const mcpServers: Record<string, McpServerConfig> = {
    ...externalMcpServers,
    clack: clackTools.mcpServer as McpServerConfig,
  };

  return {
    reposDir,
    systemPrompt,
    userPrompt,
    model: config.claudeCode.model,
    clackTools,
    mcpServers,
  };
}

function recordTraceEntry(
  message: SDKMessage,
  parsed: { toolUses: Array<{ name: string; args: Record<string, unknown> }> },
): ConversationMessage {
  const entry: ConversationMessage = {
    type: message.type,
    subtype: "subtype" in message ? String(message.subtype) : undefined,
    content: summarizeMessageContent(message),
    timestamp: Date.now(),
  };

  if (parsed.toolUses.length > 0) {
    const first = parsed.toolUses[0];
    entry.toolCall = { tool: first.name, args: first.args, result: {} };
  }

  return entry;
}

function buildToolResults(clackTools: ClackToolsResult): {
  structuredResponse: SubmitResponsePayload | undefined;
  renderedBlocks: Record<string, unknown>[] | undefined;
  stagedIntents: Record<string, StagedIntent>;
  toolCallHistory: ToolCallRecord[];
} {
  const structuredResponse = clackTools.getResult() ?? undefined;
  const renderedBlocks = clackTools.getRenderedBlocks() ?? undefined;
  const toolCallHistory = clackTools.getToolCallHistory();

  // Convert Map to plain object for serialization
  const stagedIntents: Record<string, StagedIntent> = {};
  for (const [ref, intent] of clackTools.getStagedIntents()) {
    stagedIntents[ref] = intent;
  }

  return { structuredResponse, renderedBlocks, stagedIntents, toolCallHistory };
}

function buildSuccessResponse(
  answer: string,
  conversationTrace: ConversationMessage[],
  clackTools: ClackToolsResult,
): ClaudeResponse {
  // Skip check must come before structuredResponse — when skipped,
  // responseCapture.get() returns null so structuredResponse is absent.
  if (clackTools.isSkipped()) {
    return {
      success: true,
      skipped: true,
      answer: "",
      conversationTrace,
    };
  }

  const { structuredResponse, renderedBlocks, stagedIntents, toolCallHistory } =
    buildToolResults(clackTools);
  const optionalToolHistory = toolCallHistory.length > 0 ? toolCallHistory : undefined;
  const optionalIntents = Object.keys(stagedIntents).length > 0 ? stagedIntents : undefined;

  // If submit_response was called, use the structured response
  if (structuredResponse) {
    const answerText = structuredResponse.sections
      .map((s) => (s.title ? `**${s.title}**\n${s.body}` : s.body))
      .join("\n\n");

    return {
      success: true,
      answer: answerText,
      conversationTrace,
      response: structuredResponse,
      renderedBlocks,
      stagedIntents: optionalIntents,
      toolCallHistory: optionalToolHistory,
    };
  }

  // No submit_response called — return raw text
  if (answer.trim()) {
    return {
      success: true,
      answer: answer.trim(),
      conversationTrace,
      toolCallHistory: optionalToolHistory,
    };
  }

  return {
    success: false,
    answer: "",
    error: "No response received from Claude",
    conversationTrace,
    toolCallHistory: optionalToolHistory,
  };
}

function handleQueryError(
  error: unknown,
  sessionId: string,
  conversationTrace: ConversationMessage[],
  abortController?: AbortController,
): ClaudeResponse {
  // Detect cancellation via AbortController
  const isAbortError = error instanceof Error && error.name === "AbortError";
  const isSignalAbort =
    abortController?.signal.aborted && error instanceof Error && /aborted/i.test(error.message);

  if (isAbortError || isSignalAbort) {
    logger.info(`Claude query cancelled for session ${sessionId}`);
    return {
      success: false,
      cancelled: true,
      answer: "",
      conversationTrace,
    };
  }

  logger.error("Claude Agent SDK error:", error);
  return {
    success: false,
    answer: "",
    error: `Claude Agent SDK error: ${errorMessage(error)}`,
    conversationTrace,
  };
}

export async function askClaude(
  session: SessionContext,
  options?: AskClaudeOptions,
): Promise<ClaudeResponse> {
  const { reposDir, systemPrompt, userPrompt, model, clackTools, mcpServers } =
    await buildQuerySetup(session, options);

  logger.debug(`Querying Claude via Agent SDK for session ${session.sessionId}...`);

  const conversationTrace: ConversationMessage[] = [];

  try {
    let answer = "";
    const parser = new ClaudeMessageParser(options?.onEvent);

    // Compute lastSeenThreadTs before the query starts
    const lastSeenTs = session.threadContext?.length
      ? session.threadContext[session.threadContext.length - 1].ts
      : undefined;

    for await (const message of clackSession({
      prompt: userPrompt,
      resumeSessionId: session.sdkSessionId,
      onSessionId: (id) => {
        updateSession(session.sessionId, { sdkSessionId: id }).catch((err) =>
          logger.warn(`Failed to save sdkSessionId: ${errorMessage(err)}`),
        );
      },
      options: {
        cwd: reposDir,
        executable: detectRuntime(),
        systemPrompt,
        model,
        permissionMode: "bypassPermissions",
        tools: ["Read", "Glob", "Grep", "Skill"],
        plugins: discoverPlugins(),
        mcpServers,
        ...(options?.abortController && { abortController: options.abortController }),
      },
    })) {
      const parsed = await parser.process(message);

      conversationTrace.push(recordTraceEntry(message, parsed));

      // Handle result
      if (parser.result) {
        if (parser.result.success) {
          answer = parser.result.text || parser.lastAssistantText;
        } else {
          return {
            success: false,
            answer: "",
            error: `Claude query failed: ${parser.result.error}`,
            conversationTrace,
          };
        }
      }
    }

    // Check for platform errors masquerading as successful responses
    const platformError =
      detectPlatformError(answer) ?? detectPlatformError(parser.lastAssistantText);
    if (platformError) {
      logger.warn(`Platform error detected: ${platformError}`);
      return {
        success: false,
        answer: "",
        error: platformError,
        conversationTrace,
      };
    }

    // Persist lastSeenThreadTs so the next resumed query only injects delta context
    if (lastSeenTs) {
      updateSession(session.sessionId, { lastSeenThreadTs: lastSeenTs }).catch((err) =>
        logger.warn(`Failed to save lastSeenThreadTs: ${errorMessage(err)}`),
      );
    }

    return buildSuccessResponse(answer, conversationTrace, clackTools);
  } catch (error) {
    return handleQueryError(error, session.sessionId, conversationTrace, options?.abortController);
  }
}
