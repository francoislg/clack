import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import {
  canvasErrorMessage,
  defaultCanvasApi,
  parseCanvasRef,
  type CanvasApi,
  type CanvasChange,
} from "../../slack/canvases.js";
import { checkFileAccess, FILE_ACCESS_DENIED_MESSAGE } from "../../slack/requesterAccess.js";
import { getBotUserId } from "../../slack/botIdentity.js";

type SlackClient = NonNullable<QueryToolContext["slackClient"]>;

const OPERATIONS = [
  "insert_after",
  "insert_before",
  "replace",
  "delete",
  "insert_at_start",
  "insert_at_end",
  "rename",
] as const;

type CanvasOperation = (typeof OPERATIONS)[number];

const DESCRIPTION = `Apply ONE change to a Slack canvas. Read the canvas first (read_canvas) and take anchor_text from its content. Operations: insert_after / insert_before (markdown placed next to the section containing anchor_text), replace (the section containing anchor_text; without anchor_text the WHOLE canvas, allowed only on canvases you created), "delete" (removes the section containing anchor_text), insert_at_start / insert_at_end (markdown, no anchor), rename (title). anchor_text must match exactly one section. Each call is one Slack operation — a multi-step edit is several calls and is not atomic. Canvas markdown supports h1–h3, lists, checklists, tables, code blocks, quotes, links and @mentions; no Block Kit.`;

export interface CanvasEditArgs {
  operation: CanvasOperation;
  anchor_text?: string;
  markdown?: string;
  title?: string;
}

export type EditPlan =
  | {
      kind: "anchored";
      operation: "insert_after" | "insert_before" | "replace";
      anchorText: string;
      markdown: string;
    }
  | { kind: "anchored-delete"; anchorText: string }
  | { kind: "unanchored"; operation: "insert_at_start" | "insert_at_end"; markdown: string }
  | { kind: "whole-replace"; markdown: string }
  | { kind: "rename"; title: string };

export type EditPlanResult = { ok: true; plan: EditPlan } | { ok: false; error: string };

