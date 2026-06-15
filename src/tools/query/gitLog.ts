import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { simpleGit } from "simple-git";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult, MAX_TOOL_OUTPUT_CHARS } from "../helpers.js";
import { getVisibleRepos } from "../../repoAccess.js";
import type { RepositoryConfig } from "../../config.js";
import { getRepositoriesDir } from "../../config.js";
import { errorMessage } from "../../errors.js";
import { logger } from "../../logger.js";
import type { UserRole } from "../../roles.js";
import { findLocalBranchSource } from "../../workers/index.js";

export interface MinimalGit {
  raw(args: string[]): Promise<string>;
}

export interface GitLogDeps {
  getVisibleRepos: (role: UserRole, repos: RepositoryConfig[]) => RepositoryConfig[];
  getRepositoriesDir: () => string;
  existsSync: (path: string) => boolean;
  simpleGit: (opts: { baseDir: string }) => MinimalGit;
  /**
   * Prefer a worker's worktree when the branch is already checked out there
   * (reusable mode only). Returns null to fall back to the main repo clone.
   */
  findLocalBranchSource: (repo: string, branch: string) => string | null;
}

export const defaultDeps: GitLogDeps = {
  getVisibleRepos,
  getRepositoriesDir,
  existsSync,
  simpleGit,
  findLocalBranchSource,
};

export function createGitLogTool(ctx: QueryToolContext, deps: GitLogDeps = defaultDeps) {
  return tool(
    "git_log",
    "Run git log on a local repository clone. Prefer the lean path: pass `limit` and `path` to scope to a few commits on specific files (e.g. answering 'when was X last changed'). `since` windows by date. For anything else (author, --grep, -S pickaxe, custom --pretty), use `args`. Returns raw output plus shallow-clone metadata. If the result would be too large it is REFUSED with suggestions — narrow it rather than expecting truncated output. When `branch` is currently checked out in a reusable-pool worker, reads from that worker.",
    {
      repo: z.string().describe("Repository name"),
      path: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe(
          "Scope the log to one or more file/directory paths (mapped to `git log -- <path>`).",
        ),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "Max number of commits to return (mapped to `-n <limit>`). Use this to stay lean.",
        ),
      since: z
        .string()
        .optional()
        .describe(
          'Only commits after this date (mapped to `--since=<since>`, e.g. "2026-04-17" or "2 weeks ago").',
        ),
      args: z
        .array(z.string())
        .optional()
        .describe(
          'Additional raw git log arguments (e.g., ["--oneline", "--author=John", "-Semployee"]).',
        ),
      branch: z
        .string()
        .optional()
        .describe(
          "Optional branch name. When the branch is currently checked out in a worker (reusable-pool mode), git log runs against the worker's worktree instead of the main clone.",
        ),
    },
    async (input) => {
      const visibleRepos = deps.getVisibleRepos(ctx.role, ctx.config.repositories);
      const repo = visibleRepos.find((r) => r.name === input.repo);

      if (!repo) {
        const available = visibleRepos.map((r) => r.name);
        return errorResult(
          `Repository "${input.repo}" not found or not accessible. Available: ${available.join(", ")}`,
        );
      }

      const mainRepoPath = resolve(deps.getRepositoriesDir(), repo.name);
      // Local-worker shortcut: when the branch is checked out in a worker, use
      // it. Falls back to the main clone when no worker has the branch or when
      // reusable mode is off. Quarantined/failed workers are excluded.
      const workerPath = input.branch ? deps.findLocalBranchSource(repo.name, input.branch) : null;
      const repoPath = workerPath ?? mainRepoPath;

      if (!deps.existsSync(repoPath)) {
        return errorResult(`Repository "${repo.name}" has not been cloned yet.`);
      }

      try {
        const git = deps.simpleGit({ baseDir: repoPath });

        // Gather shallow clone metadata
        const isShallowRaw = await git.raw(["rev-parse", "--is-shallow-repository"]);
        const shallow = isShallowRaw.trim() === "true";

        const commitCountRaw = await git.raw(["rev-list", "--count", "HEAD"]);
        const availableCommits = parseInt(commitCountRaw.trim(), 10) || 0;

        // First-class params map to git flags and compose with raw `args`;
        // duplicates are left to git's last-flag-wins semantics. Paths go last
        // (after `--`) so they aren't parsed as revisions.
        const limitArgs = input.limit !== undefined ? ["-n", String(input.limit)] : [];
        const sinceArgs = input.since !== undefined ? [`--since=${input.since}`] : [];
        const paths =
          input.path === undefined ? [] : Array.isArray(input.path) ? input.path : [input.path];
        const pathArgs = paths.length > 0 ? ["--", ...paths] : [];

        const logArgs = ["log", ...limitArgs, ...sinceArgs, ...(input.args ?? []), ...pathArgs];
        const output = await git.raw(logArgs);

        if (output.length > MAX_TOOL_OUTPUT_CHARS) {
          return errorResult(
            `git log result too large (${output.length} characters). Narrow it: add \`limit\` to cap commits, scope with \`path\`, window with \`since\` (or \`--since\`), compact with \`--oneline\`, or search content with \`-S<string>\`/\`--grep\` in \`args\`.`,
          );
        }

        return textResult({ output, shallow, availableCommits });
      } catch (error) {
        logger.debug(`git_log failed for ${repo.name}: ${error}`);
        return errorResult(`git log failed: ${errorMessage(error)}`);
      }
    },
  );
}
