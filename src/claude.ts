import { query } from "@anthropic-ai/claude-agent-sdk";
import { getConfig, getRepositoriesDir } from "./config.js";
import { loadInstructions } from "./instructions.js";
import { logger } from "./logger.js";
import { loadMcpServers, getConfiguredMcpServerNames } from "./mcp.js";
import type { UserRole } from "./roles.js";
import type { SessionContext } from "./sessions.js";
import { formatUserIdentity } from "./slack/userCache.js";
import type { SubmitResponsePayload, ToolCallRecord, StagedIntent } from "./tools/types.js";
import type { StreamEvent } from "./streaming/types.js";
import { buildQueryContext } from "./tools/context.js";
import { buildClackTools } from "./tools/server.js";

/**
 * Detect known Claude platform error messages that arrive as "successful" text
 * (e.g. rate limits, quota exhaustion). These bypass the SDK's error handling
 * and look like normal assistant output.
 */
export function detectPlatformError(text: string): string | null {
  if (/you've\s+hit\s+your\s+limit/i.test(text) && /resets?\s+\d{1,2}/i.test(text)) {
    return "Claude usage limit reached. The limit resets automatically — please try again later.";
  }
  return null;
}

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
  onEvent?: (event: StreamEvent) => void;
}

export interface McpServerInfo {
  name: string;
  status: string;
}

export interface McpTestResult {
  success: boolean;
  configuredServers: string[];
  connectedServers: McpServerInfo[];
  failedServers: McpServerInfo[];
  tools: string[];
  mcpTools: string[];
  clackTools: string[];
  error?: string;
}

/**
 * Extract a short error message from a tool_result block's content field.
 * Returns undefined if content is empty or not extractable.
 */
export function extractToolErrorMessage(content: unknown): string | undefined {
  const MAX_LENGTH = 100;
  let text: string | undefined;

  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (block && typeof block === "object" && "text" in block && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
    text = parts.join(" ");
  }

  if (!text || !text.trim()) return undefined;
  text = text.trim();
  return text.length > MAX_LENGTH ? text.substring(0, MAX_LENGTH) + "…" : text;
}

function buildSystemPrompt(options?: AskClaudeOptions): string {
  const role: UserRole = options?.role ?? "member";
  const changesWorkflowEnabled = options?.changesWorkflowEnabled ?? false;
  const config = getConfig();

  const variables: Record<string, string> = {
    BOT_NAME: config.slackApp?.name || "Clack",
  };

  return loadInstructions(role, {
    changesWorkflowEnabled,
    variables,
  });
}

function formatThreadContext(messages: SessionContext["threadContext"]): string {
  if (messages.length === 0) return "";

  const formatted = messages.map((msg) => {
    const speaker = formatUserIdentity(msg.userId, {
      userId: msg.userId,
      username: msg.username,
      displayName: msg.displayName,
    });
    return `${speaker}: ${msg.text}`;
  });

  return formatted.join("\n\n");
}

function buildDeliveryContext(session: SessionContext): string | null {
  if (!session.triggerType) return null;

  const lines: string[] = ["DELIVERY CONTEXT:"];

  // DM-first: session has DM coordinates and an origin channel
  if (session.dmChannel && session.originChannel) {
    lines.push("- Mode: DM-first (reaction triggered, answer delivered via direct message)");
    lines.push("- The user sees your response in a private DM thread. They can reply to refine.");
    lines.push("- The response is NOT visible in the original channel — only the user can see it in this DM.");
    if (session.channelPostTs) {
      lines.push("- An answer was already shared to the original channel thread.");
    }
    lines.push("- `send_to_thread` shares this DM answer to the original channel thread the reaction was on. `reject` dismisses.");
    lines.push("- Choose actions appropriate to your response. Not every response needs the same buttons.");
  } else {
    // All non-DM-first modes: response is already where the user can see it
    if (session.triggerType === "reactions") {
      lines.push("- Mode: Thread (reaction triggered, answer posted in the channel thread)");
    } else if (session.triggerType === "directMessages") {
      lines.push("- Mode: Direct message (the user is chatting with you in a DM)");
    } else if (session.triggerType === "mentions") {
      lines.push("- Mode: Channel mention (the user @mentioned you in a channel)");
    }
    lines.push("- The response is already visible to the user. There is no separate destination to send it to.");
    lines.push("- Do NOT include `accept`, `reject`, or `send_to_thread` actions — they have no meaning here.");
  }

  return lines.join("\n");
}

