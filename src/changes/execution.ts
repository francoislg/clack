import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync } from "node:fs";
import { getConfig, findRepoByName } from "../config.js";
import { errorMessage } from "../errors.js";
import { resolveInstructionFile } from "../instructions.js";
import { logger } from "../logger.js";
import { setAuthenticatedRemote } from "../worktrees.js";
import type { WorktreeInfo } from "../worktrees.js";
import type { ChangePlan, ChangeRequest, ExecutionResult } from "./types.js";
import { appendExecutionLog } from "./persistence.js";
import { detectPlatformError } from "../claude/messageParser.js";
import { ClaudeMessageParser } from "../claude/messageParser.js";
import { buildWorkerContext } from "../tools/context.js";
import { buildClackTools } from "../tools/server.js";
import { discoverPlugins } from "../plugins.js";
import type { StreamEvent } from "../streaming/types.js";

/**
 * Run Claude via the Agent SDK with the given prompt and options
 */
export async function runClaude(options: {
  prompt: string;
  cwd: string;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, unknown>;
  timeout?: number;
  branchName?: string;
  onProgress?: (message: string) => void;
  onEvent?: (event: StreamEvent) => void | Promise<void>;
}): Promise<{ success: boolean; text: string; error?: string; lastMessage?: string }> {
  // Validate prompt early - catch empty prompts with a clear error
  if (!options.prompt || options.prompt.trim().length === 0) {
    return {
      success: false,
      text: "",
      error: "Cannot run Claude with empty prompt",
    };
  }

  const config = getConfig();
  const timeoutMs = (options.timeout ?? config.changesWorkflow?.timeoutMinutes ?? 10) * 60 * 1000;

  // Set git author to the bot name so commits are attributed to Clack, not the host user
  const botName = config.slackApp?.name ?? "Clack";
  const botEmail = `${botName.toLowerCase().replace(/\s+/g, "-")}[bot]@users.noreply.github.com`;

  logger.debug(`Running Claude in ${options.cwd}${options.branchName ? ` (worktree: ${options.branchName})` : ""}`);
  if (options.branchName) {
    appendExecutionLog(options.branchName, `Running Claude via Agent SDK`);
    appendExecutionLog(options.branchName, `Working directory: ${options.cwd}`);
    appendExecutionLog(options.branchName, `Prompt length: ${options.prompt.length} chars`);
    appendExecutionLog(options.branchName, `Timeout: ${timeoutMs / 60000} minutes`);
  }

  // Timeout via AbortController
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

  // Heartbeat logging
  let lastOutputTime = Date.now();
  let outputReceived = false;
  const heartbeatInterval = setInterval(() => {
    if (options.branchName) {
      const elapsed = Math.round((Date.now() - lastOutputTime) / 1000);
      if (!outputReceived) {
        appendExecutionLog(options.branchName, `Still waiting for first output... (${elapsed}s since start)`);
      } else {
        appendExecutionLog(options.branchName, `Query still running... (${elapsed}s since last event)`);
      }
    }
  }, 30000);

  let finalText = "";
  let lastProgressMessage = "";
  let resultSuccess = false;
  let resultError: string | undefined;
  const parser = new ClaudeMessageParser(options.onEvent);

  try {
    for await (const message of query({
      prompt: options.prompt,
      options: {
        cwd: options.cwd,
        executable: process.execPath as "node",
        systemPrompt: options.systemPrompt,
        allowedTools: options.allowedTools,
        disallowedTools: options.disallowedTools,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        plugins: discoverPlugins(),
        persistSession: false,
        ...(options.mcpServers && { mcpServers: options.mcpServers as Record<string, import("@anthropic-ai/claude-agent-sdk").McpServerConfig> }),
        abortController,
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: botName,
          GIT_AUTHOR_EMAIL: botEmail,
          GIT_COMMITTER_NAME: botName,
          GIT_COMMITTER_EMAIL: botEmail,
        },
      },
    })) {
      lastOutputTime = Date.now();
      outputReceived = true;

      const parsed = await parser.process(message as { type: string; [key: string]: unknown });

      // Worker-specific: progress callbacks and execution log for tool uses
      for (const tool of parsed.toolUses) {
        lastProgressMessage = `Using ${tool.name}`;
        options.onProgress?.(lastProgressMessage);
        if (options.branchName) {
          appendExecutionLog(options.branchName, `Event: tool_use (${tool.name})`);
        }
      }

      // Worker-specific: accumulate assistant text and log it
      if (parsed.assistantText) {
        finalText += parsed.assistantText + "\n";
        if (options.branchName) {
          const preview = parsed.assistantText.substring(0, 200).replace(/\n/g, " ");
          appendExecutionLog(options.branchName, `Event: assistant text: ${preview}...`);
        }
      }

      // Handle result
      if (parser.result) {
        if (parser.result.success) {
          resultSuccess = true;
          if (parser.result.text) {
            finalText = parser.result.text;
          }
        } else {
          resultError = parser.result.error;
        }
        if (options.branchName) {
          const subtype = (message as Record<string, unknown>).subtype;
          appendExecutionLog(options.branchName, `Event: result (subtype: ${subtype})`);
        }
      } else if (message.type === "system" && "subtype" in message && message.subtype === "init") {
        if (options.branchName) {
          const sessionId = "session_id" in message ? String(message.session_id).substring(0, 8) : "unknown";
          appendExecutionLog(options.branchName, `Event: init (session: ${sessionId}...)`);
        }
      } else if (message.type !== "tool_progress" && message.type !== "assistant" && message.type !== "user" && options.branchName) {
        const subtype = "subtype" in message ? message.subtype : undefined;
        appendExecutionLog(options.branchName, `Event: ${message.type}${subtype ? ":" + subtype : ""}`);
      }
    }
  } catch (error) {
    clearTimeout(timeoutId);
    clearInterval(heartbeatInterval);

    // Detect timeout: either a standard AbortError or the SDK's "aborted by user"
    // message when our AbortController signal has fired
    const isAbortError = error instanceof Error && error.name === "AbortError";
    const isSignalAbort = abortController.signal.aborted &&
      error instanceof Error && /aborted/i.test(error.message);

    if (isAbortError || isSignalAbort) {
      if (options.branchName) {
        appendExecutionLog(options.branchName, `Timeout: Execution timed out after ${timeoutMs / 60000} minutes`);
      }
      return {
        success: false,
        text: finalText.trim(),
        error: `Execution timed out after ${timeoutMs / 60000} minutes`,
        lastMessage: lastProgressMessage,
      };
    }

    if (options.branchName) {
      appendExecutionLog(options.branchName, `SDK error: ${errorMessage(error)}`);
    }
    return {
      success: false,
      text: finalText.trim(),
      error: `Agent SDK error: ${errorMessage(error)}`,
      lastMessage: lastProgressMessage,
    };
  }

  clearTimeout(timeoutId);
  clearInterval(heartbeatInterval);

  // Check for platform errors masquerading as successful responses
  const platformError = detectPlatformError(finalText) ?? detectPlatformError(parser.lastAssistantText);
  if (platformError) {
    logger.warn(`Platform error detected in worker: ${platformError}`);
    if (options.branchName) {
      appendExecutionLog(options.branchName, `Platform error: ${platformError}`);
    }
    return {
      success: false,
      text: finalText.trim(),
      error: platformError,
      lastMessage: lastProgressMessage,
    };
  }

  if (options.branchName) {
    appendExecutionLog(options.branchName, `Query completed (success: ${resultSuccess}, text: ${finalText.trim().length} chars)`);
  }

  return {
    success: resultSuccess,
    text: finalText.trim(),
    error: resultError,
    lastMessage: lastProgressMessage,
  };
}

