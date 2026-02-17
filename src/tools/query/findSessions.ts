import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { ToolContext } from "../types.js";
import { getResumableSessions } from "../../changes/persistence.js";

export function createFindSessionsTool(_ctx: ToolContext) {
  return tool(
    "find_sessions",
    "Find resumable change sessions. These are worktrees with previous work that can be continued. Use this to check if there's an existing session before proposing a new change.",
    {
      repo: z.string().optional().describe("Filter by repository name"),
      branch: z.string().optional().describe("Filter by branch name (partial match)"),
    },
    async (args) => {
      let sessions = getResumableSessions();

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

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );
}
