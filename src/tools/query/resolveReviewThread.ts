import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext, WorkerToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { getOctokit } from "../../github.js";
import { errorMessage } from "../../errors.js";

interface ResolveThreadResult {
  resolveReviewThread: {
    thread: { id: string; isResolved: boolean };
  };
}

export interface ResolveReviewThreadDeps {
  graphql: (query: string, variables: { threadId: string }) => Promise<ResolveThreadResult>;
}

async function defaultGraphql(
  query: string,
  variables: { threadId: string },
): Promise<ResolveThreadResult> {
  const octokit = await getOctokit();
  return octokit.graphql<ResolveThreadResult>(query, variables);
}

export const defaultResolveReviewThreadDeps: ResolveReviewThreadDeps = {
  graphql: defaultGraphql,
};

export function createResolveReviewThreadTool(
  _ctx: QueryToolContext | WorkerToolContext,
  deps: ResolveReviewThreadDeps = defaultResolveReviewThreadDeps,
) {
  return tool(
    "resolve_review_thread",
    "Resolve a PR review thread after addressing the feedback. Takes the GraphQL node ID of the review thread (starts with PRRT_).",
    {
      threadId: z.string().describe("The GraphQL node ID of the review thread (e.g. PRRT_...)"),
    },
    async (args) => {
      try {
        const result = await deps.graphql(
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