/**
 * Run Claude in a worktree context with automatic git auth refresh.
 * All Claude invocations targeting a worktree MUST use this instead of runClaude() directly.
 */
export async function runClaudeInWorktree(
  repoName: string,
  options: Parameters<typeof runClaude>[0]
): Promise<Awaited<ReturnType<typeof runClaude>>> {
  const config = getConfig();
  const repo = findRepoByName(repoName, config);
  if (repo) {
    await setAuthenticatedRemote(options.cwd, repo.url);
  }
  return runClaude(options);
}

// ============================================================================
// Execution Phase
// ============================================================================

const EXECUTION_SYSTEM_PROMPT = `You are an autonomous code change agent. Your job is to implement the requested changes.

Instructions:
1. Analyze the codebase to understand the context
2. Implement the requested changes
3. Run tests if the repository instructions specify how
4. Commit your changes with a descriptive commit message
5. Push the branch using the git_push tool
6. Create a pull request using the ensure_pr tool
7. Report your final status using the report_status tool

Important:
- Make minimal, focused changes
- Follow existing code patterns and conventions
- Do not make changes outside the scope of the request
- If you encounter issues, report them via report_status
- If git_push fails, report the error via report_status — do not retry unless you can fix the issue
- For the PR title, use a concise description (max 72 chars)
- For the PR summary, describe what was changed and why`;

/**
 * Execute the change in the worktree
 */
