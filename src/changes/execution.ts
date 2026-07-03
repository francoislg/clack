import { clackSession } from "../claude/query.js";
import { existsSync, readFileSync } from "node:fs";
import { simpleGit } from "simple-git";
import { getConfig, findRepoByName, getWorkerSettingsPath, type Config } from "../config.js";
import { t } from "../i18n/t.js";
import { buildTesterSystemPrompt, buildTesterUserPrompt } from "../tester/prompt.js";
import { teardownAppProcess } from "../tester/processTeardown.js";
import { buildPlaywrightMcpServerConfig } from "../tester/sidecar.js";
import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { errorMessage } from "../errors.js";
import { resolveInstructionFile } from "../instructions.js";
import { logger } from "../logger.js";
import { setAuthenticatedRemote } from "../repositories.js";
import type { WorktreeInfo } from "../worktrees.js";
import type { ChangePlan, ChangeRequest, ExecutionResult } from "./types.js";
import type { SpinoffIntentData } from "./spinoff.js";
import { appendExecutionLog } from "./persistence.js";
import { appendWorkerSkillsCatalog } from "./workerSkillsCatalog.js";
import {
  loadSetupNotes,
  buildSetupMemoryPromptSections,
  setupNotesLogLine,
} from "../memory/setupMemory.js";
import { buildWorkerBashGuardHook } from "./workerBashGuard.js";
import { getActiveChange } from "./activeState.js";
import { detectPlatformError } from "../claude/messageParser.js";
import { ClaudeMessageParser } from "../claude/messageParser.js";
import type { SessionUsage } from "../claude/usage.js";
import { addSessionUsage } from "../sessions.js";
import { detectRuntime } from "../claude/utilities.js";
import { buildWorkerContext } from "../tools/context.js";
import { getUserRecord } from "../userRegistry.js";
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
}): Promise<{
  success: boolean;
  text: string;
  error?: string;
  lastMessage?: string;
  usage?: SessionUsage;
}> {
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

  // Optional operator-provided native settings.json — forwarded to the SDK to attach
  // external guardrails (PreToolUse command hooks, permissions.deny) without any
  // tool-specific code. Absolute path (worker cwd is a per-run worktree). Absent → omitted.
  const workerSettingsPath = getWorkerSettingsPath();
  const workerSettings = existsSync(workerSettingsPath) ? workerSettingsPath : undefined;
  if (workerSettings) log?.(`Loading worker settings from ${workerSettings}`);

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
      hooks: { PreToolUse: [buildWorkerBashGuardHook()] },
      plugins: discoverEagerSkillPlugins(),
      ...(workerSettings && { settings: workerSettings }),
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
      usage: parser.result?.usage,
    };
  }

  log?.(`Query completed (success: ${resultSuccess}, text: ${finalText.trim().length} chars)`);

  return {
    success: resultSuccess,
    text: finalText.trim(),
    error: resultError,
    lastMessage: lastProgressMessage,
    usage: parser.result?.usage,
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
5. Push the branch using the git_push tool (after a rebase that diverged from the remote, call git_push with force=true to force-push with lease)
6. Create or update the pull request using the ensure_pr tool
7. Verify CI using the await_ci tool. Only sign off as successful when it returns "passed". On "failed", surface the failing checks and fix them (then push and await_ci again) or report the failure via report_status. On "timed_out" or "pending", report via report_status that CI did not conclusively pass — do NOT claim success
8. Report your final status using the report_status tool

On starting this task, call the remember tool to tag your work in Clack's memory: id "worker:<branch>" (re-key to "pr:<number>" once a PR exists), what = a one-line description of the change, why = the requesting context, and staleAfter.date roughly 30 days out. This makes in-flight work visible in memory; do it once at the start.

Important:
- Make minimal, focused changes
- Follow existing code patterns and conventions
- Do not make changes outside the scope of the request
- If a self-contained slice of your work clearly belongs in its OWN pull request — e.g. an unrelated refactor surfaced while you worked, or a reviewer asked you to split it out — use the propose_spinoff tool to carve just that slice into a separate sibling change. Never spin off the whole change (that is just this PR), and keep the remaining work in this PR as normal.
- If you encounter issues, report them via report_status
- Never run \`git push\` directly via Bash — it is blocked in worker mode. Always push with the git_push tool, which enforces the protected-branch and force-with-lease rules
- If git_push fails, report the error via report_status — do not retry unless you can fix the issue
- For the PR title, use a concise description (max 72 chars) — do NOT put "Requested by" or the requester's name in the title
- For the PR summary, describe what was changed and why. If the prompt provides a "Requested by:" line, include it verbatim at the top of the PR body (never in the title)`;

const REVIEWER_RESOLUTION_GUIDANCE = `

PR REVIEWERS (enabled for this workspace):
When you call ensure_pr, pass a \`reviewers\` array of GitHub logins chosen by your judgement. To resolve a reviewer whose GitHub login you don't already know:
- Fetch the repository's collaborators via the GitHub MCP tools — everyone with access to THIS repo (org members with repo access AND outside collaborators), NOT the whole organization roster.
- High-confidence path: if the candidate's Slack profile email is available, match it case-insensitively and exactly against a collaborator's email. On a match, persist it with the update_user tool (github.username) and use that login.
- Fallback: if no email is available or there is no exact email match, leave the user unmapped — do NOT write a name-only guess via update_user and do NOT request them as a reviewer. (The Slack users:read.email scope is optional; matching simply degrades to "no reviewer" without it.)
- The PR author is excluded automatically; don't add them.
If no reviewer can be resolved, still create the PR — ensure_pr surfaces a non-fatal warning and the PR is created regardless.`;

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

  if (plan.kind === "test") {
    return executeTest(opts, config);
  }

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

  // Append the WORKER SKILLS catalog when any worker skill resolves for this repo. Absent
  // skills leave the prompt unchanged.
  systemPrompt = appendWorkerSkillsCatalog(systemPrompt, worktree.repoName);

  // Learned setup notes (advisory, from previous runs) + the directive to maintain them.
  // A missing entry is the normal cold-run path — only the directive is injected then.
  const setupNotes = await loadSetupNotes("worker", worktree.repoName);
  appendExecutionLog(plan.branchName, setupNotesLogLine(setupNotes));
  systemPrompt += buildSetupMemoryPromptSections(
    "worker",
    worktree.repoName,
    setupNotes?.notes ?? null,
  );

  if (config.changesWorkflow?.requirePRReviewers) {
    systemPrompt += REVIEWER_RESOLUTION_GUIDANCE;
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
  const requesterRecord = await getUserRecord(request.userId);
  const workerCtx = buildWorkerContext({
    worktreePath: worktree.worktreePath,
    branchName: plan.branchName,
    repoName: worktree.repoName,
    repoUrl: repo?.url ?? "",
    channelId: request.channel,
    threadTs: request.threadTs ?? request.messageTs,
    sessionId,
    ...(request.silent && { silent: true }),
    config,
    requirePRReviewers: config.changesWorkflow?.requirePRReviewers ?? false,
    requestingUserGithubUsername: requesterRecord?.github?.username ?? null,
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

  // Fold this worker run's usage back onto the originating session so the durable session
  // record holds the session's TOTAL spend even after this worktree's PR closes and its
  // resumable record is cleaned up. Runs for success, failure, and no-op alike.
  if (result.usage) {
    await addSessionUsage(sessionId, result.usage);
  }

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

  const stagedSpinoffs = drainStagedSpinoffs(workerTools);

  return {
    success: true,
    summary: "Changes implemented",
    sdkSessionId: capturedSdkSessionId,
    ...(stagedSpinoffs.length > 0 && { stagedSpinoffs }),
  };
}

/**
 * Tester run: boot the app from the (already checked-out) PR branch, drive it via the
 * Playwright MCP sidecar, record, upload, and narrate. Differences from an implement run:
 * reduced-privilege toolbelt (kind: "test"), no authenticated-push-remote refresh (git
 * stays read-only — `runClaude` directly, not `runClaudeInWorktree`), the Playwright MCP
 * attached alongside the clack server, success judged by the run itself (no HEAD/PR
 * no-op check), and guaranteed app-process teardown on every exit path.
 */
async function executeTest(opts: ExecuteChangeOptions, config: Config): Promise<ExecutionResult> {
  const { plan, worktree, request, sessionId, onEvent, abortController, onHandle } = opts;

  const tester = config.tester;
  if (!tester?.enabled || !tester.sidecarUrl) {
    return { success: false, error: t("tester.not_enabled") };
  }

  const requester = request.userDisplayName?.trim() || `Slack user ${request.userId}`;
  const testerSetupNotes = await loadSetupNotes("tester", worktree.repoName);
  appendExecutionLog(plan.branchName, setupNotesLogLine(testerSetupNotes));
  const promptOpts = {
    description: plan.description,
    branchName: plan.branchName,
    repoName: worktree.repoName,
    requester,
    tester,
    learnedNotes: testerSetupNotes?.notes ?? null,
  };

  const workerCtx = buildWorkerContext({
    worktreePath: worktree.worktreePath,
    branchName: plan.branchName,
    repoName: worktree.repoName,
    repoUrl: "",
    channelId: request.channel,
    threadTs: request.threadTs ?? request.messageTs,
    sessionId,
    kind: "test",
    config,
  });
  const testerTools = buildClackTools(workerCtx);

  let capturedSdkSessionId: string | undefined;
  try {
    const result = await runClaude({
      prompt: buildTesterUserPrompt(promptOpts),
      cwd: worktree.worktreePath,
      systemPrompt: buildTesterSystemPrompt(promptOpts),
      allowedTools: ["Read", "Glob", "Grep", "Bash", "ToolSearch"],
      disallowedTools: ["Task", "TaskOutput", "Write", "Edit"],
      branchName: plan.branchName,
      mcpServers: {
        clack: testerTools.mcpServer,
        playwright: buildPlaywrightMcpServerConfig(tester.sidecarUrl),
      },
      onEvent,
      abortController,
      ...(onHandle && { onHandle }),
      onSessionId: (id) => {
        capturedSdkSessionId = id;
      },
    });

    if (result.usage) {
      await addSessionUsage(sessionId, result.usage);
    }

    if (!result.success) {
      return {
        success: false,
        error: result.error ?? "Test run failed",
        sdkSessionId: capturedSdkSessionId,
      };
    }

    return {
      success: true,
      summary: "Test run complete",
      sdkSessionId: capturedSdkSessionId,
    };
  } finally {
    await teardownAppProcess(worktree.worktreePath);
  }
}

/**
 * Pull the spinoff slices a worker staged via `propose_spinoff` out of the worker tool
 * result, dropping the staging `type` tag so the orchestrator gets plain slice data.
 */
function drainStagedSpinoffs(workerTools: ReturnType<typeof buildClackTools>): SpinoffIntentData[] {
  const spinoffs: SpinoffIntentData[] = [];
  for (const intent of workerTools.getStagedIntents().values()) {
    if (intent.type === "spinoff") {
      const { type: _type, ...data } = intent;
      spinoffs.push(data);
    }
  }
  return spinoffs;
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
