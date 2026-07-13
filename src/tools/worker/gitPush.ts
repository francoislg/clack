import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { WorkerToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getAuthenticatedCloneUrl } from "../../github.js";
import { appendExecutionLog } from "../../changes/persistence.js";
import { findRepoByName, type Config, type RepositoryConfig } from "../../config.js";
import { errorMessage } from "../../errors.js";
import { isProtectedBranchName } from "../../changes/branchNaming.js";
import { isMissingRemoteRef } from "../../workers/branchSwitch.js";
import { simpleGit } from "simple-git";

/**
 * Minimal subset of `SimpleGit` the push tool needs. The default dep wraps the
 * real `SimpleGit` to match this shape; tests can provide a stub without
 * casting to `SimpleGit`.
 */
export interface MinimalGit {
  remote(args: string[]): Promise<void>;
  fetch(args: string[]): Promise<void>;
  push(args: string[]): Promise<void>;
  revparse(args: string[]): Promise<string>;
}

export interface GitPushDeps {
  getAuthenticatedCloneUrl: (repoUrl: string) => Promise<string>;
  appendExecutionLog: (branchName: string, message: string) => void;
  findRepoByName: (name: string, config: Config) => RepositoryConfig | undefined;
  simpleGit: (opts: { baseDir: string }) => MinimalGit;
}

export const defaultGitPushDeps: GitPushDeps = {
  getAuthenticatedCloneUrl,
  appendExecutionLog,
  findRepoByName,
  simpleGit: (opts: { baseDir: string }): MinimalGit => {
    const git = simpleGit({ baseDir: opts.baseDir });
    return {
      remote: async (args: string[]): Promise<void> => {
        await git.remote(args);
      },
      fetch: async (args: string[]): Promise<void> => {
        await git.fetch(args);
      },
      push: async (args: string[]): Promise<void> => {
        await git.push(args);
      },
      revparse: async (args: string[]): Promise<string> => {
        return await git.revparse(args);
      },
    };
  },
};

export function createGitPushTool(ctx: WorkerToolContext, deps: GitPushDeps = defaultGitPushDeps) {
  return tool(
    "git_push",
    "Push the current branch to the remote origin. Set force=true to force-push with lease (only safe after a rebase). Returns success or a structured error if the push fails (e.g., hook failure, auth error, remote rejection).",
    {
      force: z
        .boolean()
        .optional()
        .describe(
          "Force-push with lease (--force-with-lease). Use ONLY when the branch history diverged (e.g. after a rebase) and a normal push is rejected as non-fast-forward. Never pushes a bare --force.",
        ),
    },
    async (args) => {
      try {
        const defaultBranch = deps.findRepoByName(ctx.repoName, ctx.config)?.branch || "main";

        if (isProtectedBranchName(ctx.branchName, defaultBranch)) {
          deps.appendExecutionLog(
            ctx.branchName,
            `git_push: refused — "${ctx.branchName}" is a protected branch`,
          );
          return errorResult(
            `Refusing to push to protected branch "${ctx.branchName}". Worker changes must be pushed on a clack/<type>/<name> branch and merged via a pull request.`,
          );
        }

        const authenticatedUrl = await deps.getAuthenticatedCloneUrl(ctx.repoUrl);
        const git = deps.simpleGit({ baseDir: ctx.worktreePath });
        await git.remote(["set-url", "origin", authenticatedUrl]);

        if (args.force) {
          // The implicit --force-with-lease resolves its expected value through
          // the remote's configured fetch refspec. Shallow clones are
          // single-branch, so feature branches never map and git rejects every
          // implicit lease as "stale info". Fetch the remote tip and lease
          // against it explicitly instead.
          let expectedSha: string;
          try {
            await git.fetch(["origin", ctx.branchName]);
            expectedSha = (await git.revparse(["FETCH_HEAD"])).trim();
          } catch (fetchError) {
            if (!isMissingRemoteRef(fetchError)) {
              deps.appendExecutionLog(
                ctx.branchName,
                `git_push: lease fetch failed - ${errorMessage(fetchError)}`,
              );
              return errorResult(
                `push failed: could not fetch origin/${ctx.branchName} ` +
                  `to establish the lease: ${errorMessage(fetchError)}`,
              );
            }
            // Branch absent on the remote: lease against its absence.
            expectedSha = "";
          }
          await git.push([
            "origin",
            ctx.branchName,
            `--force-with-lease=${ctx.branchName}:${expectedSha}`,
          ]);
        } else {
          await git.push(["-u", "origin", ctx.branchName]);
        }

        deps.appendExecutionLog(
          ctx.branchName,
          args.force ? "git_push: force-pushed with lease" : "git_push: pushed successfully",
        );

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
