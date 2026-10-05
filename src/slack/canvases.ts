import type { App } from "@slack/bolt";
import { z } from "zod";
import { isDirectConversation, SLACK_FILE_ID_PATTERN, slackUrlSegments } from "./fileRef.js";
import { createSlackErrorMessage, type SlackErrorFormatter } from "./slackErrorMessage.js";

/**
 * Slack calls for canvases. Every function lets the WebClient's thrown error propagate;
 * callers turn it into a message with `canvasErrorMessage`.
 */

type SlackClient = App["client"];

const canvasContentSchema = z.object({ content: z.string() });

function canvasIdFromUrl(ref: string): string | undefined {
  const parsed = slackUrlSegments(ref);
  if (parsed === undefined) return undefined;

  const { segments } = parsed;
  const candidate =
    segments[0] === "docs" ? segments[2] : segments[0] === "canvas" ? segments[1] : undefined;
  return candidate !== undefined && SLACK_FILE_ID_PATTERN.test(candidate) ? candidate : undefined;
}

/** The canvas file id (`F…`) from a canvas id or a Slack canvas URL; undefined for anything else. */
export function parseCanvasRef(ref: string): string | undefined {
  const trimmed = ref.trim();
  if (SLACK_FILE_ID_PATTERN.test(trimmed)) return trimmed;
  return canvasIdFromUrl(trimmed);
}

export async function getCanvasMarkdown(client: SlackClient, canvasId: string): Promise<string> {
  // `canvases.getContent` has no typed method in @slack/web-api.
  const response = await client.apiCall("canvases.getContent", {
    canvas_id: canvasId,
    content_type: "markdown",
  });
  const parsed = canvasContentSchema.safeParse(response);
  if (!parsed.success) throw new Error("canvases.getContent returned no content");
  return parsed.data.content;
}

export async function createCanvas(
  client: SlackClient,
  input: { title: string; markdown: string },
): Promise<string> {
  const response = await client.canvases.create({
    title: input.title,
    document_content: { type: "markdown", markdown: input.markdown },
  });
  const canvasId = response?.canvas_id;
  if (!canvasId) throw new Error("canvases.create returned no canvas id");
  return canvasId;
}

export async function shareCanvasWithChannel(
  client: SlackClient,
  canvasId: string,
  channelId: string,
): Promise<void> {
  await client.canvases.access.set({
    canvas_id: canvasId,
    access_level: "read",
    channel_ids: [channelId],
  });
}

export async function findSections(
  client: SlackClient,
  canvasId: string,
  containsText: string,
): Promise<string[]> {
  const response = await client.canvases.sections.lookup({
    canvas_id: canvasId,
    criteria: { contains_text: containsText },
  });
  const ids: string[] = [];
  for (const section of response?.sections ?? []) {
    if (section.id !== undefined) ids.push(section.id);
  }
  return ids;
}

export type CanvasChange =
  | { operation: "insert_after" | "insert_before"; sectionId: string; markdown: string }
  | { operation: "insert_at_start" | "insert_at_end"; markdown: string }
  | { operation: "replace"; sectionId?: string; markdown: string }
  | { operation: "delete"; sectionId: string }
  | { operation: "rename"; title: string };

/** Applies exactly one change to a canvas. */
export async function editCanvas(
  client: SlackClient,
  canvasId: string,
  change: CanvasChange,
): Promise<void> {
  switch (change.operation) {
    case "rename":
      // The SDK's `Change` union has no rename operation.
      await client.apiCall("canvases.edit", {
        canvas_id: canvasId,
        changes: [
          { operation: "rename", title_content: { type: "markdown", markdown: change.title } },
        ],
      });
      return;
    case "insert_after":
    case "insert_before":
      await client.canvases.edit({
        canvas_id: canvasId,
        changes: [
          {
            operation: change.operation,
            section_id: change.sectionId,
            document_content: { type: "markdown", markdown: change.markdown },
          },
        ],
      });
      return;
    case "insert_at_start":
    case "insert_at_end":
      await client.canvases.edit({
        canvas_id: canvasId,
        changes: [
          {
            operation: change.operation,
            document_content: { type: "markdown", markdown: change.markdown },
          },
        ],
      });
      return;
    case "replace":
      await client.canvases.edit({
        canvas_id: canvasId,
        changes: [
          {
            operation: "replace",
            ...(change.sectionId === undefined ? {} : { section_id: change.sectionId }),
            document_content: { type: "markdown", markdown: change.markdown },
          },
        ],
      });
      return;
    case "delete":
      await client.canvases.edit({
        canvas_id: canvasId,
        changes: [{ operation: "delete", section_id: change.sectionId }],
      });
      return;
    default:
      change satisfies never;
      throw new Error("Unhandled canvas change");
  }
}

export async function canvasPermalink(
  client: SlackClient,
  canvasId: string,
): Promise<string | undefined> {
  const response = await client.files.info({ file: canvasId });
  return response?.file?.permalink;
}

const missingScope: SlackErrorFormatter = (operation) =>
  `Slack rejected ${operation}: the app is missing a canvas scope. An admin must re-upload the app manifest and reinstall the app to the workspace.`;
const paidPlanRequired: SlackErrorFormatter = (operation) =>
  `Slack rejected ${operation}: canvases need a paid Slack plan.`;
const notFound: SlackErrorFormatter = (operation) =>
  `Slack could not find that canvas (${operation}). It may be deleted, not a canvas, or not shared with Clack.`;
const notAllowed: SlackErrorFormatter = (operation) =>
  `Slack did not permit Clack to ${operation} the canvas. Reading or editing needs the canvas shared with a channel Clack is in (with edit access for edits); creating or sharing may be blocked by a workspace canvas restriction.`;

const CANVAS_ERROR_MESSAGES: ReadonlyMap<string, SlackErrorFormatter> = new Map([
  ["missing_scope", missingScope],
  ["free_teams_cannot_create_standalone_canvases", paidPlanRequired],
  ["free_teams_cannot_edit_standalone_canvases", paidPlanRequired],
  ["free_team_canvas_tab_already_exists", paidPlanRequired],
  ["canvas_not_found", notFound],
  ["canvas_deleted", notFound],
  ["file_not_found", notFound],
  ["access_denied", notAllowed],
  ["no_permission", notAllowed],
  ["restricted_action", notAllowed],
  [
    "canvas_editing_locked",
    (operation: string): string => `That canvas is locked for editing (${operation}).`,
  ],
  ["canvas_too_large", (operation: string): string => `That canvas is too large (${operation}).`],
  [
    "ratelimited",
    (operation: string): string =>
      `Slack rate-limited ${operation}. Wait a minute before retrying.`,
  ],
]);

/** Claude-facing English message for a failed canvas operation. Logs the failure. */
export const canvasErrorMessage = createSlackErrorMessage("canvases", CANVAS_ERROR_MESSAGES);

export interface CanvasApi {
  getCanvasMarkdown: typeof getCanvasMarkdown;
  createCanvas: typeof createCanvas;
  shareCanvasWithChannel: typeof shareCanvasWithChannel;
  isDirectConversation: typeof isDirectConversation;
  findSections: typeof findSections;
  editCanvas: typeof editCanvas;
  canvasPermalink: typeof canvasPermalink;
}

export const defaultCanvasApi: CanvasApi = {
  getCanvasMarkdown,
  createCanvas,
  shareCanvasWithChannel,
  isDirectConversation,
  findSections,
  editCanvas,
  canvasPermalink,
};
