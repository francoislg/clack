import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { readSessionState } from "../../changes/persistence.js";
import type { PersistedSessionState } from "../../changes/types.js";
import {
  findActiveChangeByBranch,
  classifyChangeSession,
  getActiveChangeRef,
} from "../../changes/activeState.js";
import { lazyDefaultPool } from "../../workers/index.js";
import type { Worker } from "../../workers/types.js";
import { canWriteRepo, getWritableRepos } from "../../repoAccess.js";
import type { RepositoryConfig } from "../../config.js";
import type { UserRole } from "../../roles.js";
import { BRANCH_PATTERN, BRANCH_TYPES, isProtectedBranchName } from "../../changes/branchNaming.js";

export interface ProposeChangeDeps {
  /** Mode-agnostic branch lookup — works for reusable worker-N folders AND disposable worktrees. */
  findWorkerByBranch: (repoName: string, branch: string) => Worker | null;
  readSessionState: (branchName: string) => Promise<PersistedSessionState | null>;
  canWriteRepo: (role: UserRole, repo: RepositoryConfig) => boolean;
  getWritableRepos: (role: UserRole, repos: RepositoryConfig[]) => RepositoryConfig[];
  findActiveChangeByBranch: typeof findActiveChangeByBranch;
  classifyChangeSession: typeof classifyChangeSession;
  getActiveChangeRef: typeof getActiveChangeRef;
}

export const defaultProposeChangeDeps: ProposeChangeDeps = {
  findWorkerByBranch: (repoName, branch) => lazyDefaultPool().findByBranch(repoName, branch),
  readSessionState,
  canWriteRepo,
  getWritableRepos,
  findActiveChangeByBranch,
  classifyChangeSession,
  getActiveChangeRef,
};

export type ContinuationState = "resume-here" | "adopt" | "live" | "fresh";

const CONTINUATION_GUIDANCE: Record<ContinuationState, string> = {
  "resume-here":
    "This branch's change session already belongs to this conversation — starting the change continues it in place.",
  adopt:
    "This branch's change session lives in ANOTHER conversation but is idle. Starting the change here will MOVE the session into this conversation (worker context, PR state, and follow-up buttons come along; the previous thread's buttons will point here). Tell the user this is a takeover-style continuation.",
  live: "A run is ACTIVELY EXECUTING on this branch in another conversation. Starting a change here will be refused — suggest the user continue from that conversation or wait for the run to finish.",
  fresh:
    "Existing work was found for this branch but no live change session. Continuing will resume from the branch's current state.",
};

