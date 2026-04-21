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
import type { SlackBlocks } from "../slack/blocks.js";
import { extractDisplayText } from "../slack/blockText.js";
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
  /** True when Claude chose to disengage from the thread (skip + stop tracking) */
  disengaged?: boolean;
  conversationTrace?: ConversationMessage[];
  /** Captured stderr output from the Claude Code process */
  stderrOutput?: string;
  /** Structured response from submit_response tool */
  response?: SubmitResponsePayload;
  /** Pre-rendered and validated Slack blocks from submit_response */
  renderedBlocks?: SlackBlocks;
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
  /**
   * Fully-qualified MCP tool names that must be called during this run before `submit_response`
   * will be accepted (e.g., `mcp__trivia__submit_answers`). Threaded into the query context.
   */
  requiredTools?: string[];
  /**
   * Free-form skip conditions for scheduled runs. When non-empty, the prompt builder injects
   * a pre-check section and `submit_response` exposes `skip_response`. Ignored for non-scheduled
   * triggers.
   */
  skipConditions?: string;
  /**
   * Fires once per completed tool call (when its `tool_result` arrives from the SDK stream).
   * Populated for ALL tools the SDK dispatches — built-ins, clack MCP, plugin MCP, external MCP.
   * Use this to persist tool calls to the session incrementally for live debugging.
   */
  onToolCall?: (record: ToolCallRecord) => void | Promise<void>;
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
    requiredTools: options?.requiredTools,
    skipConditions: options?.skipConditions,
  });
  const clackTools = buildClackTools(toolCtx);

  // Merge external MCP servers with the clack + per-plugin tool servers
  const mcpServers: Record<string, McpServerConfig> = {
    ...externalMcpServers,
    ...(clackTools.mcpServers as Record<string, McpServerConfig>),
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

function optionalHistory(history: ToolCallRecord[]): ToolCallRecord[] | undefined {
  return history.length > 0 ? history : undefined;
}

function buildToolResults(clackTools: ClackToolsResult): {
  structuredResponse: SubmitResponsePayload | undefined;
  renderedBlocks: SlackBlocks | undefined;
  stagedIntents: Record<string, StagedIntent>;
} {
  const structuredResponse = clackTools.getResult() ?? undefined;
  const renderedBlocks = clackTools.getRenderedBlocks() ?? undefined;

  // Convert Map to plain object for serialization
  const stagedIntents: Record<string, StagedIntent> = {};
  for (const [ref, intent] of clackTools.getStagedIntents()) {
    stagedIntents[ref] = intent;
  }

  return { structuredResponse, renderedBlocks, stagedIntents };
}

function buildSuccessResponse(
  answer: string,
  conversationTrace: ConversationMessage[],
  clackTools: ClackToolsResult,
  streamToolHistory: ToolCallRecord[],
): ClaudeResponse {
  // Skip check must come before structuredResponse — when skipped,
  // responseCapture.get() returns null so structuredResponse is absent.
  if (clackTools.isSkipped()) {
    return {
      success: true,
      skipped: true,
      disengaged: clackTools.isDisengaged() || undefined,
      answer: "",
      conversationTrace,
      toolCallHistory: optionalHistory(streamToolHistory),
    };
  }

  const { structuredResponse, renderedBlocks, stagedIntents } = buildToolResults(clackTools);
  const optionalToolHistory = optionalHistory(streamToolHistory);
  const optionalIntents = Object.keys(stagedIntents).length > 0 ? stagedIntents : undefined;

  // If submit_response was called, use the structured response
  if (structuredResponse) {
    const answerText = extractDisplayText(structuredResponse.blocks);

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
  stderrOutput: string,
  streamToolHistory: ToolCallRecord[],
  abortController?: AbortController,
): ClaudeResponse {
  const toolHistory = optionalHistory(streamToolHistory);
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
      toolCallHistory: toolHistory,
    };
  }

  logger.error("Claude Agent SDK error:", error);
  if (stderrOutput) {
    logger.warn(`Claude stderr output:\n${stderrOutput}`);
  }
  return {
    success: false,
    answer: "",
    error: `Claude Agent SDK error: ${errorMessage(error)}`,
    conversationTrace,
    stderrOutput: stderrOutput || undefined,
    toolCallHistory: toolHistory,
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
  const stderrLines: string[] = [];
  const streamToolHistory: ToolCallRecord[] = [];

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
        tools: ["Read", "Glob", "Grep", "Skill", "WebSearch"],
        plugins: discoverPlugins(),
        mcpServers,
        stderr: (data) => stderrLines.push(data),
        ...(options?.abortController && { abortController: options.abortController }),
      },
    })) {
      const parsed = await parser.process(message);

      conversationTrace.push(recordTraceEntry(message, parsed));

      for (const completed of parsed.completedToolCalls) {
        streamToolHistory.push(completed);
        // Fire-and-forget: we don't want a slow `updateSession` (disk contention, etc.) to stall
        // the SDK stream. Errors are logged, not surfaced to callers.
        if (options?.onToolCall) {
          void Promise.resolve(options.onToolCall(completed)).catch((err) => {
            logger.warn(`onToolCall handler threw: ${errorMessage(err)}`);
          });
        }
      }

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
            toolCallHistory: optionalHistory(streamToolHistory),
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
        toolCallHistory: optionalHistory(streamToolHistory),
      };
    }

    // Persist lastSeenThreadTs so the next resumed query only injects delta context
    if (lastSeenTs) {
      updateSession(session.sessionId, { lastSeenThreadTs: lastSeenTs }).catch((err) =>
        logger.warn(`Failed to save lastSeenThreadTs: ${errorMessage(err)}`),
      );
    }

    return buildSuccessResponse(answer, conversationTrace, clackTools, streamToolHistory);
  } catch (error) {
    const stderrOutput = stderrLines.join("");
    return handleQueryError(
      error,
      session.sessionId,
      conversationTrace,
      stderrOutput,
      streamToolHistory,
      options?.abortController,
    );
  }
}
