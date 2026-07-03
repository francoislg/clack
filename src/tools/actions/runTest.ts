import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { canWriteRepo, getWritableRepos } from "../../repoAccess.js";
import type { RepositoryConfig } from "../../config.js";
import type { UserRole } from "../../roles.js";
import { isProtectedBranchName } from "../../changes/branchNaming.js";

export interface RunTestDeps {
  canWriteRepo: (role: UserRole, repo: RepositoryConfig) => boolean;
  getWritableRepos: (role: UserRole, repos: RepositoryConfig[]) => RepositoryConfig[];
}

export const defaultRunTestDeps: RunTestDeps = {
  canWriteRepo,
  getWritableRepos,
};

export function createRunTestTool(
  ctx: QueryToolContext,
  intentStore: IntentStore,
  deps: RunTestDeps = defaultRunTestDeps,
) {
  return tool(
    "run_test",
    "Run a QA test session: boots the app from a branch in a workspace, seeds data, drives it " +
      "in a browser, records a video, and uploads the recording to this thread. By default the " +
      "branch must already exist on the remote (a PR's head branch); set new_branch to test " +
      "current behavior without a PR. Returns a ref ID to use in submit_response.",
    {
      branch: z
        .string()
        .describe(
          "The branch to test. Without new_branch, an EXISTING remote branch — typically an " +
            "open PR's head branch, taken as-is. With new_branch, a fresh throwaway slug " +
            "(e.g. test/record-feature-x).",
        ),
      repo: z.string().describe("Repository name the branch belongs to"),
      new_branch: z
        .boolean()
        .optional()
        .describe(
          "Create a fresh throwaway branch off the default branch instead of resuming an " +
            "existing remote branch. Use when the user asks to test or record CURRENT behavior " +
            "rather than a PR, and name the branch a throwaway slug (e.g. test/record-feature-x).",
        ),
      test_focus: z
        .string()
        .optional()
        .describe(
          "What to exercise: the flows, pages, or behaviors the test should drive and record. " +
            "Include details the USER stated in the conversation — the tester does NOT see the " +
            "Slack thread. Do NOT copy boot/setup knowledge from recalled memories (ports, seed " +
            "strategy, auth workarounds): the tester receives learned setup notes directly, and " +
            "repeating them here freezes potentially stale facts as authoritative instructions.",
        ),
    },
    async (args) => {
      const repo = ctx.config.repositories.find((r) => r.name === args.repo);
      if (!repo) {
        const availableRepos = ctx.config.repositories.map((r) => r.name);
        return errorResult(
          `Repository "${args.repo}" not found. Available repositories: ${availableRepos.join(", ")}`,
        );
      }

      if (!deps.canWriteRepo(ctx.role, repo)) {
        const writableRepos = deps
          .getWritableRepos(ctx.role, ctx.config.repositories)
          .map((r) => r.name);
        return errorResult(
          `You do not have write access to "${args.repo}".${
            writableRepos.length > 0
              ? ` Repos you can test: ${writableRepos.join(", ")}`
              : " No repos have change support for your role."
          }`,
        );
      }

      if (isProtectedBranchName(args.branch, repo.branch || "main")) {
        return errorResult(
          `Cannot run a test on protected branch "${args.branch}". Target a PR's head branch instead.`,
        );
      }

      const target = args.new_branch
        ? `on a fresh branch off ${repo.branch || "main"}`
        : `on branch ${args.branch}`;
      const description = args.test_focus
        ? `Test the app ${target}: ${args.test_focus}`
        : `Test the app ${target}`;

      const ref = intentStore.stage({
        type: "change",
        kind: "test",
        branch: args.branch,
        description,
        repo: args.repo,
        resumeRemoteBranch: !args.new_branch,
      });

      return textResult({
        ref,
        branch: args.branch,
        repo: args.repo,
        description,
        applied: false,
        instruction:
          "STAGED — no workspace has been acquired and no test has started yet. The user must " +
          "click the action button to launch the test run. Attach a `change` action with this " +
          "ref to your submit_response and set its label to a test-flavored one (e.g. " +
          "'Start Test'). Use pending language in your prose — the test has NOT run.",
      });
    },
  );
}
