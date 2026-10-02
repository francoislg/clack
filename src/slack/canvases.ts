import type { App } from "@slack/bolt";
import { z } from "zod";
import { errorMessage } from "../errors.js";
import { logger } from "../logger.js";
import { slackErrorCode } from "../slackErrors.js";

/**
 * Slack calls for canvases. Every function lets the WebClient's thrown error propagate;
 * callers turn it into a message with `canvasErrorMessage`.
 */

type SlackClient = App["client"];

const CANVAS_ID_PATTERN = /^F[A-Z0-9]{6,}$/;

const canvasContentSchema = z.object({ content: z.string() });

function isSlackHost(hostname: string): boolean {
  return hostname === "slack.com" || hostname.endsWith(".slack.com");
}

function canvasIdFromUrl(ref: string): string | undefined {
  if (!URL.canParse(ref)) return undefined;
  const url = new URL(ref);
  if (!isSlackHost(url.hostname)) return undefined;

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  const candidate =
    segments[0] === "docs" ? segments[2] : segments[0] === "canvas" ? segments[1] : undefined;
  return candidate !== undefined && CANVAS_ID_PATTERN.test(candidate) ? candidate : undefined;
}

/** The canvas file id (`F…`) from a canvas id or a Slack canvas URL; undefined for anything else. */
export function parseCanvasRef(ref: string): string | undefined {
  const trimmed = ref.trim();
  if (CANVAS_ID_PATTERN.test(trimmed)) return trimmed;
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

/** Whether a conversation is a DM or group DM (canvases cannot be shared to those). */
export async function isDirectConversation(
  client: SlackClient,
  channelId: string,
): Promise<boolean> {
  const response = await client.conversations.info({ channel: channelId });
  const channel = response?.channel;
  return channel?.is_im === true || channel?.is_mpim === true;
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

type CanvasErrorFormatter = (operation: string) => string;

const missingScope: CanvasErrorFormatter = (operation) =>
  `Slack rejected ${operation}: the app is missing a canvas scope. An admin must re-upload the app manifest and reinstall the app to the workspace.`;
const paidPlanRequired: CanvasErrorFormatter = (operation) =>
  `Slack rejected ${operation}: canvases need a paid Slack plan.`;
const notFound: CanvasErrorFormatter = (operation) =>
  `Slack could not find that canvas (${operation}). It may be deleted, not a canvas, or not shared with Clack.`;
const notAllowed: CanvasErrorFormatter = (operation) =>
  `Slack did not permit Clack to ${operation} the canvas. Reading or editing needs the canvas shared with a channel Clack is in (with edit access for edits); creating or sharing may be blocked by a workspace canvas restriction.`;

const CANVAS_ERROR_MESSAGES: ReadonlyMap<string, CanvasErrorFormatter> = new Map([
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
export function canvasErrorMessage(operation: string, error: unknown): string {
  logger.warn(`canvases: ${operation} failed: ${errorMessage(error)}`);
  const code = slackErrorCode(error instanceof Error ? error : undefined);
  if (code === undefined) return `${operation} failed: ${errorMessage(error)}`;
  const format = CANVAS_ERROR_MESSAGES.get(code);
  return format ? format(operation) : `Slack rejected ${operation}: ${code}.`;
}

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