function buildPrompt(session: SessionContext, options?: AskClaudeOptions): string {
  const parts: string[] = [];

  // Thread context first so Claude reads the conversation before the question
  if (session.threadContext.length > 0) {
    const contextIntro = `THREAD CONTEXT (previous messages in the Slack thread, in chronological order):
Messages may be attributed to specific users by name (e.g., [John Doe]) or as [User] if names are not available.
Messages marked [Clack Bot] are previous answers from you (this bot).
Use this context to understand the conversation flow and provide relevant answers.\n`;
    parts.push(contextIntro + formatThreadContext(session.threadContext));
  }

  // Delivery context — derived from session state (triggerType, dmChannel, etc.)
  const deliveryContext = buildDeliveryContext(session);
  if (deliveryContext) {
    parts.push(deliveryContext);
  }

  // Active change context — derived from the unified session's runtime state
  if (session.activeChange) {
    const ac = session.activeChange;
    const lines = [
      "ACTIVE CHANGE: There is an active code change in this thread.",
      `- Branch: ${ac.branch}`,
      `- Repository: ${ac.repo}`,
      `- Status: ${ac.status}`,
    ];
    if (ac.prUrl) {
      lines.push(`- PR: ${ac.prUrl}`);
    }
    lines.push(
      "",
      "To add more changes to this active worktree, use `request_update` (not `propose_change`).",
      "Only use `propose_change` if the user explicitly wants a separate, unrelated change on a different branch.",
    );
    parts.push(lines.join("\n"));
  }

  // GitHub MCP hint — Claude can use it for PR operations on any PR
  parts.push("GITHUB ACCESS: You have access to GitHub via MCP. You can merge, close, comment on, or review any PR — not just ones from active changes. Use GitHub MCP tools when the user asks about PR operations.");

  // Work mode hint — advisory only, does NOT change available tools
  if (options?.workMode) {
    if (session.activeChange) {
      parts.push(`WORK MODE: The user explicitly requested this as a work task. Since there is an active change in this thread, use request_update with auto: true on the update action in submit_response. If you cannot determine what change to make, ask for clarification via submit_response.`);
    } else {
      parts.push(`WORK MODE: The user explicitly requested this as a work task (not a question). Propose a code change using propose_change and set auto: true on the change action in submit_response. If you cannot determine what change to make, ask for clarification via submit_response.`);
    }
  }

  // Original question
  parts.push(`QUESTION: ${session.originalQuestion}`);

  // Refinements (from button handlers within the current process lifetime)
  if (session.refinements.length > 0) {
    parts.push(`\nADDITIONAL INSTRUCTIONS FROM USER:\n${session.refinements.join("\n")}`);
  }

  return parts.join("\n");
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
    let lastAssistantText = "";

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
        tools: ["Read", "Glob", "Grep"],
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

      // Extract tool call details and emit stream events
      const msg = message as Record<string, unknown>;
      if (msg.message && typeof msg.message === "object") {
        const innerMsg = msg.message as Record<string, unknown>;
        if (Array.isArray(innerMsg.content)) {
          for (const block of innerMsg.content) {
            if (block && typeof block === "object" && "type" in block && block.type === "tool_use") {
              const tb = block as Record<string, unknown>;
              const toolName = String(tb.name || "unknown");
              const toolArgs = (typeof tb.input === "object" && tb.input !== null) ? tb.input as Record<string, unknown> : {};
              traceEntry.toolCall = { tool: toolName, args: toolArgs, result: {} };
              // Emit tool_start event for streaming
              if (options?.onEvent && tb.id) {
                options.onEvent({ type: "tool_start", taskId: String(tb.id), toolName, toolArgs });
              }
              break;
            }
            if (block && typeof block === "object" && "type" in block && block.type === "tool_result") {
              // Emit tool_end event for streaming
              const rb = block as Record<string, unknown>;
              if (options?.onEvent && rb.tool_use_id) {
                const errorMessage = rb.is_error === true ? extractToolErrorMessage(rb.content) : undefined;
                options.onEvent({ type: "tool_end", taskId: String(rb.tool_use_id), error: rb.is_error === true, errorMessage });
              }
            }
          }
        }
      }

      conversationTrace.push(traceEntry);

      // Track only the LAST assistant message (the final answer, not intermediate thinking)
      if (message.type === "assistant" && message.message?.content) {
        lastAssistantText = "";
        for (const block of message.message.content) {
          if ("text" in block && typeof block.text === "string") {
            lastAssistantText += block.text;
          }
        }
      }
      // Get the final result
      if (message.type === "result") {
        if (message.subtype === "success") {
          // Prefer message.result, fall back to last assistant message only
          answer = message.result || lastAssistantText;
        } else {
          const errorMessage = "errors" in message ? message.errors?.join(", ") : "Unknown error";
          return {
            success: false,
            answer: "",
            error: `Claude query failed: ${errorMessage}`,
            conversationTrace,
          };
        }
      }
    }

    // Check for platform errors masquerading as successful responses
    const platformError = detectPlatformError(answer) ?? detectPlatformError(lastAssistantText);
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
      error: `Claude Agent SDK error: ${error instanceof Error ? error.message : String(error)}`,
      conversationTrace,
    };
  }
}

