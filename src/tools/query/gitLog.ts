import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { simpleGit } from "simple-git";
import type { QueryToolContext } from "../types.js";
import { getVisibleRepos } from "../../repoAccess.js";
import { getRepositoriesDir } from "../../config.js";
import { logger } from "../../logger.js";

const MAX_OUTPUT_CHARS = 100_000;

export function createGitLogTool(ctx: QueryToolContext) {
  return tool(
    "git_log",
    "Run git log on a local repository clone with any supported git log arguments. Returns raw output plus shallow-clone metadata.",
    {
      repo: z.string().describe("Repository name"),
      args: z
        .array(z.string())
        .optional()
        .describe(
          'Git log arguments (e.g., ["--oneline", "-n", "10", "--author=John"])'
        ),
    },
    async (input) => {
      const visibleRepos = getVisibleRepos(ctx.role, ctx.config.repositories);
      const repo = visibleRepos.find((r) => r.name === input.repo);

      if (!repo) {
        const available = visibleRepos.map((r) => r.name);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Repository "${input.repo}" not found or not accessible. Available: ${available.join(", ")}`,
              }),
            },
          ],
          isError: true,
        };
      }

      const repoPath = resolve(getRepositoriesDir(), repo.name);

      if (!existsSync(repoPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Repository "${repo.name}" has not been cloned yet.`,
              }),
            },
          ],
          isError: true,
        };
      }

      try {
        const git = simpleGit({ baseDir: repoPath });

        // Gather shallow clone metadata
        const isShallowRaw = await git.raw([
          "rev-parse",
          "--is-shallow-repository",
        ]);
        const shallow = isShallowRaw.trim() === "true";

        const commitCountRaw = await git.raw(["rev-list", "--count", "HEAD"]);
        const availableCommits = parseInt(commitCountRaw.trim(), 10) || 0;

        // Run git log with user-provided args
        const logArgs = ["log", ...(input.args ?? [])];
        let output = await git.raw(logArgs);

        let truncated = false;
        if (output.length > MAX_OUTPUT_CHARS) {
          output =
            output.slice(0, MAX_OUTPUT_CHARS) +
            "\n\n--- OUTPUT TRUNCATED (exceeded 100K characters) ---";
          truncated = true;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { output, shallow, availableCommits, truncated },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.debug(`git_log failed for ${repo.name}: ${error}`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `git log failed: ${error instanceof Error ? error.message : String(error)}`,
              }),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
