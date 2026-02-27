import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { getOctokit } from "../../github.js";

export function createResolveReviewThreadTool() {
  return tool(
    "resolve_review_thread",
    "Resolve a PR review thread after addressing the feedback. Takes the GraphQL node ID of the review thread (starts with PRRT_).",
    {
      threadId: z.string().describe("The GraphQL node ID of the review thread (e.g. PRRT_...)"),
    },
    async (args) => {
      try {
        const octokit = await getOctokit();

        const result = await octokit.graphql<{
          resolveReviewThread: {
            thread: { id: string; isResolved: boolean };
          };
        }>(
          `mutation($threadId: ID!) {
            resolveReviewThread(input: { threadId: $threadId }) {
              thread { id isResolved }
            }
          }`,
          { threadId: args.threadId },
        );

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              success: true,
              threadId: result.resolveReviewThread.thread.id,
              isResolved: result.resolveReviewThread.thread.isResolved,
            }),
          }],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({ error: `Failed to resolve review thread: ${errorMessage}` }),
          }],
          isError: true,
        };
      }
    },
  );
}
