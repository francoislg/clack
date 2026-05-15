import { clackSession } from "../claude/query.js";
import { readFileSync } from "node:fs";
import { simpleGit } from "simple-git";
import { getConfig, findRepoByName } from "../config.js";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { errorMessage } from "../errors.js";
import { resolveInstructionFile } from "../instructions.js";
import { logger } from "../logger.js";
import { setAuthenticatedRemote } from "../repositories.js";
import type { WorktreeInfo } from "../worktrees.js";
import type { ChangePlan, ChangeRequest, ExecutionResult } from "./types.js";
import { appendExecutionLog } from "./persistence.js";
import { getActiveChange } from "./activeState.js";
import { detectPlatformError } from "../claude/messageParser.js";
import { ClaudeMessageParser } from "../claude/messageParser.js";
import { detectRuntime } from "../claude/utilities.js";
import { buildWorkerContext } from "../tools/context.js";
import { buildClackTools } from "../tools/server.js";
import { discoverEagerSkillPlugins } from "../skillPlugins.js";
import type { StreamEvent } from "../streaming/types.js";
import type { ClaudeRunHandle } from "../claude/runHandle.js";
import { truncate } from "../text.js";

export interface RunClaudeDeps {
  clackSession: typeof clackSession;
  getConfig: typeof getConfig;
}

export const defaultRunClaudeDeps: RunClaudeDeps = {
  clackSession,
  getConfig,
};

/**
 * Run Claude via the Agent SDK with the given prompt and options
 */
