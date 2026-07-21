import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { errorMessage } from "../../errors.js";

type SlackClient = NonNullable<QueryToolContext["slackClient"]>;

const MAX_RESULTS = 20;

/** Claude-facing message shown when the tool is invoked without an `action_token`. English by
 *  repo convention (consumed by Claude, re-rendered to the user in the configured language). */
const SEARCH_UNAVAILABLE_MESSAGE =
  "Workspace search is unavailable in this context. It works only when the user reaches you through a direct message or an @mention — those triggers carry the Slack action_token this tool requires. Reaction- and schedule-triggered sessions cannot search. Ask the user to @mention you or send you a direct message, then retry.";

const FULL_DESCRIPTION =
  "Search public-channel message TEXT across the whole workspace for literal keywords. Matching is lexical (non-semantic), like Slack's own search bar — a query of ':bob:' finds messages whose text contains the literal ':bob:'. Only public channels are searched; private channels, DMs, and group DMs are never returned. Slack search operators pass through in the query string: 'in:<#C0123>' to scope to a channel, 'from:<@U0123>' to scope to an author, 'before:2026-01-01' / 'after:2026-01-01' for dates. Prefer narrowing with operators over paging — results are capped and Slack rate limits are low. IMPORTANT: this searches message text only. An emoji used as a REACTION is not message content and cannot be found here; use fetch_channel_messages (its lore_hint) for reaction usage.";

const DEGRADED_DESCRIPTION =
  "Search public-channel message text across the workspace for literal keywords. NOTE: search is UNAVAILABLE in the current context — it requires the Slack action_token that only direct-message and @mention triggers carry (reaction- and schedule-triggered sessions do not have one). Tell the user to @mention you or DM you to run a search.";

interface SearchContextMessage {
  author_user_id?: string;
  team_id?: string;
  channel_id?: string;
  channel_name?: string;
  message_ts?: string;
  content?: string;
  permalink?: string;
  is_author_bot?: boolean;
}

interface SearchContextResponse {
  ok?: boolean;
  error?: string;
  results?: { messages?: SearchContextMessage[] };
  response_metadata?: { next_cursor?: string };
}

export type SearchContextArgs = {
  query: string;
  action_token: string;
  disable_semantic_search: boolean;
  channel_types: string;
  content_types: string;
  limit: number;
};

export interface SearchMessagesDeps {
  searchContext: (client: SlackClient, args: SearchContextArgs) => Promise<SearchContextResponse>;
}

export const defaultSearchMessagesDeps: SearchMessagesDeps = {
  searchContext: async (client, args) => {
    const result = await client.apiCall("assistant.search.context", args);
    return result as SearchContextResponse;
  },
};

/** Extract Slack's machine error code from a thrown WebClient error or an `{ ok: false }` body. */
function slackErrorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data?: { error?: string } }).data;
    if (data && typeof data.error === "string") return data.error;
  }
  const msg = errorMessage(error);
  const match = msg.match(/\b(missing_scope|not_allowed_token_type|invalid_auth|token_expired)\b/);
  return match?.[1];
}

function formatMatch(m: SearchContextMessage) {
  return {
    ...(m.content !== undefined && { text: m.content }),
    ...(m.author_user_id !== undefined && { author: m.author_user_id }),
    ...(m.channel_id !== undefined && { channel: m.channel_id }),
    ...(m.channel_name !== undefined && { channel_name: m.channel_name }),
    ...(m.message_ts !== undefined && { ts: m.message_ts }),
    ...(m.permalink !== undefined && { permalink: m.permalink }),
    ...(m.is_author_bot !== undefined && { is_bot: m.is_author_bot }),
  };
}

/** Missing-scope is the expected "flag enabled but app not reinstalled" state — surface it
 *  distinctly from empty results so Claude never reports "nothing matched" for a scope gap. */
function searchErrorResult(code: string | undefined, detail: string) {
  if (code === "missing_scope" || code === "not_allowed_token_type") {
    return errorResult(
      "The 'search:read.public' scope is missing from the bot token. allowPublicSearch was enabled without reinstalling the app — the manifest must be re-uploaded AND the app reinstalled to the workspace before search works. This is a configuration gap, NOT an empty result set.",
    );
  }
  return errorResult(`search_messages failed: ${detail}`);
}

/**
 * `search_messages` — bot-token workspace keyword search over `assistant.search.context`.
 * Returns the FULL tool when the session carries an `action_token`, and a DEGRADED tool (no
 * `query` parameter, no Slack call) otherwise, so Claude sees the capability exists but knows
 * it must be reached via DM/@mention. Registered only when `config.allowPublicSearch` is on
 * and a Slack client is present (query mode only).
 */
export function createSearchMessagesTool(
  ctx: QueryToolContext,
  deps: SearchMessagesDeps = defaultSearchMessagesDeps,
) {
  if (!ctx.actionToken) {
    return tool("search_messages", DEGRADED_DESCRIPTION, {}, async () =>
      errorResult(SEARCH_UNAVAILABLE_MESSAGE),
    );
  }

  const actionToken = ctx.actionToken;

  return tool(
    "search_messages",
    FULL_DESCRIPTION,
    {
      query: z
        .string()
        .describe(
          "Literal keywords to find in public-channel message text. May include Slack search operators (e.g. 'retry bug in:<#C0123>', 'from:<@U0123> deploy', 'incident before:2026-01-01').",
        ),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("Slack client is not available in this context");
      }
      const query = args.query.trim();
      if (!query) {
        return errorResult("Query cannot be empty");
      }

      let response: SearchContextResponse;
      try {
        response = await deps.searchContext(ctx.slackClient, {
          query,
          action_token: actionToken,
          disable_semantic_search: true,
          channel_types: "public_channel",
          content_types: "messages",
          limit: MAX_RESULTS,
        });
      } catch (error) {
        return searchErrorResult(slackErrorCode(error), errorMessage(error));
      }

      if (response.ok === false || response.error) {
        return searchErrorResult(response.error, response.error ?? "unknown error");
      }

      const messages = response.results?.messages ?? [];
      const truncated =
        messages.length >= MAX_RESULTS || Boolean(response.response_metadata?.next_cursor);

      return textResult({
        query,
        match_count: messages.length,
        truncated,
        ...(truncated && {
          truncation_note: `Showing the first ${messages.length} matches (Slack caps a single search at ${MAX_RESULTS}). Narrow the query with operators like in:<#channel>, from:<@user>, or before:/after: rather than asking for more.`,
        }),
        messages: messages.map(formatMatch),
      });
    },
  );
}