export function convertMarkdownToSlack(markdown: string): string {
  let result = markdown;

  // Convert bold: **text** or __text__ to *text*
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");
  result = result.replace(/__(.+?)__/g, "*$1*");

  // Convert italic: *text* or _text_ to _text_ (Slack uses _ for italic)
  // Be careful not to convert already-converted bold
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "_$1_");

  // Convert strikethrough: ~~text~~ to ~text~
  result = result.replace(/~~(.+?)~~/g, "~$1~");

  // Convert inline code: `code` stays the same in Slack
  // Code blocks: ```code``` stays the same in Slack

  // Convert headers: # Header to *Header*
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  // Convert links: [text](url) to <url|text>
  result = result.replace(/\[(.+?)\]\((.+?)\)/g, "<$2|$1>");

  return result;
}

/**
 * Split text into chunks that fit within Slack's section block limit.
 * Splits on paragraph boundaries (double newlines) to keep formatting clean.
 */
export function splitForSlack(text: string, maxLength = 3000): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Find the last paragraph break within the limit
    let splitIndex = remaining.lastIndexOf("\n\n", maxLength);
    if (splitIndex <= 0) {
      // Fall back to last single newline
      splitIndex = remaining.lastIndexOf("\n", maxLength);
    }
    if (splitIndex <= 0) {
      // Fall back to hard cut at limit
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).replace(/^\n+/, "");
  }

  return chunks;
}

/**
 * Tests MCP server connections and returns available tools.
 * Starts a minimal Claude query to get the init message with MCP status.
 * Also verifies that clack (in-process) tools build successfully.
 */
