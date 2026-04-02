import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getVisibleRepos } from "../../repoAccess.js";
import { getOctokit, parseRepoUrl } from "../../github.js";
import { logger } from "../../logger.js";
import { errorMessage } from "../../errors.js";

const STATE_ENUM = z
  .enum(["open", "closed", "merged", "all"])
  .describe(
    "Required. PR state filter: 'open' for open PRs, 'merged' for merged PRs, 'closed' for closed (including merged), 'all' for everything.",
  );

export function createFindPullRequestsTool(ctx: QueryToolContext) {
  return tool(
    "find_pull_requests",
    "Find pull requests on a repository via GitHub. Supports filtering by state (open, closed, merged, all), branch, and date.",
    {
      repo: z
        .string()
        .describe(
          "Repository name (e.g. 'my-repo') or URL. Use list_repositories to discover available names.",
        ),
      state: STATE_ENUM,
      branch: z.string().optional().describe("Filter by head branch name (partial match)"),
      since: z
        .string()
        .optional()
        .describe(
          "ISO 8601 date or datetime. Only return PRs updated/merged on or after this date (e.g. '2026-03-30' or '2026-03-30T00:00:00Z').",
        ),
    },
    async (args) => {
      const visibleRepos = getVisibleRepos(ctx.role, ctx.config.repositories);
      const repo = visibleRepos.find(
        (r) => r.name === args.repo || r.url.includes(args.repo) || args.repo.includes(r.name),
      );

      if (!repo) {
        const available = visibleRepos.map((r) => r.name);
        return errorResult(
          `Repository "${args.repo}" not found or not accessible. Available: ${available.join(", ")}`,
        );
      }

      try {
        const { owner, repo: repoName } = parseRepoUrl(repo.url);
        const octokit = await getOctokit();

        // "merged" is a client-side filter on closed PRs
        const apiState = args.state === "merged" ? "closed" : args.state;

        const { data: pulls } = await octokit.pulls.list({
          owner,
          repo: repoName,
          state: apiState,
          sort: "updated",
          direction: "desc",
          per_page: 100,
        });

        let filtered = pulls;

        // For "merged", keep only PRs that were actually merged
        if (args.state === "merged") {
          filtered = filtered.filter((pr) => pr.merged_at != null);
        }

        if (args.branch) {
          filtered = filtered.filter((pr) => pr.head.ref.includes(args.branch!));
        }

        if (args.since) {
          const sinceDate = new Date(args.since).getTime();
          filtered = filtered.filter((pr) => {
            // For merged PRs, filter on merged_at; otherwise filter on updated_at
            const dateField = args.state === "merged" ? pr.merged_at : pr.updated_at;
            return dateField != null && new Date(dateField).getTime() >= sinceDate;
          });
        }

        const result = filtered.map((pr) => ({
          url: pr.html_url,
          number: pr.number,
          title: pr.title,
          branch: pr.head.ref,
          state: pr.merged_at ? "merged" : pr.state,
          author: pr.user?.login,
          createdAt: pr.created_at,
          updatedAt: pr.updated_at,
          ...(pr.merged_at && { mergedAt: pr.merged_at }),
          ...(pr.body && { body: pr.body.substring(0, 500) }),
        }));

        return textResult(result);
      } catch (error) {
        logger.debug(`Failed to fetch PRs for ${args.repo}: ${errorMessage(error)}`);
        return errorResult(`Failed to fetch pull requests: ${errorMessage(error)}`);
      }
    },
  );
}
