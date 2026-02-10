import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { getConfig, getDataDir, getRepositoriesDir } from "./config.js";
import { logger } from "./logger.js";
import { loadMcpServers, getConfiguredMcpServerNames } from "./mcp.js";
import type { SessionContext } from "./sessions.js";
import { formatUserIdentity } from "./slack/userCache.js";

export interface ConversationMessage {
  type: string;
  subtype?: string;
  content: string;
  timestamp: number;
}

export interface ErrorRecord {
  timestamp: number;
  errorMessage: string;
  conversationTrace: ConversationMessage[];
}

export interface ChangeRequestInfo {
  branch: string;
  description: string;
  repo: string;
}

export interface ResumeRequestInfo {
  branchName: string;
  repo: string;
}

export interface ClaudeResponse {
  success: boolean;
  answer: string;
  error?: string;
  conversationTrace?: ConversationMessage[];
  isChangeRequest?: boolean;
  changeRequestInfo?: ChangeRequestInfo;
  isResumeRequest?: boolean;
  resumeRequestInfo?: ResumeRequestInfo;
}

export interface ResumableSessionInfo {
  branchName: string;
  repo: string;
  description: string;
  phase: string;
}

export interface AskClaudeOptions {
  enableChangeDetection?: boolean;
  availableRepos?: Array<{ name: string; description: string }>;
  resumableSessions?: ResumableSessionInfo[];
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
  error?: string;
}

function loadInstructionsTemplate(): string {
  const config = getConfig();
  const filePath = resolve(getDataDir(), config.claudeCode.systemPromptFile!);

  try {
    return readFileSync(filePath, "utf-8");
  } catch (error) {
    throw new Error(
      `Failed to load system prompt instructions from ${filePath}: ${error instanceof Error ? error.message : String(error)}\n` +
      `Check that 'claudeCode.systemPromptFile' in config.json points to a valid file relative to the data/ directory.`
    );
  }
}

