import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { getVisibleRepos, canWriteRepo } from "../../repoAccess.js";
import type { UserRole } from "../../roles.js";
import type { RepositoryConfig } from "../../config.js";

export interface ListRepositoriesDeps {
  getVisibleRepos: (role: UserRole, repos: RepositoryConfig[]) => RepositoryConfig[];
  canWriteRepo: (role: UserRole, repo: RepositoryConfig) => boolean;
}

export const defaultDeps: ListRepositoriesDeps = {
  getVisibleRepos,
  canWriteRepo,
};

export function createListRepositoriesTool(
  ctx: QueryToolContext,
  deps: ListRepositoriesDeps = defaultDeps,
) {
  return tool(
    "list_repositories",
    "List repositories you have access to, with their descriptions and whether you can propose code changes.",
    {
      includeChangeSupport: z
        .boolean()
        .optional()
        .describe("Include whether each repo supports the changes workflow (default: true)"),
    },
    async (args) => {
      const visible = deps.getVisibleRepos(ctx.role, ctx.config.repositories);
      const repos = visible.map((r) => ({
        name: r.name,
        description: r.description,
        ...(args.includeChangeSupport !== false && { canChange: deps.canWriteRepo(ctx.role, r) }),
      }));

      return textResult(repos);
    },
  );
}
