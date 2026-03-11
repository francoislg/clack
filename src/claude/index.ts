import { query } from "@anthropic-ai/claude-agent-sdk";
import { getConfig, getRepositoriesDir } from "../config.js";
import { ClaudeMessageParser, detectPlatformError } from "./messageParser.js";
import { buildSystemPrompt, buildPrompt } from "./promptBuilder.js";
import { errorMessage } from "../errors.js";
import { logger } from "../logger.js";
import { loadMcpServers } from "../mcp.js";
import type { UserRole } from "../roles.js";
import type { SessionContext } from "../sessions.js";
import type { SubmitResponsePayload, ToolCallRecord, StagedIntent, DeliverFn } from "../tools/types.js";
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

function summarizeMessageContent(message: unknown): string {
  // Safely extract a content summary from various message types
  const msg = message as Record<string, unknown>;

  if (msg.message && typeof msg.message === "object") {
    const innerMsg = msg.message as Record<string, unknown>;
    if (Array.isArray(innerMsg.content)) {
      const textParts: string[] = [];
      for (const block of innerMsg.content) {
        if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
          textParts.push(block.text.substring(0, 500)); // Truncate long text
        }
        if (block && typeof block === "object" && "type" in block) {
          textParts.push(`[${block.type}]`);
        }
      }
      return textParts.join(" ").substring(0, 1000);
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

export async function askClaude(
  session: SessionContext,
  options?: AskClaudeOptions
): Promise<ClaudeResponse> {
  const config = getConfig();
  const reposDir = getRepositoriesDir();
  const externalMcpServers = await loadMcpServers();

  const systemPrompt = buildSystemPrompt(options);
  const userPrompt = buildPrompt(session, options);

  logger.debug(`Querying Claude via Agent SDK for session ${session.sessionId}...`);

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
  const mcpServers: Record<string, unknown> = {
    ...(externalMcpServers ?? {}),
    clack: clackTools.mcpServer,
  };

  // Collect conversation trace for debugging
  const conversationTrace: ConversationMessage[] = [];

  try {
    let answer = "";
    const parser = new ClaudeMessageParser(options?.onEvent);

    // Use the Agent SDK query function
    // Disallow write operations - this bot is read-only
    for await (const message of query({
      prompt: userPrompt,
      options: {
        cwd: reposDir,
        executable: process.execPath as "node",
        systemPrompt,
        model: config.claudeCode.model,
        permissionMode: "bypassPermissions",
        tools: ["Read", "Glob", "Grep", "Skill"],
        plugins: discoverPlugins(),
        mcpServers: mcpServers as Record<string, import("@anthropic-ai/claude-agent-sdk").McpServerConfig>,
        ...(options?.abortController && { abortController: options.abortController }),
      },
    })) {
      // Record all messages in the conversation trace
      const traceEntry: ConversationMessage = {
        type: message.type,
        subtype: "subtype" in message ? (message.subtype as string) : undefined,
        content: summarizeMessageContent(message),
        timestamp: Date.now(),
      };

      const parsed = await parser.process(message as { type: string; [key: string]: unknown });

      // Record first tool_use in trace entry
      if (parsed.toolUses.length > 0) {
        const first = parsed.toolUses[0];
        if (!traceEntry.toolCall) {
          traceEntry.toolCall = { tool: first.name, args: first.args, result: {} };
        }
      }

      conversationTrace.push(traceEntry);

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

    // Capture tool server results
    const structuredResponse = clackTools.getResult();
    const renderedBlocks = clackTools.getRenderedBlocks();
    const stagedIntentsMap = clackTools.getStagedIntents();
    const toolCallHistory = clackTools.getToolCallHistory();

    // Convert Map to plain object for serialization
    const stagedIntents: Record<string, StagedIntent> = {};
    for (const [ref, intent] of stagedIntentsMap) {
      stagedIntents[ref] = intent;
    }

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
        renderedBlocks: renderedBlocks ?? undefined,
        stagedIntents: Object.keys(stagedIntents).length > 0 ? stagedIntents : undefined,
        toolCallHistory: toolCallHistory.length > 0 ? toolCallHistory : undefined,
      };
    }

    // No submit_response called — return raw text
    if (answer.trim()) {
      return {
        success: true,
        answer: answer.trim(),
        conversationTrace,
        toolCallHistory: toolCallHistory.length > 0 ? toolCallHistory : undefined,
      };
    }

    return {
      success: false,
      answer: "",
      error: "No response received from Claude",
      conversationTrace,
      toolCallHistory: toolCallHistory.length > 0 ? toolCallHistory : undefined,
    };
  } catch (error) {
    // Detect cancellation via AbortController
    const isAbortError = error instanceof Error && error.name === "AbortError";
    const isSignalAbort = options?.abortController?.signal.aborted &&
      error instanceof Error && /aborted/i.test(error.message);

    if (isAbortError || isSignalAbort) {
      logger.info(`Claude query cancelled for session ${session.sessionId}`);
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
}
