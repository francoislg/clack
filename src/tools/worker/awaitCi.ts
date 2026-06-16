import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getActiveChange, type ActiveChangeState } from "../../changes/activeState.js";
import { getPRChecks, type CIChecksSnapshot } from "../../changes/pr.js";
import { appendExecutionLog } from "../../changes/persistence.js";

/** How long to keep polling check-runs before giving up with a `timed_out`/`pending` verdict. */
const DEFAULT_CAP_MS = 10 * 60 * 1000;
/** Delay between check-run polls. */
const DEFAULT_INTERVAL_MS = 15 * 1000;

export interface AwaitCiDeps {
  getActiveChange: (sessionId: string) => ActiveChangeState | undefined;
  getPRChecks: (prUrl: string) => Promise<CIChecksSnapshot | null>;
  appendExecutionLog: (branchName: string, message: string) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  capMs: number;
  intervalMs: number;
}

export const defaultAwaitCiDeps: AwaitCiDeps = {
  getActiveChange,
  getPRChecks,
  appendExecutionLog,
  sleep: (ms: number) => new Promise((res) => setTimeout(res, ms)),
  now: () => Date.now(),
  capMs: DEFAULT_CAP_MS,
  intervalMs: DEFAULT_INTERVAL_MS,
};

export function createAwaitCiTool(ctx: WorkerToolContext, deps: AwaitCiDeps = defaultAwaitCiDeps) {
  return tool(
    "await_ci",
    'Wait for the pull request\'s CI checks to resolve, then return the verdict. Blocks until checks pass/fail or a time cap is reached. Call this after ensure_pr and only sign off as successful when the verdict is "passed".',
    {
      _placeholder: z.boolean().optional().describe("Unused parameter"),
    },
    async () => {
      const prUrl = deps.getActiveChange(ctx.sessionId)?.prUrl;
      if (!prUrl) {
        return errorResult(
          "No pull request exists for this change yet. Call ensure_pr first, then await_ci.",
        );
      }

      const deadline = deps.now() + deps.capMs;
      let sawSnapshot: CIChecksSnapshot | null = null;

      for (;;) {
        const snapshot = await deps.getPRChecks(prUrl);
        if (snapshot) {
          sawSnapshot = snapshot;
          if (snapshot.status === "some_failed") {
            deps.appendExecutionLog(
              ctx.branchName,
              `await_ci: failed (${snapshot.failedChecks.map((c) => c.name).join(", ")})`,
            );
            return textResult({
              state: "failed",
              failedChecks: snapshot.failedChecks,
              pendingChecks: [],
            });
          }
          if (snapshot.status === "all_passed") {
            deps.appendExecutionLog(ctx.branchName, "await_ci: passed");
            return textResult({ state: "passed", failedChecks: [], pendingChecks: [] });
          }
        }

        if (deps.now() >= deadline) {
          if (sawSnapshot?.status === "in_progress") {
            deps.appendExecutionLog(ctx.branchName, "await_ci: timed out (checks still running)");
            return textResult({
              state: "timed_out",
              failedChecks: [],
              pendingChecks: sawSnapshot.pendingChecks,
            });
          }
          if (sawSnapshot?.status === "no_checks") {
            deps.appendExecutionLog(ctx.branchName, "await_ci: pending (no checks registered)");
            return textResult({ state: "pending", failedChecks: [], pendingChecks: [] });
          }
          deps.appendExecutionLog(ctx.branchName, "await_ci: could not read CI status");
          return errorResult(
            "Could not read CI status from GitHub for this pull request. The PR is open but its checks could not be retrieved.",
          );
        }

        await deps.sleep(deps.intervalMs);
      }
    },
  );
}