export async function runClaude(options: {
  prompt: string;
  cwd: string;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  timeout?: number;
  branchName?: string;
  onProgress?: (message: string) => void;
  onEvent?: (event: StreamEvent) => void | Promise<void>;
  resumeSessionId?: string;
  onSessionId?: (sessionId: string) => void;
  /** External AbortController for cancellation support. If omitted, one is created internally. */
  abortController?: AbortController;
  /**
   * Receives the live `ClaudeRunHandle` once the run starts, before the first SDK message.
   * Workflow callers use this to expose `sendUpdate` / `stop` to Slack handlers via the
   * active-runs registry. Fires synchronously after `clackSession` returns.
   */
  onHandle?: (handle: ClaudeRunHandle) => void;
  /** Dependencies for testing — leave unset in production. */
  _deps?: RunClaudeDeps;
}): Promise<{ success: boolean; text: string; error?: string; lastMessage?: string }> {
  // Validate prompt early - catch empty prompts with a clear error
  if (!options.prompt || options.prompt.trim().length === 0) {
    return {
      success: false,
      text: "",
      error: "Cannot run Claude with empty prompt",
    };
  }

  const deps = options._deps ?? defaultRunClaudeDeps;
  const config = deps.getConfig();
  const timeoutMs = (options.timeout ?? config.changesWorkflow?.timeoutMinutes ?? 10) * 60 * 1000;

  // Set git author to the bot name so commits are attributed to Clack, not the host user
  const botName = config.slackApp?.name ?? "Clack";
  const botEmail = `${botName.toLowerCase().replace(/\s+/g, "-")}[bot]@users.noreply.github.com`;

  // Conditional execution logger — no-op when there's no branch context
  const log = options.branchName
    ? (msg: string) => appendExecutionLog(options.branchName!, msg)
    : undefined;

  logger.debug(
    `Running Claude in ${options.cwd}${options.branchName ? ` (worktree: ${options.branchName})` : ""}`,
  );
  log?.(`Running Claude via Agent SDK`);
  log?.(`Working directory: ${options.cwd}`);
  log?.(`Prompt length: ${options.prompt.length} chars`);
  log?.(`Timeout: ${timeoutMs / 60000} minutes`);

  // Heartbeat logging
  let lastOutputTime = Date.now();
  let outputReceived = false;
  const heartbeatInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - lastOutputTime) / 1000);
    log?.(
      !outputReceived
        ? `Still waiting for first output... (${elapsed}s since start)`
        : `Query still running... (${elapsed}s since last event)`,
    );
  }, 30000);

  let finalText = "";
  let lastProgressMessage = "";
  let resultSuccess = false;
  let resultError: string | undefined;
  const parser = new ClaudeMessageParser(options.onEvent);

  const run = deps.clackSession({
    prompt: options.prompt,
    resumeSessionId: options.resumeSessionId,
    onSessionId: options.onSessionId,
    options: {
      cwd: options.cwd,
      executable: detectRuntime(),
      systemPrompt: options.systemPrompt,
      allowedTools: options.allowedTools,
      disallowedTools: options.disallowedTools,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      plugins: discoverEagerSkillPlugins(),
      ...(options.mcpServers && {
        mcpServers: options.mcpServers as Record<string, McpServerConfig>,
      }),
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: botName,
        GIT_AUTHOR_EMAIL: botEmail,
        GIT_COMMITTER_NAME: botName,
        GIT_COMMITTER_EMAIL: botEmail,
      },
    },
  });

  options.onHandle?.(run);

  // Timeout: stop the run when elapsed
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    void run.stop("timeout");
  }, timeoutMs);

  // Bridge: external AbortController triggers run.stop. Removed once all callers migrate.
  if (options.abortController) {
    if (options.abortController.signal.aborted) {
      void run.stop("aborted");
    } else {
      options.abortController.signal.addEventListener(
        "abort",
        () => {
          void run.stop("aborted");
        },
        { once: true },
      );
    }
  }

  try {
    for await (const message of run.messages) {
      lastOutputTime = Date.now();
      outputReceived = true;

      const parsed = await parser.process(message);

      // Worker-specific: progress callbacks and execution log for tool uses
      for (const tool of parsed.toolUses) {
        lastProgressMessage = `Using ${tool.name}`;
        options.onProgress?.(lastProgressMessage);
        log?.(`Event: tool_use (${tool.name})`);
      }

      // Worker-specific: accumulate assistant text and log it
      if (parsed.assistantText) {
        finalText += parsed.assistantText + "\n";
        log?.(`Event: assistant text: ${truncate(parsed.assistantText.replace(/\n/g, " "), 200)}`);
      }

      // Handle result — first-result-wins: break out of the loop so the input stream closes
      if (parser.result) {
        if (parser.result.success) {
          resultSuccess = true;
          if (parser.result.text) {
            finalText = parser.result.text;
          }
        } else {
          resultError = parser.result.error;
        }
        log?.(
          `Event: result (subtype: ${"subtype" in message ? String(message.subtype) : "unknown"})`,
        );
        break;
      } else if (message.type === "system" && "subtype" in message && message.subtype === "init") {
        const sessionId =
          "session_id" in message ? String(message.session_id).substring(0, 8) : "unknown";
        log?.(`Event: init (session: ${sessionId}...)`);
      } else if (
        message.type !== "tool_progress" &&
        message.type !== "assistant" &&
        message.type !== "user"
      ) {
        const subtype = "subtype" in message ? message.subtype : undefined;
        log?.(`Event: ${message.type}${subtype ? ":" + subtype : ""}`);
      }
    }
  } catch (error) {
    clearTimeout(timeoutId);
    clearInterval(heartbeatInterval);

    const isAbortError = error instanceof Error && error.name === "AbortError";
    const isSignalAbort =
      run.abortController.signal.aborted &&
      error instanceof Error &&
      /aborted/i.test(error.message);

    // Settle the handle so its futureResponse resolves and any registry slot is freed.
    run.fail(error instanceof Error ? error : String(error));

    if (isAbortError || isSignalAbort) {
      if (timedOut) {
        log?.(`Timeout: Execution timed out after ${timeoutMs / 60000} minutes`);
        return {
          success: false,
          text: finalText.trim(),
          error: `Execution timed out after ${timeoutMs / 60000} minutes`,
          lastMessage: lastProgressMessage,
        };
      }
      log?.("Cancelled: Execution was cancelled by user");
      return {
        success: false,
        text: finalText.trim(),
        error: "Execution cancelled",
        lastMessage: lastProgressMessage,
      };
    }

    log?.(`SDK error: ${errorMessage(error)}`);
    return {
      success: false,
      text: finalText.trim(),
      error: `Agent SDK error: ${errorMessage(error)}`,
      lastMessage: lastProgressMessage,
    };
  }

  clearTimeout(timeoutId);
  clearInterval(heartbeatInterval);

  // Settle the run so the input stream closes cleanly and any registry slot is freed.
  run.settle({
    success: resultSuccess,
    answer: finalText.trim(),
    ...(resultError && { error: resultError }),
  });

  // Check for platform errors masquerading as successful responses
  const platformError =
    detectPlatformError(finalText) ?? detectPlatformError(parser.lastAssistantText);
  if (platformError) {
    logger.warn(`Platform error detected in worker: ${platformError}`);
    log?.(`Platform error: ${platformError}`);
    return {
      success: false,
      text: finalText.trim(),
      error: platformError,
      lastMessage: lastProgressMessage,
    };
  }

  log?.(`Query completed (success: ${resultSuccess}, text: ${finalText.trim().length} chars)`);

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
  options: Parameters<typeof runClaude>[0],
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
3. Before committing, run quality checks:
   - Look for test/lint/format commands in package.json scripts, Makefile, or CI config
   - Run any available test suite (e.g. npm test, yarn test, make test)
   - Run any available linter (e.g. npm run lint, yarn lint)
   - Run any available formatter (e.g. npm run format, yarn format)
   - If tests fail, fix the failures before proceeding — do not commit broken code