export async function testMCP(): Promise<McpTestResult> {
  const config = getConfig();
  const externalMcpServers = await loadMcpServers();
  const configuredServers = getConfiguredMcpServerNames();

  // Build clack tool server with owner role to verify all tools register
  const dummySession: SessionContext = {
    sessionId: "test",
    channelId: "test",
    messageTs: "test",
    threadTs: "test",
    userId: "test",
    originalQuestion: "test",
    threadContext: [],
    refinements: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
  };

  let clackToolNames: string[] = [];
  let clackMcpServer: unknown;
  try {
    const toolCtx = buildQueryContext({
      userId: "test",
      role: "owner",
      session: dummySession,
      config,
      changesWorkflowEnabled: true,
    });
    const clackTools = buildClackTools(toolCtx);
    clackToolNames = clackTools.toolNames;
    clackMcpServer = clackTools.mcpServer;
  } catch (error) {
    return {
      success: false,
      configuredServers,
      connectedServers: [],
      failedServers: [],
      tools: [],
      mcpTools: [],
      clackTools: [],
      error: `Clack tool server failed to build: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!externalMcpServers || configuredServers.length === 0) {
    return {
      success: true,
      configuredServers: [],
      connectedServers: [],
      failedServers: [],
      tools: clackToolNames,
      mcpTools: [],
      clackTools: clackToolNames,
    };
  }

  const abortController = new AbortController();

  // Merge clack tools with external MCP servers for the test query
  const mcpServers = {
    ...externalMcpServers,
    clack: clackMcpServer,
  } as Record<string, unknown>;

  try {
    let tools: string[] = [];
    let mcpServerStatus: McpServerInfo[] = [];

    // Start a minimal query just to get the init message
    for await (const message of query({
      prompt: "test",
      options: {
        cwd: process.cwd(),
        executable: process.execPath as "node",
        model: "haiku", // Use cheapest model for test
        permissionMode: "bypassPermissions",
        mcpServers: mcpServers as Record<string, import("@anthropic-ai/claude-agent-sdk").McpServerConfig>,
        abortController,
        maxTurns: 1,
      },
    })) {
      // Capture the init message which contains tools and MCP status
      if (message.type === "system" && message.subtype === "init") {
        tools = message.tools || [];
        mcpServerStatus = (message.mcp_servers || []).map((s: { name: string; status: string }) => ({
          name: s.name,
          status: s.status,
        }));
        // Abort after getting init info - we don't need the actual response
        abortController.abort();
        break;
      }
    }

    // Separate connected and failed servers
    const connectedServers = mcpServerStatus.filter((s) => s.status === "connected");
    const failedServers = mcpServerStatus.filter((s) => s.status !== "connected");

    // Filter MCP tools (they start with "mcp__")
    const mcpTools = tools.filter((t) => t.startsWith("mcp__") && !t.startsWith("mcp__clack__"));
    const clackTools = tools.filter((t) => t.startsWith("mcp__clack__"));

    return {
      success: true,
      configuredServers,
      connectedServers,
      failedServers,
      tools,
      mcpTools,
      clackTools,
    };
  } catch (error) {
    // AbortError is expected - we abort after getting init
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: true,
        configuredServers,
        connectedServers: [],
        failedServers: [],
        tools: [],
        mcpTools: [],
        clackTools: clackToolNames,
      };
    }

    return {
      success: false,
      configuredServers,
      connectedServers: [],
      failedServers: [],
      tools: [],
      mcpTools: [],
      clackTools: clackToolNames,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Summarize text that was too long for Slack using a quick Claude call.
 * Returns a condensed version, or a hard-truncated fallback if the call fails.
 */
export async function summarizeForSlack(text: string): Promise<string> {
  const maxChars = 39000; // Slack message limit is ~40k; leave headroom

  const prompt = `The following text needs to be posted to Slack but is too long. Condense it to fit within ${maxChars} characters while preserving the most important information. Keep the same general structure and tone. Output ONLY the condensed text, nothing else.

Text to condense:
${text}`;

  try {
    let summary = "";
    let lastAssistantText = "";

    for await (const message of query({
      prompt,
      options: {
        cwd: process.cwd(),
        executable: process.execPath as "node",
        model: "haiku",
        permissionMode: "bypassPermissions",
        disallowedTools: ["Write", "Edit", "NotebookEdit", "Bash", "Task", "Read", "Glob", "Grep"],
        maxTurns: 1,
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        lastAssistantText = "";
        for (const block of message.message.content) {
          if ("text" in block && typeof block.text === "string") {
            lastAssistantText += block.text;
          }
        }
      }
      if (message.type === "result" && message.subtype === "success") {
        summary = message.result || lastAssistantText;
      }
    }

    const result = summary.trim();
    if (result) return result;
  } catch (error) {
    logger.error("Error summarizing text for Slack:", error);
  }

  // Fallback: hard truncate
  return text.substring(0, maxChars) + "\n\n(truncated — full output was too long for Slack)";
}

/**
 * Analyzes an error trace using Claude to get a brief explanation of what went wrong.
 * Uses a lightweight model for quick analysis.
 */
export async function analyzeError(
  errorMessage: string,
  conversationTrace: ConversationMessage[]
): Promise<string> {
  // Format trace for analysis (last 10 messages)
  const recentTrace = conversationTrace.slice(-10);
  const traceText = recentTrace
    .map((m) => {
      let line = `[${m.type}${m.subtype ? `:${m.subtype}` : ""}] ${m.content}`;
      if (m.toolCall) {
        line += `\n  Tool: ${m.toolCall.tool}(${JSON.stringify(m.toolCall.args).substring(0, 200)})`;
        if (Object.keys(m.toolCall.result).length > 0) {
          line += `\n  Result: ${JSON.stringify(m.toolCall.result).substring(0, 200)}`;
        }
      }
      return line;
    })
    .join("\n");

  const prompt = `Analyze this error from a Claude Agent SDK session and provide a brief (2-3 sentence) explanation of what likely went wrong.

Error: ${errorMessage}

Conversation trace (last ${recentTrace.length} messages):
${traceText}

Provide a concise, non-technical explanation suitable for a user who encountered this error.`;

  try {
    let analysis = "";
    let lastAssistantText = "";

    for await (const message of query({
      prompt,
      options: {
        cwd: process.cwd(),
        executable: process.execPath as "node",
        model: "haiku", // Use fast, cheap model for analysis
        permissionMode: "bypassPermissions",
        disallowedTools: ["Write", "Edit", "NotebookEdit", "Bash", "Task", "Read", "Glob", "Grep"],
        maxTurns: 1,
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        lastAssistantText = "";
        for (const block of message.message.content) {
          if ("text" in block && typeof block.text === "string") {
            lastAssistantText += block.text;
          }
        }
      }
      if (message.type === "result" && message.subtype === "success") {
        analysis = message.result || lastAssistantText;
      }
    }

    return analysis.trim() || "Unable to analyze the error.";
  } catch (error) {
    logger.error("Error analyzing error trace:", error);
    return "Error analysis unavailable.";
  }
}
