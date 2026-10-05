import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { canvasErrorMessage, defaultCanvasApi, type CanvasApi } from "../../slack/canvases.js";
import { recordGrant } from "../../slack/requesterAccess.js";
import { permalinkOrUndefined, shareWithSessionChannel } from "../fileCreation.js";

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

      const { sharedWith, warning } = await shareWithSessionChannel({
        client,
        fileId: canvasId,
        channelId: ctx.session.channelId,
        isDirectConversation: api.isDirectConversation,
        share: api.shareCanvasWithChannel,
        errorMessage: canvasErrorMessage,
      });

      await recordGrant(
        { client, userId: ctx.userId, role: ctx.role, session: ctx.session },
        canvasId,
      );

      const permalink = await permalinkOrUndefined(
        () => api.canvasPermalink(client, canvasId),
        `create_canvas ${canvasId}`,
      );

      return textResult({
        canvas_id: canvasId,
        ...(permalink !== undefined && { permalink }),
        ...(sharedWith !== undefined && { shared_with_channel: sharedWith }),
        ...(warning !== undefined && { warning }),
      });
    },
  );
}