function buildSystemPrompt(options?: AskClaudeOptions): string {
  const config = getConfig();
  const repoList = config.repositories
    .map((r) => `- **${r.name}**: ${r.description}`)
    .join("\n");

  // Load and interpolate the instructions template
  const template = loadInstructionsTemplate();
  const variables: Record<string, string> = {
    REPOSITORIES_LIST: repoList,
    BOT_NAME: config.slackApp?.name || "Clack",
  };
  let prompt = template.replace(/\{(\w+)\}/g, (match, key) => variables[key] ?? match);

  // Add change detection instructions if enabled
  if (options?.enableChangeDetection && options.availableRepos && options.availableRepos.length > 0) {
    const changeRepoList = options.availableRepos
      .map((r) => `- ${r.name}: ${r.description}`)
      .join("\n");

    prompt += `

## Change Request Detection

The user has developer permissions and may request code changes. Analyze their message to determine intent:

**This is a CHANGE REQUEST if the user:**
- Explicitly asks you to fix, implement, add, update, or modify code
- Describes a bug and asks you to resolve it
- Requests a new feature or enhancement
- Says things like "can you fix...", "please implement...", "add support for..."

**This is a QUESTION if the user:**
- Asks how something works
- Asks why code behaves a certain way
- Asks for explanations or documentation
- Says things like "how does...", "why is...", "what is...", "how do I..."

**If this is a CHANGE REQUEST**, output:
<change-request>
  <branch>clack/{type}/{short-description}</branch>
  <description>Clear description of what will be changed</description>
  <repo>{target-repository-name}</repo>
</change-request>

Where:
- type: fix, feat, refactor, docs, or chore
- short-description: kebab-case, max 30 chars
- repo: exact repository name from available list below

Available repositories that support changes:
${changeRepoList}

**If this is a QUESTION**, provide your answer using the standard format.

When uncertain, default to treating it as a question.`;

    // Add resume detection if there are resumable sessions
    if (options.resumableSessions && options.resumableSessions.length > 0) {
      const sessionList = options.resumableSessions
        .map((s) => `- Branch: ${s.branchName} | Repo: ${s.repo} | Status: ${s.phase} | Task: ${s.description}`)
        .join("\n");

      prompt += `

## Resume Previous Session

There are existing change sessions that can be resumed:

${sessionList}

**This is a RESUME REQUEST if the user:**
- Asks to continue, resume, or retry a previous task
- References a branch name or task description from the list above
- Says things like "continue working on...", "resume the fix...", "retry the task..."

**If this is a RESUME REQUEST**, output:
<resume-request>
  <branch>{exact-branch-name-from-list}</branch>
  <repo>{exact-repo-name}</repo>
</resume-request>

Only output resume-request if the user's request clearly matches one of the sessions listed above.`;
    }
  } else {
    // Standard Q&A mode - no changes allowed
    prompt += `

## Critical: Information Only
- Never suggest code changes, fixes, or solutions that would require modifying the codebase.
- Your role is to explain how things currently work, not to recommend what should change.
- If asked "how do I fix X?", explain what X does and why it behaves that way—do not propose code modifications.`;
  }

  prompt += `

## Investigate the Codebase SILENTLY
- Explore the code to understand how it works before answering.
- **CRITICAL: Do NOT output any text while investigating.** No "Let me check...", "Now I see...", "Looking at line X...", or any narration of your research process.
- Use tools silently. Only output text when you have your FINAL answer ready.

## Output Format
When you have your final answer ready, wrap it in <answer></answer> tags.
Only the content inside these tags will be shown to the user.
Everything outside these tags (your investigation notes, reasoning) will be discarded.`;

  return prompt;
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

function buildPrompt(session: SessionContext): string {
  const parts: string[] = [];

  // Thread context first so Claude reads the conversation before the question
  if (session.threadContext.length > 0) {
    const contextIntro = `THREAD CONTEXT (previous messages in the Slack thread, in chronological order):
Messages may be attributed to specific users by name (e.g., [John Doe]) or as [User] if names are not available.
Messages marked [Clack Bot] are previous answers from you (this bot).
Use this context to understand the conversation flow and provide relevant answers.\n`;
    parts.push(contextIntro + formatThreadContext(session.threadContext));
  }

  // Original question
  parts.push(`QUESTION: ${session.originalQuestion}`);

  // Previous answer if refining
  if (session.lastAnswer && session.refinements.length > 0) {
    parts.push(`\nPREVIOUS ANSWER:\n${session.lastAnswer}`);
  }

  // Refinements
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

/**
 * Parse change request tags from Claude's response
 */
function parseChangeRequest(answer: string): ChangeRequestInfo | null {
  const changeMatch = answer.match(/<change-request>([\s\S]*?)<\/change-request>/);
  if (!changeMatch) return null;

  const content = changeMatch[1];
  const branchMatch = content.match(/<branch>([\s\S]*?)<\/branch>/);
  const descriptionMatch = content.match(/<description>([\s\S]*?)<\/description>/);
  const repoMatch = content.match(/<repo>([\s\S]*?)<\/repo>/);

  if (!branchMatch || !descriptionMatch || !repoMatch) {
    return null;
  }

  return {
    branch: branchMatch[1].trim(),
    description: descriptionMatch[1].trim(),
    repo: repoMatch[1].trim(),
  };
}

/**
 * Parse resume request tags from Claude's response
 */
function parseResumeRequest(answer: string): ResumeRequestInfo | null {
  const resumeMatch = answer.match(/<resume-request>([\s\S]*?)<\/resume-request>/);
  if (!resumeMatch) return null;

  const content = resumeMatch[1];
  const branchMatch = content.match(/<branch>([\s\S]*?)<\/branch>/);
  const repoMatch = content.match(/<repo>([\s\S]*?)<\/repo>/);

  if (!branchMatch || !repoMatch) {
    return null;
  }

  return {
    branchName: branchMatch[1].trim(),
    repo: repoMatch[1].trim(),
  };
}

export async function askClaude(
  session: SessionContext,
  options?: AskClaudeOptions
): Promise<ClaudeResponse> {
  const config = getConfig();
  const reposDir = getRepositoriesDir();
  const mcpServers = loadMcpServers();

  const systemPrompt = buildSystemPrompt(options);
  const userPrompt = buildPrompt(session);

  logger.debug(`Querying Claude via Agent SDK for session ${session.sessionId}...`);

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
        systemPrompt,
        model: config.claudeCode.model,
        permissionMode: "bypassPermissions",
        disallowedTools: ["Write", "Edit", "NotebookEdit", "Bash", "Task"],
        mcpServers,
      },
    })) {
      // Record all messages in the conversation trace
      conversationTrace.push({
        type: message.type,
        subtype: "subtype" in message ? (message.subtype as string) : undefined,
        content: summarizeMessageContent(message),
        timestamp: Date.now(),
      });

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

    if (answer.trim()) {
      // Check for change request tags first (only if change detection was enabled)
      if (options?.enableChangeDetection) {
        const changeRequestInfo = parseChangeRequest(answer);
        if (changeRequestInfo) {
          return {
            success: true,
            answer: "", // No answer text for change requests
            conversationTrace,
            isChangeRequest: true,
            changeRequestInfo,
          };
        }

        // Check for resume request tags
        const resumeRequestInfo = parseResumeRequest(answer);
        if (resumeRequestInfo) {
          return {
            success: true,
            answer: "", // No answer text for resume requests
            conversationTrace,
            isResumeRequest: true,
            resumeRequestInfo,
          };
        }
      }

      // Extract answer from <answer> tags if present
      const answerMatch = answer.match(/<answer>([\s\S]*?)<\/answer>/);
      if (answerMatch) {
        answer = answerMatch[1].trim();
      }
      // Fallback: if no tags found, use the raw answer as-is
      // (This handles edge cases where Claude forgets the tags)

      return {
        success: true,
        answer: answer.trim(),
        conversationTrace,
      };
    }

    return {
      success: false,
      answer: "",
      error: "No response received from Claude",
      conversationTrace,
    };
  } catch (error) {
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

export function truncateForSlack(text: string, maxLength = 3000): string {
  if (text.length <= maxLength) {
    return text;
  }

  const truncated = text.substring(0, maxLength - 50);
  return `${truncated}\n\n_(Response truncated due to length)_`;
}

/**
 * Tests MCP server connections and returns available tools.
 * Starts a minimal Claude query to get the init message with MCP status.
 */
export async function testMCP(): Promise<McpTestResult> {
  const mcpServers = loadMcpServers();
  const configuredServers = getConfiguredMcpServerNames();

  if (!mcpServers || configuredServers.length === 0) {
    return {
      success: true,
      configuredServers: [],
      connectedServers: [],
      failedServers: [],
      tools: [],
      mcpTools: [],
    };
  }

  const abortController = new AbortController();

  try {
    let tools: string[] = [];
    let mcpServerStatus: McpServerInfo[] = [];

    // Start a minimal query just to get the init message
    for await (const message of query({
      prompt: "test",
      options: {
        cwd: process.cwd(),
        model: "haiku", // Use cheapest model for test
        permissionMode: "bypassPermissions",
        mcpServers,
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
    const mcpTools = tools.filter((t) => t.startsWith("mcp__"));

    return {
      success: true,
      configuredServers,
      connectedServers,
      failedServers,
      tools,
      mcpTools,
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
      };
    }

    return {
      success: false,
      configuredServers,
      connectedServers: [],
      failedServers: [],
      tools: [],
      mcpTools: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Analyzes an error trace using Claude to get a brief explanation of what went wrong.
 * Uses a lightweight model for quick analysis.
 */
export async function analyzeError(
  errorMessage: string,
  conversationTrace: ConversationMessage[]
): Promise<string> {
  const config = getConfig();

  // Format trace for analysis (last 10 messages)
  const recentTrace = conversationTrace.slice(-10);
  const traceText = recentTrace
    .map((m) => `[${m.type}${m.subtype ? `:${m.subtype}` : ""}] ${m.content}`)
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