export function createProposeChangeTool(
  ctx: QueryToolContext,
  intentStore: IntentStore,
  deps: ProposeChangeDeps = defaultProposeChangeDeps,
) {
  return tool(
    "propose_change",
    "Propose a code change. Validates branch name, repo, and checks for existing worktrees. Returns a ref ID to use in submit_response.",
    {
      branch: z
        .string()
        .describe(
          `Branch name following convention: clack/{type}/{name} where type is one of: ${BRANCH_TYPES.join(", ")}`,
        ),
      description: z.string().describe("Brief description of the change to make"),
      repo: z.string().describe("Repository name to make the change in"),
      plan: z
        .string()
        .optional()
        .describe(
          "Detailed implementation plan from the conversation — file list, approach, edge cases, anything you've worked out with the user. Include this whenever the discussion produced more detail than fits in `description`. The worker sees only what you stage here; it does NOT see the Slack thread, so any nuance you omit will be re-derived (or lost) by the worker.",
        ),
      continue_existing_pr: z
        .boolean()
        .optional()
        .describe(
          "Set true ONLY when `branch` is an EXISTING remote branch you are continuing (e.g. addressing review comments on its open PR, or pushing follow-up commits to a branch a human already created), not starting fresh. The worker is acquired from the branch's own remote head so its commits are preserved instead of being reset to the default branch. When true, the `clack/{type}/{name}` naming convention is NOT enforced — the branch already exists, so its name is taken as-is.",
        ),
    },
    async (args) => {
      // The convention only constrains NEW branches. A continuation targets a branch that
      // already exists, so its name is taken as-is; a name that isn't really on the remote
      // fails later with RemoteBranchNotFound rather than minting an off-convention branch.
      if (!args.continue_existing_pr && !BRANCH_PATTERN.test(args.branch)) {
        const errMsg = `Invalid branch name "${args.branch}". Must follow convention: clack/{type}/{name} where type is one of: ${BRANCH_TYPES.join(", ")}`;
        return errorResult(errMsg);
      }

      // Validate repo exists and user has write access
      const repo = ctx.config.repositories.find((r) => r.name === args.repo);
      if (!repo) {
        const availableRepos = ctx.config.repositories.map((r) => r.name);
        const errMsg = `Repository "${args.repo}" not found. Available repositories: ${availableRepos.join(", ")}`;
        return errorResult(errMsg);
      }

      if (!deps.canWriteRepo(ctx.role, repo)) {
        const writableRepos = deps
          .getWritableRepos(ctx.role, ctx.config.repositories)
          .map((r) => r.name);
        const errMsg = `You do not have write access to "${args.repo}".${writableRepos.length > 0 ? ` Repos you can change: ${writableRepos.join(", ")}` : " No repos have change support for your role."}`;
        return errorResult(errMsg);
      }

      // Refused even on continuation: relaxing the convention must not let a change target the
      // default/protected branch, which would never be a valid PR branch to push to.
      if (isProtectedBranchName(args.branch, repo.branch || "main")) {
        return errorResult(
          `Cannot make changes directly on protected branch "${args.branch}". Use a feature branch.`,
        );
      }

      // Existing-work detection: pool-based branch lookup (mode-agnostic) plus the
      // live change-session registry, so Claude knows what continuation will do
      // BEFORE any button is clicked. Advisory only — enforcement is at execution.
      let existingWorktreeInfo:
        | {
            status: string;
            lastActivity: string;
            continuation: ContinuationState;
            owner?: string;
            guidance: string;
          }
        | undefined;
      const existingSession = deps.findActiveChangeByBranch(args.repo, args.branch);
      const workerOnBranch = deps.findWorkerByBranch(args.repo, args.branch);
      if (existingSession || workerOnBranch) {
        const sessionState = await deps.readSessionState(args.branch);
        let continuation: ContinuationState = "fresh";
        let owner: string | undefined;
        if (existingSession) {
          if (existingSession.sessionId === ctx.session.sessionId) {
            continuation = "resume-here";
          } else {
            const liveness = deps.classifyChangeSession(existingSession.sessionId);
            continuation = liveness === "live" ? "live" : "adopt";
            owner = deps.getActiveChangeRef(existingSession.sessionId)?.userId;
          }
        }
        existingWorktreeInfo = {
          status: sessionState?.status ?? existingSession?.change.status ?? "unknown",
          lastActivity:
            sessionState?.lastActivityAt ??
            (workerOnBranch?.lastUsedAt ?? new Date()).toISOString(),
          continuation,
          ...(owner && { owner }),
          guidance: CONTINUATION_GUIDANCE[continuation],
        };
      }

      // Stage the intent
      const ref = intentStore.stage({
        type: "change",
        branch: args.branch,
        description: args.description,
        repo: args.repo,
        ...(args.plan && { plan: args.plan }),
        ...(args.continue_existing_pr && { resumeRemoteBranch: true }),
        existingWorktree: existingWorktreeInfo,
      });

      const result = {
        ref,
        branch: args.branch,
        description: args.description,
        repo: args.repo,
        ...(args.plan && { plan: args.plan }),
        existingWorktree: existingWorktreeInfo,
        applied: false,
        instruction:
          "STAGED — no worktree, branch, or code has been created yet. The user must click 'Start Change' to launch the worker. Your submit_response prose MUST reflect this: use pending language ('I've drafted a plan...', 'Ready when you are — click below to start the change'). Do NOT use 'Done', 'I'll create...', 'I've started...' — those imply work has begun, which it hasn't until the click.",
      };

      return textResult(result);
    },
  );
}
