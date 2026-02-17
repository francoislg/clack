import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getConfig, getDefaultConfigurationDir } from "../config.js";
import { resolveInstructionFile } from "../instructions.js";
import { logger } from "../logger.js";
import { setAuthenticatedRemote } from "../worktrees.js";
import type { WorktreeInfo } from "../worktrees.js";
import type { ChangePlan, ChangeRequest, ExecutionResult, PlanGenerationResult } from "./types.js";
import { appendExecutionLog } from "./persistence.js";
import { findRepoByName } from "./detection.js";

/**
 * Run Claude CLI with the given prompt and options
 */
export async function runClaude(options: {
  prompt: string;
  cwd: string;
  systemPrompt?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  timeout?: number;
  branchName?: string;
  onProgress?: (message: string) => void;
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

  return new Promise((resolve) => {
    const args = ["--print", "--verbose", "--dangerously-skip-permissions", "--output-format", "stream-json"];

    if (options.systemPrompt) {
      args.push("--system-prompt", options.systemPrompt);
    }

    if (options.allowedTools?.length) {
      args.push("--allowedTools", options.allowedTools.join(","));
    }

    if (options.disallowedTools?.length) {
      args.push("--disallowedTools", options.disallowedTools.join(","));
    }

    // Note: prompt is passed via stdin, not as a positional argument
    // This avoids argument parsing issues when systemPrompt contains newlines

    // Log the full command (truncated prompt for readability)
    const truncatedPrompt = options.prompt.length > 100 ? options.prompt.substring(0, 100) + "..." : options.prompt;
    logger.debug(`Running Claude in ${options.cwd}`);
    logger.debug(`Args: ${args.join(" ")} (prompt via stdin)`);

    if (options.branchName) {
      appendExecutionLog(options.branchName, `Command: claude ${args.join(" ")} [prompt via stdin]`);
      appendExecutionLog(options.branchName, `Working directory: ${options.cwd}`);
      appendExecutionLog(options.branchName, `Prompt length: ${options.prompt.length} chars`);
      appendExecutionLog(options.branchName, `Timeout: ${timeoutMs / 60000} minutes`);
    }

    // Set git author to the bot name so commits are attributed to Clack, not the host user
    const botName = config.slackApp?.name ?? "Clack";
    const botEmail = `${botName.toLowerCase().replace(/\s+/g, "-")}[bot]@users.noreply.github.com`;

    const proc = spawn("claude", args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: botName,
        GIT_AUTHOR_EMAIL: botEmail,
        GIT_COMMITTER_NAME: botName,
        GIT_COMMITTER_EMAIL: botEmail,
      },
      stdio: ["pipe", "pipe", "pipe"], // stdin enabled - prompt passed via stdin
    });

    // Write prompt to stdin and close it
    // This is more robust than positional arguments when systemPrompt contains newlines
    proc.stdin.write(options.prompt);
    proc.stdin.end();

    // Log that process started
    if (options.branchName) {
      appendExecutionLog(options.branchName, `Claude process spawned (PID: ${proc.pid})`);
      appendExecutionLog(options.branchName, `Prompt written to stdin, waiting for output...`);
    }

    let stdout = "";
    let stderr = "";
    let lastProgressMessage = "";
    let lastOutputTime = Date.now();
    let outputReceived = false;

    // Track parsed stream-json data (parse once, use directly)
    let finalText = "";
    let resultSuccess = false;
    let resultError: string | undefined;

    // Heartbeat to show process is still running
    const heartbeatInterval = setInterval(() => {
      if (options.branchName) {
        const elapsed = Math.round((Date.now() - lastOutputTime) / 1000);
        if (!outputReceived) {
          appendExecutionLog(options.branchName, `Still waiting for first output... (${elapsed}s since spawn)`);
        } else {
          appendExecutionLog(options.branchName, `Process still running... (${elapsed}s since last output, stdout: ${stdout.length} bytes, stderr: ${stderr.length} bytes)`);
        }
      }
    }, 30000); // Every 30 seconds

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      lastOutputTime = Date.now();
      outputReceived = true;

      // Parse stream-json events - extract data AND log in single pass
      const lines = chunk.split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        try {
          const event = JSON.parse(line);

          // Extract text from assistant messages
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "tool_use") {
                lastProgressMessage = `Using ${block.name}`;
                options.onProgress?.(lastProgressMessage);
                if (options.branchName) {
                  appendExecutionLog(options.branchName, `Event: tool_use (${block.name})`);
                }
              } else if (block.type === "text" && block.text) {
                finalText += block.text + "\n";
                if (options.branchName) {
                  const preview = block.text.substring(0, 200).replace(/\n/g, " ");
                  appendExecutionLog(options.branchName, `Event: assistant text: ${preview}...`);
                }
              }
            }
          }
          // Track the final result
          else if (event.type === "result") {
            if (event.subtype === "success") {
              resultSuccess = true;
              // The result may contain the final text directly
              if (event.result) {
                finalText = event.result;
              }
            } else if (event.subtype === "error") {
              resultError = event.error || "Unknown error";
            }
            if (options.branchName) {
              appendExecutionLog(options.branchName, `Event: result (subtype: ${event.subtype})`);
            }
          }
          // Log other events
          else if (options.branchName) {
            if (event.type === "system" && event.subtype === "init") {
              appendExecutionLog(options.branchName, `Event: init (session: ${event.session_id?.substring(0, 8)}...)`);
            } else if (event.type === "user" && event.message?.content) {
              for (const block of event.message.content) {
                if (block.type === "tool_result") {
                  const resultPreview = typeof block.content === "string"
                    ? block.content.substring(0, 100)
                    : "[complex result]";
                  appendExecutionLog(options.branchName, `Event: tool_result: ${resultPreview}...`);
                }
              }
            } else {
              appendExecutionLog(options.branchName, `Event: ${event.type}${event.subtype ? ":" + event.subtype : ""}`);
            }
          }
        } catch {
          // Not JSON, log as raw
          if (options.branchName) {
            appendExecutionLog(options.branchName, `stdout: ${line.substring(0, 500)}`);
          }
        }
      }
    });

    proc.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      lastOutputTime = Date.now();

      // Also log stderr to execution.log - this often has useful info
      if (options.branchName) {
        const lines = chunk.split("\n").filter((l: string) => l.trim());
        for (const line of lines) {
          appendExecutionLog(options.branchName, `stderr: ${line.substring(0, 500)}`);
        }
      }
    });

    const timeoutId = setTimeout(() => {
      clearInterval(heartbeatInterval);
      proc.kill("SIGTERM");
      if (options.branchName) {
        appendExecutionLog(options.branchName, `Timeout: Execution timed out after ${timeoutMs / 60000} minutes`);
        appendExecutionLog(options.branchName, `Final stdout length: ${stdout.length} bytes`);
        appendExecutionLog(options.branchName, `Final stderr length: ${stderr.length} bytes`);
      }
      resolve({
        success: false,
        text: finalText.trim(),
        error: `Execution timed out after ${timeoutMs / 60000} minutes`,
        lastMessage: lastProgressMessage,
      });
    }, timeoutMs);

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      clearInterval(heartbeatInterval);
      if (options.branchName) {
        appendExecutionLog(options.branchName, `Process exited with code ${code}`);
        appendExecutionLog(options.branchName, `Final stdout length: ${stdout.length} bytes`);
        appendExecutionLog(options.branchName, `Final stderr length: ${stderr.length} bytes`);
        appendExecutionLog(options.branchName, `Parsed final text (${finalText.trim().length} chars)`);
        if (stderr && code !== 0) {
          appendExecutionLog(options.branchName, `Full stderr: ${stderr.substring(0, 2000)}`);
        }
      }
      resolve({
        success: resultSuccess,  // From result event, not exit code
        text: finalText.trim(),  // Already parsed
        error: resultError ?? (code !== 0 ? stderr || `Process exited with code ${code}` : undefined),
        lastMessage: lastProgressMessage,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      clearInterval(heartbeatInterval);
      // Log spawn error to execution.log
      if (options.branchName) {
        appendExecutionLog(options.branchName, `Spawn error: ${err.message}`);
      }
      resolve({
        success: false,
        text: finalText.trim(),
        error: `Failed to start claude process: ${err.message}`,
        lastMessage: lastProgressMessage,
      });
    });
  });
}

