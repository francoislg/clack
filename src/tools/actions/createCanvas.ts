import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { canvasErrorMessage, defaultCanvasApi, type CanvasApi } from "../../slack/canvases.js";
import { recordGrant } from "../../slack/requesterAccess.js";
import { errorMessage } from "../../errors.js";
import { logger } from "../../logger.js";

type SlackClient = NonNullable<QueryToolContext["slackClient"]>;

interface ShareOutcome {
  sharedWith?: string;
  warning?: string;
}

/** Shares the canvas read-only with the session's channel, unless that conversation is a DM or
 *  group DM. A failure is reported as a warning. */
async function shareWithSessionChannel(
  api: CanvasApi,
  client: SlackClient,
  canvasId: string,
  channelId: string,
): Promise<ShareOutcome> {
  if (!channelId) return {};
  try {
    if (await api.isDirectConversation(client, channelId)) return {};
    await api.shareCanvasWithChannel(client, canvasId, channelId);
    return { sharedWith: channelId };
  } catch (error) {
    return { warning: canvasErrorMessage("share", error) };
  }
}

async function permalinkOrUndefined(
  api: CanvasApi,
  client: SlackClient,
  canvasId: string,
): Promise<string | undefined> {
  try {
    return await api.canvasPermalink(client, canvasId);
  } catch (error) {
    logger.warn(`create_canvas: permalink lookup failed for ${canvasId}: ${errorMessage(error)}`);
    return undefined;
  }
}

/** `create_canvas` — creates a canvas, shares it with the session's channel, and records the
 *  requester's access to it on the session. */
export function createCreateCanvasTool(ctx: QueryToolContext, api: CanvasApi = defaultCanvasApi) {
  return tool(
    "create_canvas",
    "Create a Slack canvas from a title and markdown — for a long answer or a living document. Canvas markdown supports h1–h3 headings, lists, checklists, tables, code blocks, quotes, links and @mentions; Block Kit is not supported. Outside a DM the canvas is shared read-only with the current channel. Returns the canvas id and permalink; include the permalink in your answer. People change the canvas through you (edit_canvas).",
    {
      title: z.string().min(1).describe("Canvas title"),
      markdown: z.string().min(1).describe("Canvas content as markdown"),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("Slack client is not available in this context");
      }
      const client = ctx.slackClient;

      let canvasId: string;
      try {
        canvasId = await api.createCanvas(client, { title: args.title, markdown: args.markdown });
      } catch (error) {
        return errorResult(canvasErrorMessage("create", error));
      }

      const { sharedWith, warning } = await shareWithSessionChannel(
        api,
        client,
        canvasId,
        ctx.session.channelId,
      );

      await recordGrant(
        { client, userId: ctx.userId, role: ctx.role, session: ctx.session },
        canvasId,
      );

      const permalink = await permalinkOrUndefined(api, client, canvasId);

      return textResult({
        canvas_id: canvasId,
        ...(permalink !== undefined && { permalink }),
        ...(sharedWith !== undefined && { shared_with_channel: sharedWith }),
        ...(warning !== undefined && { warning }),
      });
    },
  );
}