export async function executeChange(
  plan: ChangePlan,
  worktree: WorktreeInfo,
  request: ChangeRequest,
  sessionId: string,
  resumeContext?: string,
  onEvent?: (event: StreamEvent) => void | Promise<void>,
): Promise<ExecutionResult> {
  const config = getConfig();

  // Build the allowed tools list
  const defaultTools = ["Read", "Glob", "Grep", "Write", "Edit", "Bash"];
  const additionalTools = config.changesWorkflow?.additionalAllowedTools ?? [];
  const allowedTools = [...defaultTools, ...additionalTools];

  // Always disallow Task/TaskOutput to prevent sub-agents
  const disallowedTools = ["Task", "TaskOutput"];

  let systemPrompt = EXECUTION_SYSTEM_PROMPT;

  // Append repo-specific changes instructions if available
  const changesInstructionsFile = resolveInstructionFile(`${worktree.repoName}/changes_instructions.md`);
  if (changesInstructionsFile) {
    try {
      const changesInstructions = readFileSync(changesInstructionsFile, "utf-8");
      if (changesInstructions.trim()) {
        systemPrompt += `\n\nRepository-Specific Instructions:\n${changesInstructions}`;
      }
    } catch {
      logger.warn(`Failed to read changes instructions at ${changesInstructionsFile}`);
    }
  }

  let prompt = `Implement this change:

Description: ${plan.description}

Original request: "${request.message}"

Work in this branch: ${plan.branchName}`;

  if (resumeContext) {
    prompt += `

IMPORTANT - Resuming previous session:
${resumeContext}
Check git status and git log to understand what was already done. Continue from where the previous session left off.`;
  }

  prompt += `

Remember to:
1. Make the changes
2. Run tests if the repository instructions specify how
3. Commit with a descriptive message
4. Push using the git_push tool
5. Create a PR using the ensure_pr tool
6. Report your final status using the report_status tool`;

  // Build worker tools for this execution
  const repo = findRepoByName(plan.targetRepo, config);
  const workerCtx = buildWorkerContext({
    worktreePath: worktree.worktreePath,
    branchName: plan.branchName,
    repoName: worktree.repoName,
    repoUrl: repo?.url ?? "",
    channelId: request.channel,
    threadTs: request.threadTs ?? request.messageTs,
    sessionId,
    config,
  });
  const workerTools = buildClackTools(workerCtx);

  const result = await runClaudeInWorktree(worktree.repoName, {
    prompt,
    cwd: worktree.worktreePath,
    systemPrompt,
    allowedTools,
    disallowedTools,
    branchName: plan.branchName,
    mcpServers: { clack: workerTools.mcpServer },
    onEvent,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Execution failed",
    };
  }

  return {
    success: true,
    summary: "Changes implemented",
  };
}

/**
 * Resolve repo-specific changes instructions via the two-tier instruction file chain.
 * Returns the content or empty string if not found.
 */
export function resolveChangesInstructions(repoName: string): string {
  const path = resolveInstructionFile(`${repoName}/changes_instructions.md`);
  if (path) {
    try {
      return readFileSync(path, "utf-8");
    } catch {
      logger.warn(`Failed to read changes instructions at ${path}`);
    }
  }
  return "";
}

/**
 * Run worktree setup instructions after creating a fresh worktree.
 * Resolves `{repoName}/worktree_setup_instructions.md` via the two-tier chain
 * and runs a short Claude invocation to execute the setup steps.
 * Non-fatal: logs a warning on failure and continues.
 */
export async function runWorktreeSetup(
  repoName: string,
  worktreePath: string,
  branchName?: string,
  onEvent?: (event: StreamEvent) => void | Promise<void>,
): Promise<void> {
  const setupPath = resolveInstructionFile(`${repoName}/worktree_setup_instructions.md`);
  if (!setupPath) {
    return;
  }

  let setupInstructions: string;
  try {
    setupInstructions = readFileSync(setupPath, "utf-8");
  } catch {
    logger.warn(`Failed to read worktree setup instructions at ${setupPath}`);
    return;
  }

  if (!setupInstructions.trim()) {
    return;
  }

  logger.info(`Running worktree setup for ${repoName}${branchName ? ` (${branchName})` : ""}...`);
  if (branchName) {
    appendExecutionLog(branchName, `Running worktree setup instructions from ${setupPath}`);
  }

  const result = await runClaudeInWorktree(repoName, {
    prompt: setupInstructions,
    cwd: worktreePath,
    systemPrompt: [
      "You are setting up a development workspace.",
      "Follow the instructions EXACTLY and LITERALLY. Do not skip, reorder, or improvise any steps.",
      "When the instructions say to read a file, use the Read tool to read it, then follow its content.",
      "Do not guess what setup commands to run — only run what the instructions explicitly tell you to.",
      "Do not ask questions — just execute the steps.",
    ].join(" "),
    allowedTools: ["Bash", "Write", "Edit", "Read"],
    disallowedTools: ["Task", "TaskOutput", "Glob", "Grep"],
    branchName,
    onEvent,
  });

  if (!result.success) {
    logger.warn(`Worktree setup failed for ${repoName}${branchName ? ` (${branchName})` : ""}: ${result.error}`);
    if (branchName) {
      appendExecutionLog(branchName, `Worktree setup failed: ${result.error}`);
    }
  } else {
    logger.info(`Worktree setup completed for ${repoName}${branchName ? ` (${branchName})` : ""}`);
    if (branchName) {
      appendExecutionLog(branchName, "Worktree setup completed successfully");
    }
  }
}
