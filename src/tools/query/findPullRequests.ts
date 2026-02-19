import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { getVisibleRepos } from "../../repoAccess.js";
import { getOctokit, parseRepoUrl } from "../../github.js";
import { logger } from "../../logger.js";

export function createFindPullRequestsTool(ctx: QueryToolContext) {
  return tool(
    "find_pull_requests",
    "Find open pull requests on a repository via GitHub. Use this to check if a PR already exists for a branch before proposing changes.",
    {
      repo: z.string().describe("Repository name to query"),
      branch: z.string().optional().describe("Filter by head branch name (partial match)"),
    },
    async (args) => {
      const visibleRepos = getVisibleRepos(ctx.role, ctx.config.repositories);
      const repo = visibleRepos.find((r) => r.name === args.repo);

      if (!repo) {
        const available = visibleRepos.map((r) => r.name);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: `Repository "${args.repo}" not found or not accessible. Available: ${available.join(", ")}`,
            }),
          }],
          isError: true,
        };
      }

      try {
        const { owner, repo: repoName } = parseRepoUrl(repo.url);
        const octokit = await getOctokit();

        const { data: pulls } = await octokit.pulls.list({
          owner,
          repo: repoName,
          state: "open",
          per_page: 100,
        });

        let filtered = pulls;
        if (args.branch) {
          filtered = pulls.filter((pr) => pr.head.ref.includes(args.branch!));
        }

        const result = filtered.map((pr) => ({
          url: pr.html_url,
          title: pr.title,
          branch: pr.head.ref,
          state: pr.state,
          updatedAt: pr.updated_at,
        }));

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        logger.debug(`Failed to fetch PRs for ${args.repo}: ${error}`);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: `Failed to fetch pull requests: ${error}` }),
          }],
          isError: true,
        };
      }
    }
  );
}
