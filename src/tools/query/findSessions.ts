import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult } from "../helpers.js";
import { getResumableSessions, type ResumableSession } from "../../changes/persistence.js";
import { getVisibleRepos } from "../../repoAccess.js";
import type { UserRole } from "../../roles.js";
import type { RepositoryConfig } from "../../config.js";

export interface FindSessionsDeps {
  getResumableSessions: () => Promise<ResumableSession[]>;
  getVisibleRepos: (role: UserRole, repos: RepositoryConfig[]) => RepositoryConfig[];
}

export const defaultDeps: FindSessionsDeps = {
  getResumableSessions,
  getVisibleRepos,
};

export function createFindSessionsTool(
  ctx: QueryToolContext,
  deps: FindSessionsDeps = defaultDeps,
) {
  return tool(
    "find_sessions",
    "Find resumable change sessions. These are worktrees with previous work that can be continued. Use this to check if there's an existing session before proposing a new change.",
    {
      repo: z.string().optional().describe("Filter by repository name"),
      branch: z.string().optional().describe("Filter by branch name (partial match)"),
    },
    async (args) => {
      const visibleRepoNames = new Set(
        deps.getVisibleRepos(ctx.role, ctx.config.repositories).map((r) => r.name),
      );
      let sessions = (await deps.getResumableSessions()).filter((s) =>
        visibleRepoNames.has(s.repo),
      );

      if (args.repo) {
        sessions = sessions.filter((s) => s.repo === args.repo);
      }
      if (args.branch) {
        sessions = sessions.filter((s) => s.branchName.includes(args.branch!));
      }

      const result = sessions.map((s) => ({
        branchName: s.branchName,
        repo: s.repo,
        description: s.description,
        phase: s.phase,
        lastMessage: s.lastMessage,
        startedAt: s.startedAt,
      }));

      return textResult(result);
    },
  );
}
