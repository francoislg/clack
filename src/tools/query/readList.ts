import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { listRefField, openList } from "../listTools.js";
import { defaultListApi, listErrorMessage, type ListApi } from "../../slack/lists.js";
import { fromFields } from "../../slack/listCells.js";
import type { ListColumn, ListFieldPair, ListItem } from "../../slack/listTypes.js";

/** Longest serialized run of items returned in one result; a longer page is cut at an item boundary. */
export const MAX_LIST_RESULT_CHARS = 100_000;
export const DEFAULT_LIST_PAGE_SIZE = 50;
export const MAX_LIST_PAGE_SIZE = 100;

interface RenderedItem {
  item_id: string;
  fields: ListFieldPair[];
}

function renderColumn(column: ListColumn) {
  return {
    name: column.name,
    type: column.type,
    ...(column.isPrimary && { primary: true }),
    ...(column.choices.length > 0 && { options: column.choices.map((choice) => choice.label) }),
  };
}

function renderItem(columns: ListColumn[], item: ListItem): RenderedItem {
  return { item_id: item.id, fields: fromFields(columns, item.fields) };
}

/** The leading items whose serialized sizes add up to at most `maxChars`. */
export function capItems<T>(items: T[], maxChars: number = MAX_LIST_RESULT_CHARS): T[] {
  let total = 0;
  const kept: T[] = [];
  for (const item of items) {
    total += JSON.stringify(item).length;
    if (total > maxChars) break;
    kept.push(item);
  }
  return kept;
}

/** `read_list` — a List's columns and one page of its items, once the requester's access is confirmed. */
export function createReadListTool(ctx: QueryToolContext, api: ListApi = defaultListApi) {
  return tool(
    "read_list",
    "Read a Slack List: its columns (name, type, select options) and one page of items, each cell keyed by column name. Pass the List id (F…) or its Slack URL. Use it whenever the user links or names a List, and before changing one. Refused when the requester cannot see the List.",
    {
      list: listRefField,
      limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_LIST_PAGE_SIZE)
        .optional()
        .describe("Items per page (default 50, max 100)"),
      cursor: z.string().optional().describe("next_cursor from the previous page"),
      archived: z
        .boolean()
        .optional()
        .describe("true returns the archived items instead of the active ones"),
    },
    async (args) => {
      const opened = await openList(ctx, args.list, "read");
      if (!opened.ok) return opened.error;
      const { client, listId } = opened;

      try {
        const [info, page] = await Promise.all([
          api.getListInfo(client, listId),
          api.listItems(client, listId, {
            limit: args.limit ?? DEFAULT_LIST_PAGE_SIZE,
            cursor: args.cursor,
            archived: args.archived,
          }),
        ]);

        const rendered = page.items.map((item) => renderItem(info.columns, item));
        const items = capItems(rendered);
        const truncated = items.length < rendered.length;
        const head = {
          list_id: listId,
          title: info.title,
          ...(info.permalink !== undefined && { permalink: info.permalink }),
          columns: info.columns.map(renderColumn),
          items,
        };

        if (truncated) {
          return textResult({
            ...head,
            truncated: true,
            note: `Result cut after ${items.length} of ${rendered.length} items on this page to stay under ${MAX_LIST_RESULT_CHARS} characters. Call again with a smaller limit.`,
          });
        }
        return textResult({
          ...head,
          ...(page.nextCursor !== undefined && { next_cursor: page.nextCursor }),
        });
      } catch (error) {
        return errorResult(listErrorMessage("read", error));
      }
    },
  );
}
