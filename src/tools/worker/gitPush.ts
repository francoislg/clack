import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getAuthenticatedCloneUrl } from "../../github.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { errorMessage } from "../../errors.js";
import { simpleGit } from "simple-git";
import {
  loadVerificationConfig,
  type VerificationConfig,
} from "../../changes/verification/config.js";
import { runVerificationChecks, type GateRunResult } from "../../changes/verification/runner.js";
import { getActiveChange, type ActiveChangeState } from "../../changes/activeState.js";

const MAX_ERROR_OUTPUT_BYTES = 6 * 1024;
const MAX_ERROR_OUTPUT_LINES = 80;

/**
 * Minimal subset of `SimpleGit` the push tool needs. The default dep wraps the
 * real `SimpleGit` to match this shape; tests can provide a stub without
 * casting to `SimpleGit`.
 */
export interface MinimalGit {
  remote(args: string[]): Promise<void>;
  push(args: string[]): Promise<void>;
}

export interface GitPushDeps {
  getAuthenticatedCloneUrl: (repoUrl: string) => Promise<string>;
  appendExecutionLog: (branchName: string, message: string) => void;
  simpleGit: (opts: { baseDir: string }) => MinimalGit;
  loadVerificationConfig: (repoName: string) => VerificationConfig | null;
  runVerificationChecks: typeof runVerificationChecks;
  getActiveChange: (sessionId: string) => ActiveChangeState | undefined;
}

export const defaultGitPushDeps: GitPushDeps = {
  getAuthenticatedCloneUrl,
  appendExecutionLog,
  simpleGit: (opts: { baseDir: string }): MinimalGit => {
    const git = simpleGit({ baseDir: opts.baseDir });
    return {
      remote: async (args: string[]): Promise<void> => {
        await git.remote(args);
      },
      push: async (args: string[]): Promise<void> => {
        await git.push(args);
      },
    };
  },
  loadVerificationConfig,
  runVerificationChecks,
  getActiveChange,
};

function truncateFailureOutput(output: string): string {
  const lines = output.split("\n");
  const byLines =
    lines.length > MAX_ERROR_OUTPUT_LINES
      ? lines.slice(-MAX_ERROR_OUTPUT_LINES).join("\n")
      : output;
  const buf = Buffer.from(byLines, "utf-8");
  if (buf.byteLength <= MAX_ERROR_OUTPUT_BYTES) return byLines;
  return buf.subarray(buf.byteLength - MAX_ERROR_OUTPUT_BYTES).toString("utf-8");
}

function formatGateFailure(
  gate: Extract<GateRunResult, { result: "fail" }>,
  remainingAttempts: number,
): string {
  const reason = gate.failure.timedOut ? "timed out" : `exit code ${gate.failure.exitCode}`;
  const truncated = truncateFailureOutput(gate.failure.output);
  return [
    `Verification check "${gate.failure.checkName}" failed (${reason}).`,
    "",
    truncated,
    "",
    `Fix the failures and try again. You have ${remainingAttempts} retry attempts remaining.`,
  ].join("\n");
}

function formatTerminalFailure(
  gate: Extract<GateRunResult, { result: "fail" }>,
  totalAttempts: number,
): string {
  const reason = gate.failure.timedOut ? "timed out" : `exit code ${gate.failure.exitCode}`;
  const truncated = truncateFailureOutput(gate.failure.output);
  return [
    `Verification check "${gate.failure.checkName}" failed (${reason}).`,
    "",
    truncated,
    "",
    `Retry budget exhausted after ${totalAttempts} attempts. Do not attempt git_push again. Call report_status with a summary and stop.`,
  ].join("\n");
}

export function createGitPushTool(ctx: WorkerToolContext, deps: GitPushDeps = defaultGitPushDeps) {
  return tool(
    "git_push",
    "Push the current branch to the remote origin. Returns success or a structured error if the push fails (e.g., hook failure, auth error).",
    {
      // Claude Agent SDK requires at least one schema property
      _placeholder: z.boolean().optional().describe("Unused parameter"),
    },
    async () => {
      try {
        const config = deps.loadVerificationConfig(ctx.repoName);
        if (config && config.checks.length > 0) {
          const activeChange = deps.getActiveChange(ctx.sessionId);
          const priorAttempts = activeChange?.verificationAttempts ?? 0;

          deps.appendExecutionLog(
            ctx.branchName,
            `Verification gate: running ${config.checks.length} check(s)`,
          );

          const gate = await deps.runVerificationChecks({
            worktreePath: ctx.worktreePath,
            branchName: ctx.branchName,
            checks: config.checks,
          });

          if (gate.result === "fail") {
            const newAttempts = priorAttempts + 1;
            if (activeChange) {
              activeChange.verificationAttempts = newAttempts;
            }
            if (newAttempts >= config.retryBudget) {
              deps.appendExecutionLog(
                ctx.branchName,
                `Verification: budget exhausted after ${newAttempts} attempts — aborting`,
              );
              return errorResult(formatTerminalFailure(gate, newAttempts));
            }
            const remaining = config.retryBudget - newAttempts;
            return errorResult(formatGateFailure(gate, remaining));
          }

          deps.appendExecutionLog(ctx.branchName, "Verification gate: all checks passed");
        }

        const authenticatedUrl = await deps.getAuthenticatedCloneUrl(ctx.repoUrl);
        const git = deps.simpleGit({ baseDir: ctx.worktreePath });
        await git.remote(["set-url", "origin", authenticatedUrl]);
        await git.push(["-u", "origin", ctx.branchName]);

        deps.appendExecutionLog(ctx.branchName, "git_push: pushed successfully");

        return textResult({ success: true });
      } catch (error) {
        const msg = errorMessage(error);
        // Logging failures are swallowed to preserve the MCP tool contract
        // (tools must never throw). If the initial log can't be written, the
        // best we can do is surface the push error.
        try {
          deps.appendExecutionLog(ctx.branchName, `git_push: failed - ${msg}`);
        } catch {
          // ignore — persistence is already unreliable at this point
        }

        return errorResult(`push failed: ${msg}`);
      }
    },
  );
}