4. Commit your changes with a descriptive commit message
5. Push the branch using the git_push tool
6. Create or update the pull request using the ensure_pr tool
7. Report your final status using the report_status tool

Important:
- Make minimal, focused changes
- Follow existing code patterns and conventions
- Do not make changes outside the scope of the request
- If you encounter issues, report them via report_status
- If git_push fails, report the error via report_status — do not retry unless you can fix the issue
- For the PR title, use a concise description (max 72 chars) — do NOT put "Requested by" or the requester's name in the title
- For the PR summary, describe what was changed and why. If the prompt provides a "Requested by:" line, include it verbatim at the top of the PR body (never in the title)`;

/**
 * Execute the change in the worktree
 */
export interface ExecuteChangeOptions {
  plan: ChangePlan;
  worktree: WorktreeInfo;
  request: ChangeRequest;
  sessionId: string;
  resumeContext?: string;
  onEvent?: (event: StreamEvent) => void | Promise<void>;
  sdkSessionId?: string;
  /** External AbortController for cancellation support */
  abortController?: AbortController;
  /**
   * Fires synchronously when the underlying Claude run is constructed. The workflow uses
   * this to record `activeChange.handle` so `cancel_worker_run` and Slack-side stop paths
   * can call `handle.stop(reason)` instead of touching the AbortController.
   */
  onHandle?: (handle: ClaudeRunHandle) => void;
}

export async function executeChange(opts: ExecuteChangeOptions): Promise<ExecutionResult> {
  const {
    plan,
    worktree,
    request,
    sessionId,
    resumeContext,
    onEvent,
    sdkSessionId,
    abortController,
    onHandle,
  } = opts;
  const config = getConfig();

  // Build the allowed tools list
  const defaultTools = ["Read", "Glob", "Grep", "Write", "Edit", "Bash", "ToolSearch"];
  const additionalTools = config.changesWorkflow?.additionalAllowedTools ?? [];
  const allowedTools = [...defaultTools, ...additionalTools];

  // Always disallow Task/TaskOutput to prevent sub-agents
  const disallowedTools = ["Task", "TaskOutput"];

  let systemPrompt = EXECUTION_SYSTEM_PROMPT;

  // Append repo-specific changes instructions if available
  const changesInstructionsFile = resolveInstructionFile(
    `${worktree.repoName}/changes_instructions.md`,
  );
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

  const requester = request.userDisplayName?.trim() || `Slack user ${request.userId}`;

  let prompt = `Implement this change:

Description: ${plan.description}

Original request: "${request.message}"

Requested by: ${requester}

Work in this branch: ${plan.branchName}`;

  if (plan.plan) {
    prompt += `

