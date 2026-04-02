import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { simpleGit } from "simple-git";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getVisibleRepos } from "../../repoAccess.js";
import { getRepositoriesDir } from "../../config.js";
import { setAuthenticatedRemote } from "../../repositories.js";
import { errorMessage } from "../../errors.js";
import { logger } from "../../logger.js";

const DEFAULT_DEEPEN_COMMITS = 100;

export function createDeepenHistoryTool(ctx: QueryToolContext) {
  return tool(
    "deepen_history",
    "Fetch additional commit history for a shallow-cloned repository. Use after git_log indicates the repo is shallow and you need more history.",
    {
      repo: z.string().describe("Repository name"),
      commits: z
        .number()
        .optional()
        .describe("Number of additional commits to fetch (default: 100)"),
      full: z.boolean().optional().describe("Set to true to fetch the entire history (unshallow)"),
    },
    async (input) => {
      const visibleRepos = getVisibleRepos(ctx.role, ctx.config.repositories);
      const repo = visibleRepos.find((r) => r.name === input.repo);

      if (!repo) {
        const available = visibleRepos.map((r) => r.name);
        return errorResult(
          `Repository "${input.repo}" not found or not accessible. Available: ${available.join(", ")}`,
        );
      }

      const repoPath = resolve(getRepositoriesDir(), repo.name);

      if (!existsSync(repoPath)) {
        return errorResult(`Repository "${repo.name}" has not been cloned yet.`);
      }

      try {
        const git = simpleGit({ baseDir: repoPath });

        // Check if repo is shallow
        const isShallowRaw = await git.raw(["rev-parse", "--is-shallow-repository"]);
        const isShallow = isShallowRaw.trim() === "true";

        if (!isShallow) {
          const commitCountRaw = await git.raw(["rev-list", "--count", "HEAD"]);
          const availableCommits = parseInt(commitCountRaw.trim(), 10) || 0;

          return textResult({
            message: "Repository already has full history. No fetch needed.",
            shallow: false,
            availableCommits,
          });
        }

        // Refresh authenticated remote before fetching
        await setAuthenticatedRemote(repoPath, repo.url);

        // Deepen or unshallow
        if (input.full) {
          await git.raw(["fetch", "--unshallow"]);
        } else {
          const depth = input.commits ?? DEFAULT_DEEPEN_COMMITS;
          await git.raw(["fetch", `--deepen=${depth}`]);
        }

        // Get updated metadata
        const newShallowRaw = await git.raw(["rev-parse", "--is-shallow-repository"]);
        const shallow = newShallowRaw.trim() === "true";

        const commitCountRaw = await git.raw(["rev-list", "--count", "HEAD"]);
        const availableCommits = parseInt(commitCountRaw.trim(), 10) || 0;

        return textResult({
          message: input.full
            ? "Repository fully unshallowed."
            : `Fetched ${input.commits ?? DEFAULT_DEEPEN_COMMITS} additional commits.`,
          shallow,
          availableCommits,
        });
      } catch (error) {
        logger.debug(`deepen_history failed for ${repo.name}: ${error}`);
        return errorResult(`Failed to deepen history: ${errorMessage(error)}`);
      }
    },
  );
}
