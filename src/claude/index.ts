import { query, type McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { getConfig, getRepositoriesDir } from "../config.js";
import { ClaudeMessageParser, detectPlatformError } from "./messageParser.js";
import { buildSystemPrompt, buildPrompt } from "./promptBuilder.js";
import { errorMessage } from "../errors.js";
import { logger } from "../logger.js";
import { loadMcpServers } from "../mcp.js";
import type { UserRole } from "../roles.js";
import type { SessionContext } from "../sessions.js";
import type { SubmitResponsePayload, ToolCallRecord, StagedIntent, DeliverFn, ClackToolsResult } from "../tools/types.js";
import type { StreamEvent } from "../streaming/types.js";
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

function summarizeMessageContent(message: unknown): string {
  const msg = message as Record<string, unknown>;

  if (msg.message && typeof msg.message === "object") {
    const innerContent = (msg.message as Record<string, unknown>).content;
    if (Array.isArray(innerContent)) {
      return summarizeContentBlocks(innerContent);
    }
  }

  if (msg.result && typeof msg.result === "string") {
    return msg.result.substring(0, 1000);
  }

  if (msg.errors && Array.isArray(msg.errors)) {
    return `Errors: ${msg.errors.join(", ")}`;
  }

  return JSON.stringify(msg).substring(0, 500);
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
  options?: AskClaudeOptions
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
    slackClient: options?.slackClient,
    deliver: options?.deliver,
  });
  const clackTools = buildClackTools(toolCtx);

  // Merge external MCP servers with the clack tool server
  const mcpServers: Record<string, McpServerConfig> = {
    ...(externalMcpServers ?? {}),
    clack: clackTools.mcpServer as McpServerConfig,
  };

  return { reposDir, systemPrompt, userPrompt, model: config.claudeCode.model, clackTools, mcpServers };
}

function recordTraceEntry(
  message: { type: string; [key: string]: unknown },
  parsed: { toolUses: Array<{ name: string; args: Record<string, unknown> }> }
): ConversationMessage {
  const entry: ConversationMessage = {
    type: message.type,
    subtype: "subtype" in message ? (message.subtype as string) : undefined,
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
  clackTools: ClackToolsResult
): ClaudeResponse {
  const { structuredResponse, renderedBlocks, stagedIntents, toolCallHistory } = buildToolResults(clackTools);
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
  abortController?: AbortController
): ClaudeResponse {
  // Detect cancellation via AbortController
  const isAbortError = error instanceof Error && error.name === "AbortError";
  const isSignalAbort = abortController?.signal.aborted &&
    error instanceof Error && /aborted/i.test(error.message);

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
  options?: AskClaudeOptions
): Promise<ClaudeResponse> {
  const { reposDir, systemPrompt, userPrompt, model, clackTools, mcpServers } =
    await buildQuerySetup(session, options);

  logger.debug(`Querying Claude via Agent SDK for session ${session.sessionId}...`);

  const conversationTrace: ConversationMessage[] = [];

  try {
    let answer = "";
    const parser = new ClaudeMessageParser(options?.onEvent);

    for await (const message of query({
      prompt: userPrompt,
      options: {
        cwd: reposDir,
        executable: process.execPath as "node",
        systemPrompt,
        model,
        permissionMode: "bypassPermissions",
        tools: ["Read", "Glob", "Grep", "Skill"],
        plugins: discoverPlugins(),
        mcpServers,
        ...(options?.abortController && { abortController: options.abortController }),
      },
    })) {
      const typedMessage = message as { type: string; [key: string]: unknown };
      const parsed = await parser.process(typedMessage);

      conversationTrace.push(recordTraceEntry(typedMessage, parsed));

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
    const platformError = detectPlatformError(answer) ?? detectPlatformError(parser.lastAssistantText);
    if (platformError) {
      logger.warn(`Platform error detected: ${platformError}`);
      return {
        success: false,
        answer: "",
        error: platformError,
        conversationTrace,
      };
    }

    return buildSuccessResponse(answer, conversationTrace, clackTools);
  } catch (error) {
    return handleQueryError(error, session.sessionId, conversationTrace, options?.abortController);
  }
}