Detailed plan from the originating conversation (you do not have access to that conversation directly — treat this plan as authoritative for the user's intent, including any file lists, strategies, or trade-offs already agreed upon):
${plan.plan}`;
  }

  if (resumeContext) {
    prompt += `

${resumeContext}`;
  }

  prompt += `

Follow the workflow steps in the system prompt. Report your final status using the report_status tool.`;

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

  // Snapshot HEAD and prUrl before the worker runs so we can detect "success but
  // no observable outcome" (the worker reports success but didn't commit AND
  // didn't create a PR). A resumed run that only pushes existing commits and
  // creates the PR is a real success even though HEAD doesn't move.
  const headBefore = await readBranchHead(worktree.worktreePath);
  const prUrlBefore = getActiveChange(sessionId)?.prUrl;

  let capturedSdkSessionId: string | undefined;
  const result = await runClaudeInWorktree(worktree.repoName, {
    prompt,
    cwd: worktree.worktreePath,
    systemPrompt,
    allowedTools,
    disallowedTools,
    branchName: plan.branchName,
    mcpServers: { clack: workerTools.mcpServer },
    onEvent,
    abortController,
    ...(onHandle && { onHandle }),
    resumeSessionId: sdkSessionId,
    onSessionId: (id) => {
      capturedSdkSessionId = id;
    },
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Execution failed",
      sdkSessionId: capturedSdkSessionId,
    };
  }

  const headAfter = await readBranchHead(worktree.worktreePath);
  const prUrlAfter = getActiveChange(sessionId)?.prUrl;
  const noNewCommits = !!headBefore && !!headAfter && headBefore === headAfter;
  const noNewPr = prUrlBefore === prUrlAfter;
  if (noNewCommits && noNewPr) {
    appendExecutionLog(
      plan.branchName,
      "Worker reported success but no new commits or PR were made — treating as no-op",
    );
    return {
      success: false,
      error:
        "Worker completed without making any commits or creating a PR. See its status messages above for what it decided. Reply in the thread to ask it to actually implement the change.",
      sdkSessionId: capturedSdkSessionId,
    };
  }

  return {
    success: true,
    summary: "Changes implemented",
    sdkSessionId: capturedSdkSessionId,
  };
}

async function readBranchHead(worktreePath: string): Promise<string | undefined> {
  try {
    const git = simpleGit(worktreePath);
    return (await git.revparse(["HEAD"])).trim();
  } catch (err) {
    logger.warn(`Could not read HEAD of ${worktreePath}: ${errorMessage(err)}`);
    return undefined;
  }
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
    allowedTools: ["Bash", "Write", "Edit", "Read", "ToolSearch"],
    disallowedTools: ["Task", "TaskOutput", "Glob", "Grep"],
    branchName,
    onEvent,
  });

  if (!result.success) {
    logger.warn(
      `Worktree setup failed for ${repoName}${branchName ? ` (${branchName})` : ""}: ${result.error}`,
    );
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

/**
 * Run the per-repo install step (e.g., `pnpm install --frozen-lockfile`) in an
 * existing worker just before work starts on a new branch. Reads
 * `{repoName}/worktree_install_instructions.md` via the two-tier instructions
 * chain. Idempotent and skipped silently when no file is configured.
 *
 * Distinct from `runWorktreeSetup` (heavy initial provisioning — runs once per
 * worker). This install hook is light and runs on every branch switch.
 */
export async function runWorktreeInstall(
  repoName: string,
  worktreePath: string,
  branchName?: string,
  onEvent?: (event: StreamEvent) => void | Promise<void>,
): Promise<void> {
  const installPath = resolveInstructionFile(`${repoName}/worktree_install_instructions.md`);
  if (!installPath) return;

  let instructions: string;
  try {
    instructions = readFileSync(installPath, "utf-8");
  } catch {
    logger.warn(`Failed to read worktree install instructions at ${installPath}`);
    return;
  }
  if (!instructions.trim()) return;

  logger.info(`Running worktree install for ${repoName}${branchName ? ` (${branchName})` : ""}...`);
  if (branchName) {
    appendExecutionLog(branchName, `Running install step from ${installPath}`);
  }

  const result = await runClaudeInWorktree(repoName, {
    prompt: instructions,
    cwd: worktreePath,
    systemPrompt: [
      "You are running dependency install for a workspace that just switched branches.",
      "Follow the instructions EXACTLY. Do not modify ports, .env, or other configuration.",
      "Do not run heavy setup steps that were already done — only the install step.",
      "Do not ask questions — just execute.",
    ].join(" "),
    allowedTools: ["Bash", "Read"],
    disallowedTools: ["Task", "TaskOutput", "Write", "Edit", "Glob", "Grep"],
    branchName,
    onEvent,
  });

  if (!result.success) {
    logger.warn(
      `Worktree install failed for ${repoName}${branchName ? ` (${branchName})` : ""}: ${result.error}`,
    );
    if (branchName) {
      appendExecutionLog(branchName, `Install step failed: ${result.error}`);
    }
    return;
  }
  if (branchName) {
    appendExecutionLog(branchName, "Install step completed");
  }
}
