import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { canvasErrorMessage, defaultCanvasApi, type CanvasApi } from "../../slack/canvases.js";
import { resolveRefForReader } from "../resolveRefForReader.js";

/** Longest canvas markdown returned in one result; longer canvases are cut to this length. */
export const MAX_CANVAS_CHARS = 100_000;

/** `read_canvas` — returns a canvas's markdown once the requester's access to it is confirmed. */
export function createReadCanvasTool(ctx: QueryToolContext, api: CanvasApi = defaultCanvasApi) {
  return tool(
    "read_canvas",
    "Read a Slack canvas as markdown. Pass the canvas id (F…) or its Slack URL. Use it whenever the user links or names a canvas. Refused when the requester cannot see the canvas.",
    {
      canvas: z.string().describe("Canvas id (F…) or Slack canvas URL"),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("Slack client is not available in this context");
      }
      const client = ctx.slackClient;

      const resolved = await resolveRefForReader(ctx, args.canvas, ["canvas"], {
        alwaysCheckAccess: true,
      });
      if (!resolved.ok) return resolved.error;
      const canvasId = resolved.ref.id;

      let markdown: string;
      try {
        markdown = await api.getCanvasMarkdown(client, canvasId);
      } catch (error) {
        return errorResult(canvasErrorMessage("read", error));
      }

      if (markdown.length <= MAX_CANVAS_CHARS) {
        return textResult({ canvas_id: canvasId, markdown });
      }
      return textResult({
        canvas_id: canvasId,
        markdown: markdown.slice(0, MAX_CANVAS_CHARS),
        truncated: true,
        note: `Canvas truncated to the first ${MAX_CANVAS_CHARS} characters of ${markdown.length}.`,
      });
    },
  );
}