/** An empty or whitespace-only argument counts as missing. */
function present(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function refuse(error: string): EditPlanResult {
  return { ok: false, error };
}

/** Checks that the arguments fit the operation and names the edit they describe. Makes no Slack call. */
export function planCanvasEdit(args: CanvasEditArgs): EditPlanResult {
  const { operation, anchor_text: anchorText, markdown, title } = args;

  if (operation === "rename") {
    if (!present(title)) return refuse("rename needs title.");
    if (present(anchorText) || present(markdown)) return refuse("rename takes only title.");
    return { ok: true, plan: { kind: "rename", title } };
  }

  if (present(title)) return refuse("title is only for rename.");

  switch (operation) {
    case "insert_after":
    case "insert_before":
      if (!present(anchorText) || !present(markdown)) {
        return refuse(`${operation} needs anchor_text and markdown.`);
      }
      return { ok: true, plan: { kind: "anchored", operation, anchorText, markdown } };
    case "replace":
      if (!present(markdown)) return refuse("replace needs markdown.");
      return present(anchorText)
        ? { ok: true, plan: { kind: "anchored", operation, anchorText, markdown } }
        : { ok: true, plan: { kind: "whole-replace", markdown } };
    case "delete":
      if (!present(anchorText)) return refuse(`${operation} needs anchor_text.`);
      if (present(markdown)) return refuse(`${operation} takes no markdown.`);
      return { ok: true, plan: { kind: "anchored-delete", anchorText } };
    case "insert_at_start":
    case "insert_at_end":
      if (!present(markdown)) return refuse(`${operation} needs markdown.`);
      if (present(anchorText)) return refuse(`${operation} takes no anchor_text.`);
      return { ok: true, plan: { kind: "unanchored", operation, markdown } };
  }
}

type ResolvedChange = { change: CanvasChange } | { error: string };

/** Finds the one section an anchored plan targets. */
async function resolveSection(
  api: CanvasApi,
  client: SlackClient,
  canvasId: string,
  anchorText: string,
): Promise<{ sectionId: string } | { error: string }> {
  const ids = await api.findSections(client, canvasId, anchorText);
  const [sectionId] = ids;
  if (sectionId === undefined) {
    return {
      error: `No section contains "${anchorText}". Read the canvas (read_canvas) and copy anchor_text from it.`,
    };
  }
  if (ids.length > 1) {
    return {
      error: `${ids.length} sections contain "${anchorText}". Use longer, more specific anchor_text.`,
    };
  }
  return { sectionId };
}

/** Turns a plan into the Slack change: a whole-canvas replace is limited to canvases Clack created,
 *  and an anchored plan is resolved to its single section. */
async function resolveChange(
  api: CanvasApi,
  client: SlackClient,
  canvasId: string,
  plan: EditPlan,
  creator: string | undefined,
): Promise<ResolvedChange> {
  switch (plan.kind) {
    case "rename":
      return { change: { operation: "rename", title: plan.title } };
    case "unanchored":
      return { change: { operation: plan.operation, markdown: plan.markdown } };
    case "whole-replace": {
      if (creator === undefined || creator !== (await getBotUserId(client))) {
        return {
          error:
            "Replacing a whole canvas is only allowed on canvases Clack created. Replace it section by section with anchor_text.",
        };
      }
      return { change: { operation: "replace", markdown: plan.markdown } };
    }
    case "anchored-delete": {
      const section = await resolveSection(api, client, canvasId, plan.anchorText);
      if ("error" in section) return section;
      return { change: { operation: "delete", sectionId: section.sectionId } };
    }
    case "anchored": {
      const section = await resolveSection(api, client, canvasId, plan.anchorText);
      if ("error" in section) return section;
      return {
        change: {
          operation: plan.operation,
          sectionId: section.sectionId,
          markdown: plan.markdown,
        },
      };
    }
  }
}

/**
 * `edit_canvas` — applies one change to a canvas the requester can access and Clack can edit.
 * Anchored operations target the single section containing `anchor_text`.
 */
export function createEditCanvasTool(ctx: QueryToolContext, api: CanvasApi = defaultCanvasApi) {
  return tool(
    "edit_canvas",
    DESCRIPTION,
    {
      canvas: z.string().describe("Canvas id (F…) or Slack canvas URL"),
      operation: z.enum(OPERATIONS),
      anchor_text: z
        .string()
        .optional()
        .describe("Text of the section the operation targets, copied from the canvas"),
      markdown: z.string().optional().describe("Markdown to insert or to replace with"),
      title: z.string().optional().describe("New title, for rename"),
    },
    async (args) => {
      if (!ctx.slackClient) {
        return errorResult("Slack client is not available in this context");
      }
      const client = ctx.slackClient;

      const canvasId = parseCanvasRef(args.canvas);
      if (canvasId === undefined) {
        return errorResult("Not a canvas reference. Pass a canvas id (F…) or a Slack canvas URL.");
      }

      const planned = planCanvasEdit(args);
      if (!planned.ok) return errorResult(planned.error);

      const access = await checkFileAccess(
        { client, userId: ctx.userId, role: ctx.role, session: ctx.session },
        canvasId,
      );
      if (!access.allowed) return errorResult(FILE_ACCESS_DENIED_MESSAGE);
      if (access.botAccess === "read") {
        return errorResult(
          "Clack has read-only access to that canvas and cannot edit it. Ask its owner to give Clack edit access.",
        );
      }

      try {
        const resolved = await resolveChange(api, client, canvasId, planned.plan, access.creator);
        if ("error" in resolved) return errorResult(resolved.error);
        await api.editCanvas(client, canvasId, resolved.change);
      } catch (error) {
        return errorResult(canvasErrorMessage("edit", error));
      }

      return textResult({ canvas_id: canvasId, operation: args.operation, applied: true });
    },
  );
}
