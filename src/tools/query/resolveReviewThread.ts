import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext, WorkerToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getOctokit } from "../../github.js";
import { errorMessage } from "../../errors.js";

export function createResolveReviewThreadTool(_ctx: QueryToolContext | WorkerToolContext) {
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

        return textResult({
          success: true,
          threadId: result.resolveReviewThread.thread.id,
          isResolved: result.resolveReviewThread.thread.isResolved,
        });
      } catch (error) {
        return errorResult(`Failed to resolve review thread: ${errorMessage(error)}`);
      }
    },
  );
}
