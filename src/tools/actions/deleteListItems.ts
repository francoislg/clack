import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { App } from "@slack/bolt";
import type { QueryToolContext } from "../types.js";
import type { IntentStore } from "../server.js";
import { textResult, errorResult } from "../helpers.js";
import { listRefField, openList } from "../listTools.js";
import {
  defaultListApi,
  listErrorMessage,
  type ListApi,
  type ListInfo,
} from "../../slack/lists.js";
import { fromFields } from "../../slack/listCells.js";
import type { ListItem } from "../../slack/listTypes.js";

export const MAX_ITEMS_PER_DELETE = 50;
export const MAX_LOOKUP_PAGES = 10;

const LOOKUP_PAGE_SIZE = 100;
const MAX_LABEL_LENGTH = 80;

type SlackClient = App["client"];

interface FoundItems {
  found: Map<string, ListItem>;
  /** Whether items remained unread when the page limit stopped the search. */
  truncated: boolean;
}

/**
 * Page through the List until every wanted id is found, the List has no further page, or
 * `MAX_LOOKUP_PAGES` pages were read. Ids absent from `found` were not found.
 */
async function findItems(
  api: ListApi,
  client: SlackClient,
  listId: string,
  wantedIds: string[],
): Promise<FoundItems> {
  const wanted = new Set(wantedIds);
  const found = new Map<string, ListItem>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LOOKUP_PAGES && found.size < wanted.size; page += 1) {
    const result = await api.listItems(client, listId, { limit: LOOKUP_PAGE_SIZE, cursor });
    for (const item of result.items) {
      if (wanted.has(item.id)) found.set(item.id, item);
    }
    cursor = result.nextCursor;
    if (cursor === undefined) break;
  }
  return { found, truncated: cursor !== undefined && found.size < wanted.size };
}

function notFoundMessage(missing: string[], truncated: boolean): string {
  const where = truncated
    ? `in the first ${MAX_LOOKUP_PAGES * LOOKUP_PAGE_SIZE} items of the List (the search stops there)`
    : "in the List";
  return `These items were not found ${where}: ${missing.join(", ")}. Read the List again for current item ids.`;
}

/** The item's primary-column value, trimmed and cut to 80 characters; the item id when empty. */
function itemLabel(info: ListInfo, item: ListItem): string {
  const primary = info.columns.find((column) => column.isPrimary);
  if (!primary) return item.id;
  const pair = fromFields([primary], item.fields)[0];
  const text = pair === undefined ? "" : String(pair.value).trim();
  return text === "" ? item.id : text.slice(0, MAX_LABEL_LENGTH);
}

export function createDeleteListItemsTool(
  ctx: QueryToolContext,
  intentStore: IntentStore,
  api: ListApi = defaultListApi,
) {
  return tool(
    "delete_list_items",
    "Prepare the deletion of items from a Slack List. Nothing is deleted by this call: it stages the deletion and returns a ref to pass to submit_response as a list_items_delete action, which shows a confirm button. The items are deleted only when a person clicks it. Pass the List id or URL and the item ids (Rec…, from read_list); up to 50 per call.",
    {
      list: listRefField,
      item_ids: z.array(z.string().min(1)).min(1).describe("Item ids (Rec…) to delete"),
    },
    async (args) => {
      const itemIds = [...new Set(args.item_ids)];
      if (itemIds.length > MAX_ITEMS_PER_DELETE) {
        return errorResult(`Too many items: at most ${MAX_ITEMS_PER_DELETE} per deletion.`);
      }

      const opened = await openList(ctx, args.list, "write");
      if (!opened.ok) return opened.error;
      const { client, listId } = opened;

      let info: ListInfo;
      let lookup: FoundItems;
      try {
        [info, lookup] = await Promise.all([
          api.getListInfo(client, listId),
          findItems(api, client, listId, itemIds),
        ]);
      } catch (error) {
        return errorResult(listErrorMessage("read", error));
      }
      const { found } = lookup;

      const missing = itemIds.filter((id) => !found.has(id));
      if (missing.length > 0) return errorResult(notFoundMessage(missing, lookup.truncated));

      const items = itemIds.map((id) => {
        const item = found.get(id);
        return { id, label: item === undefined ? id : itemLabel(info, item) };
      });
      const ref = intentStore.stage({ type: "list_items_delete", listId, items });

      return textResult({
        ref,
        list_id: listId,
        items,
        applied: false,
        instruction:
          "STAGED — nothing has been deleted. Add a `list_items_delete` action with this ref to submit_response; it shows a confirm button, and the items are deleted only when a person clicks it. Your answer MUST name the items listed here and use pending language ('Ready to delete…', 'Click below to delete'). Do NOT say they were deleted.",
      });
    },
  );
}
