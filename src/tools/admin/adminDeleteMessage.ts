import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { parseSlackMessageUrl } from "../query/fetchSlackMessage.js";
import { errorMessage } from "../../errors.js";

export interface AdminDeleteMessageDeps {
  authTest: () => Promise<{ bot_id?: string }>;
  conversationsReplies: (params: {
    channel: string;
    ts: string;
  }) => Promise<{ messages?: Array<{ ts?: string; bot_id?: string }> }>;
  conversationsHistory: (params: {
    channel: string;
    oldest: string;
    latest: string;
    inclusive: boolean;
    limit: number;
  }) => Promise<{ messages?: Array<{ bot_id?: string }> }>;
  chatDelete: (params: { channel: string; ts: string }) => Promise<void>;
}

export type DeleteMessageResult =
  | { ok: true; channel: string; ts: string }
  | { ok: false; error: string };

export async function deleteClackMessage(
  url: string,
  deps: AdminDeleteMessageDeps,
): Promise<DeleteMessageResult> {
  const parsed = parseSlackMessageUrl(url);
  if (!parsed) {
    return {
      ok: false,
      error:
        "Could not parse the URL as a Slack message link. Make sure it is a valid Slack permalink (e.g. https://workspace.slack.com/archives/C123/p1234567890123456).",
    };
  }

  const { channelId, messageTs, threadTs } = parsed;

  let clackBotId: string;
  try {
    const authInfo = await deps.authTest();
    if (!authInfo.bot_id) {
      return {
        ok: false,
        error: "Could not verify Clack's identity — auth.test returned no bot_id.",
      };
    }
    clackBotId = authInfo.bot_id;
  } catch (err) {
    return {
      ok: false,
      error: `Failed to verify Clack's identity: ${errorMessage(err)}`,
    };
  }

  let message: { bot_id?: string } | undefined;
  try {
    if (threadTs) {
      const repliesResult = await deps.conversationsReplies({
        channel: channelId,
        ts: threadTs,
      });
      message = repliesResult.messages?.find((m) => m.ts === messageTs);
    } else {
      const historyResult = await deps.conversationsHistory({
        channel: channelId,
        oldest: messageTs,
        latest: messageTs,
        inclusive: true,
        limit: 1,
      });
      message = historyResult.messages?.[0];
    }
  } catch (err) {
    const errMsg = errorMessage(err);
    if (errMsg.includes("not_in_channel")) {
      return {
        ok: false,
        error: "Clack is not a member of that channel. Add Clack to the channel first, then retry.",
      };
    }
    return { ok: false, error: `Failed to fetch message: ${errMsg}` };
  }

  if (!message) {
    return {
      ok: false,
      error:
        "Message not found. It may have already been deleted, or it may be an ephemeral message — ephemeral messages are not accessible via the Slack API and cannot be deleted programmatically.",
    };
  }

  if (message.bot_id !== clackBotId) {
    return {
      ok: false,
      error:
        "That message was not posted by Clack. Only Clack's own messages can be deleted with this tool.",
    };
  }

  try {
    await deps.chatDelete({ channel: channelId, ts: messageTs });
  } catch (err) {
    const errMsg = errorMessage(err);
    if (errMsg.includes("message_not_found")) {
      return { ok: false, error: "Message was already deleted." };
    }
    return { ok: false, error: `Failed to delete message: ${errMsg}` };
  }

  return { ok: true, channel: channelId, ts: messageTs };
}

export function createAdminDeleteMessageTool(ctx: QueryToolContext) {
  // Safe: only registered when slackClient is present (see buildQueryTools in server.ts)
  const client = ctx.slackClient!;

  const deps: AdminDeleteMessageDeps = {
    authTest: () => client.auth.test(),
    conversationsReplies: (params) => client.conversations.replies(params),
    conversationsHistory: (params) => client.conversations.history(params),
    chatDelete: (params) => client.chat.delete(params).then(() => undefined),
  };

  return tool(
    "admin_delete_message",
    "Delete a message posted by Clack, identified by its Slack permalink URL. Verifies that the message was posted by Clack before deleting. Cannot delete ephemeral messages (Slack API limitation).",
    {
      url: z
        .string()
        .describe(
          "Slack permalink URL of the message to delete (e.g. https://workspace.slack.com/archives/C123/p1234567890123456)",
        ),
    },
    async ({ url }) => {
      const result = await deleteClackMessage(url, deps);
      if (!result.ok) {
        return errorResult(result.error);
      }
      return textResult({
        deleted: true,
        channel: result.channel,
        ts: result.ts,
      });
    },
  );
}
