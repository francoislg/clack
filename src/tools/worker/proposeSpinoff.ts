import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext, StagedSpinoffIntent } from "../types.js";
import type { IntentStore } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { BRANCH_PATTERN, BRANCH_TYPES } from "../../changes/branchNaming.js";
import {
  defaultSpinoffGitOps,
  spinoffIntentSchema,
  spinoffPatchPath,
  type SpinoffGitOps,
} from "../../changes/spinoff.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { errorMessage } from "../../errors.js";

export interface ProposeSpinoffDeps {
  gitOps: SpinoffGitOps;
  appendExecutionLog: (branchName: string, message: string) => void;
}

export const defaultProposeSpinoffDeps: ProposeSpinoffDeps = {
  gitOps: defaultSpinoffGitOps,
  appendExecutionLog,
};

export function createProposeSpinoffTool(
  ctx: WorkerToolContext,
  intentStore: IntentStore,
  deps: ProposeSpinoffDeps = defaultProposeSpinoffDeps,
) {
  return tool(
    "propose_spinoff",
    "Carve a slice of your CURRENT uncommitted changes into a SEPARATE pull request, handled as a standalone sibling change with its own Slack thread. Use ONLY for a self-contained slice that does not belong in this PR (e.g. an unrelated refactor that surfaced, or a reviewer asked to split it out) — never to spin off the whole change. The named paths are captured and REMOVED from this branch, so this PR keeps only the remaining work.",
    {
      paths: z
        .array(z.string().min(1))
        .min(1)
        .describe("Repo-relative file paths whose current changes form the slice to spin off"),
      description: z
        .string()
        .min(1)
        .describe(
          "What this slice is and why it belongs in its own PR — drives the sibling's work",
        ),
      proposed_branch: z
        .string()
        .describe(
          `Branch name for the sibling, following convention: clack/{type}/{name} where type is one of: ${BRANCH_TYPES.join(", ")}`,
        ),
    },
    async (args) => {
      if (!BRANCH_PATTERN.test(args.proposed_branch)) {
        return errorResult(
          `Invalid proposed_branch "${args.proposed_branch}". Must follow convention: clack/{type}/{name} where type is one of: ${BRANCH_TYPES.join(", ")}`,
        );
      }
      if (args.proposed_branch === ctx.branchName) {
        return errorResult(
          `proposed_branch must differ from the current branch "${ctx.branchName}" — a spinoff goes to its own branch.`,
        );
      }

      const existingSpinoffs = [...intentStore.getAll().values()].filter(
        (i) => i.type === "spinoff",
      ).length;
      const patchPath = spinoffPatchPath(ctx.branchName, existingSpinoffs);

      let patch: string;
      try {
        patch = await deps.gitOps.captureAndRevertSlice(ctx.worktreePath, args.paths, patchPath);
      } catch (error) {
        return errorResult(`Failed to capture spinoff slice: ${errorMessage(error)}`);
      }

      if (patch.trim().length === 0) {
        return errorResult(
          `No changes found for the given paths — nothing to spin off. The paths must have uncommitted modifications or be newly-added files in this worktree.`,
        );
      }

      const parsed = spinoffIntentSchema.safeParse({
        paths: args.paths,
        description: args.description,
        proposedBranch: args.proposed_branch,
        patchPath,
      });
      if (!parsed.success) {
        return errorResult(
          `Invalid spinoff: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
        );
      }

      const intent: StagedSpinoffIntent = { type: "spinoff", ...parsed.data };
      const ref = intentStore.stage(intent);
      deps.appendExecutionLog(
        ctx.branchName,
        `propose_spinoff: staged slice for ${args.proposed_branch} (${args.paths.length} path(s)), patch at ${patchPath}`,
      );

      return textResult({
        ref,
        proposed_branch: args.proposed_branch,
        paths: args.paths,
        applied: false,
        instruction:
          "STAGED — the slice's changes have been REMOVED from this worktree and saved to a patch. A separate sibling PR will be created automatically for it after you finish here. Do NOT re-add these files to the current PR. Continue with the remaining work and commit/push as usual.",
      });
    },
  );
}