/**
 * Run Claude CLI in a worktree context with automatic git auth refresh.
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
3. Run tests if available (npm test, etc.)
4. Commit your changes with a descriptive commit message
5. Output a summary of what you changed

Important:
- Make minimal, focused changes
- Follow existing code patterns and conventions
- Do not make changes outside the scope of the request
- If you encounter issues, explain them clearly

After completing your work, output a line starting with "COMMIT_HASH:" followed by the commit hash.
Then output a line starting with "SUMMARY:" followed by a brief summary of changes.`;

/**
 * Execute the change in the worktree
 */
export async function executeChange(
  plan: ChangePlan,
  worktree: WorktreeInfo,
  request: ChangeRequest,
  onProgress?: (message: string) => void,
  resumeContext?: string
): Promise<ExecutionResult> {
  const config = getConfig();

  // Build the allowed tools list
  const defaultTools = ["Read", "Glob", "Grep", "Write", "Edit", "Bash"];
  const additionalTools = config.changesWorkflow?.additionalAllowedTools ?? [];
  const allowedTools = [...defaultTools, ...additionalTools];

  // Always disallow Task to prevent sub-agents
  const disallowedTools = ["Task"];

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
2. Run tests if available
3. Commit with a descriptive message
4. Output COMMIT_HASH: and SUMMARY: at the end`;

  const result = await runClaudeInWorktree(worktree.repoName, {
    prompt,
    cwd: worktree.worktreePath,
    systemPrompt,
    allowedTools,
    disallowedTools,
    branchName: plan.branchName,
    onProgress,
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Execution failed",
    };
  }

  // Parse commit hash and summary from the result text
  const commitMatch = result.text.match(/COMMIT_HASH:\s*([a-f0-9]+)/i);
  const summaryMatch = result.text.match(/SUMMARY:\s*(.+?)(?:\n|$)/i);

  return {
    success: true,
    commitHash: commitMatch?.[1],
    summary: summaryMatch?.[1] ?? "Changes implemented",
  };
}

// ============================================================================
// Plan Generation
// ============================================================================

const PLAN_GENERATION_PROMPT = `You are analyzing a change request to create an implementation plan.

Given the request message, output a plan in this format:
<change-plan>
  <branch>clack/{type}/{short-description}</branch>
  <description>Clear description of what will be changed</description>
  <repo>{target-repository-name}</repo>
</change-plan>

Where:
- type: fix, feat, refactor, docs, or chore
- short-description: kebab-case, max 30 chars
- repo: exact repository name from available list

Be specific in the description about what changes will be made.`;

/**
 * Generate a change plan using Claude.
 * Used when the user explicitly triggers a change request (e.g., via reaction emoji).
 */
export async function generateChangePlan(
  message: string,
  availableRepos: Array<{ name: string; description: string }>
): Promise<PlanGenerationResult> {
  if (availableRepos.length === 0) {
    return {
      success: false,
      error: "No repositories have changes enabled.",
    };
  }

  const repoList = availableRepos
    .map((r) => `- ${r.name}: ${r.description}`)
    .join("\n");

  const prompt = `Analyze this change request and create a plan:

Request: "${message}"

Available repositories that support changes:
${repoList}`;

  // Use the first enabled repo as cwd for the Claude call
  const reposDir = join(process.cwd(), "data", "repositories");
  const firstRepo = availableRepos[0];
  const cwd = join(reposDir, firstRepo.name);

  const result = await runClaude({
    prompt,
    cwd: existsSync(cwd) ? cwd : process.cwd(),
    systemPrompt: PLAN_GENERATION_PROMPT,
    allowedTools: [], // No tools needed for planning
    disallowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task"],
    timeout: 1, // 1 minute for quick planning
  });

  if (!result.success) {
    return {
      success: false,
      error: result.error ?? "Failed to generate plan",
    };
  }

  if (!result.text) {
    return {
      success: false,
      error: "No response text from Claude",
    };
  }

  // Parse the change plan from result text
  const planMatch = result.text.match(/<change-plan>([\s\S]*?)<\/change-plan>/);
  if (!planMatch) {
    return {
      success: false,
      error: "Failed to parse plan response: no plan found",
    };
  }

  const content = planMatch[1];
  const branchMatch = content.match(/<branch>([\s\S]*?)<\/branch>/);
  const descriptionMatch = content.match(/<description>([\s\S]*?)<\/description>/);
  const repoMatch = content.match(/<repo>([\s\S]*?)<\/repo>/);

  if (!branchMatch || !descriptionMatch || !repoMatch) {
    return {
      success: false,
      error: "Invalid plan: missing required fields",
    };
  }

  const plan = {
    branchName: branchMatch[1].trim(),
    description: descriptionMatch[1].trim(),
    targetRepo: repoMatch[1].trim(),
  };

  // Verify target repo is in the available list
  const targetValid = availableRepos.some(
    (r) => r.name.toLowerCase() === plan.targetRepo.toLowerCase()
  );
  if (!targetValid) {
    return {
      success: false,
      error: `Repository ${plan.targetRepo} not found in available repositories`,
    };
  }

  return { success: true, plan };
}

// ============================================================================
// PR Template Resolution
// ============================================================================

const PR_TEMPLATE_PATHS = [
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/pull_request_template.md",
  "docs/PULL_REQUEST_TEMPLATE.md",
];

const DEFAULT_PR_TEMPLATE = `## Summary

<!-- Brief description of changes -->

## Changes Made

<!-- List of changes -->

## Test Plan

<!-- How to test these changes -->
`;

/**
 * Resolve PR template from repo or fallback locations
 */
export function resolvePRTemplate(worktreePath: string): string {
  // Check repo templates
  for (const templatePath of PR_TEMPLATE_PATHS) {
    const fullPath = join(worktreePath, templatePath);
    if (existsSync(fullPath)) {
      try {
        return readFileSync(fullPath, "utf-8");
      } catch {
        logger.warn(`Failed to read PR template at ${fullPath}`);
      }
    }
  }

  // Check Clack templates directory
  const clackTemplatePath = join(getDefaultConfigurationDir(), "pr-template.md");
  if (existsSync(clackTemplatePath)) {
    try {
      return readFileSync(clackTemplatePath, "utf-8");
    } catch {
      logger.warn(`Failed to read Clack PR template at ${clackTemplatePath}`);
    }
  }

  return DEFAULT_PR_TEMPLATE;
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

  const config = getConfig();
  const timeoutMinutes = config.changesWorkflow?.worktreeSetupTimeoutMinutes ?? 2;

  logger.info(`Running worktree setup for ${repoName}...`);
  if (branchName) {
    appendExecutionLog(branchName, `Running worktree setup instructions from ${setupPath}`);
  }

  const result = await runClaudeInWorktree(repoName, {
    prompt: setupInstructions,
    cwd: worktreePath,
    systemPrompt: "You are setting up a development workspace. Follow the instructions exactly. Do not ask questions — just execute the steps.",
    allowedTools: ["Bash", "Write", "Edit", "Read"],
    disallowedTools: ["Task", "Glob", "Grep"],
    timeout: timeoutMinutes,
    branchName,
  });

  if (!result.success) {
    logger.warn(`Worktree setup failed for ${repoName}: ${result.error}`);
    if (branchName) {
      appendExecutionLog(branchName, `Worktree setup failed: ${result.error}`);
    }
  } else {
    logger.info(`Worktree setup completed for ${repoName}`);
    if (branchName) {
      appendExecutionLog(branchName, "Worktree setup completed successfully");
    }
  }
}
