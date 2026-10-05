import { z } from "zod";
import type { QueryToolContext } from "./types.js";
import { errorResult } from "./helpers.js";
import { listErrorMessage, type ListApi, type ListInfo } from "../slack/lists.js";
import { parseListRef } from "../slack/listRef.js";
import { checkFileAccess, FILE_ACCESS_DENIED_MESSAGE } from "../slack/requesterAccess.js";

type SlackClient = NonNullable<QueryToolContext["slackClient"]>;
type ToolError = ReturnType<typeof errorResult>;

export const NOT_A_LIST_REF_MESSAGE =
  "Not a List reference. Pass a List id (F…) or a Slack List URL.";
export const LIST_READ_ONLY_MESSAGE =
  "Clack can only read that List. It must be shared with edit access to a channel Clack is in.";

export const listRefField = z.string().describe("List id (F…) or Slack List URL");

/** `{ column, value }` pairs; an array because a served tool schema cannot carry a record. */
export const listFieldsField = z
  .array(
    z.object({
      column: z.string().min(1).describe("Column name, exactly as read_list reports it"),
      value: z
        .union([z.string(), z.number(), z.boolean(), z.array(z.string())])
        .describe(
          "Cell value: text, number, true/false, a date as YYYY-MM-DD, a select option label, a user or channel id, or a list of those for multi-value columns",
        ),
    }),
  )
  .min(1);

export type OpenedList =
  | { ok: true; client: SlackClient; listId: string; itemId: string | undefined }
  | { ok: false; error: ToolError };

/**
 * The gate every List tool passes before any List call: a Slack client, a valid List reference,
 * the requester's access to the List, and, for a write, the bot's own edit access.
 */
export async function openList(
  ctx: QueryToolContext,
  ref: string,
  access: "read" | "write",
): Promise<OpenedList> {
  if (!ctx.slackClient) {
    return { ok: false, error: errorResult("Slack client is not available in this context") };
  }
  const client = ctx.slackClient;

  const parsed = parseListRef(ref);
  if (parsed === undefined) return { ok: false, error: errorResult(NOT_A_LIST_REF_MESSAGE) };

  const verdict = await checkFileAccess(
    { client, userId: ctx.userId, role: ctx.role, session: ctx.session },
    parsed.listId,
  );
  if (!verdict.allowed) return { ok: false, error: errorResult(FILE_ACCESS_DENIED_MESSAGE) };
  if (access === "write" && verdict.botAccess === "read") {
    return { ok: false, error: errorResult(LIST_READ_ONLY_MESSAGE) };
  }
  return { ok: true, client, listId: parsed.listId, itemId: parsed.itemId };
}

export type LoadedListInfo = { ok: true; info: ListInfo } | { ok: false; error: ToolError };

/** The List's schema, or the Claude-facing read error. */
export async function loadListInfo(
  api: ListApi,
  client: SlackClient,
  listId: string,
): Promise<LoadedListInfo> {
  try {
    return { ok: true, info: await api.getListInfo(client, listId) };
  } catch (error) {
    return { ok: false, error: errorResult(listErrorMessage("read", error)) };
  }
}
