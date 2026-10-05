import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { listRefField, openList } from "../listTools.js";
import { defaultListApi, listErrorMessage, type ListApi } from "../../slack/lists.js";
import { fromFields } from "../../slack/listCells.js";
import { parseListRef } from "../../slack/listRef.js";

export const NO_ITEM_ID_MESSAGE = "No item id. Pass item_id, or a List URL that carries record_id.";

/** `get_list_item` — one item of a List, once the requester's access to the List is confirmed. */
export function createGetListItemTool(ctx: QueryToolContext, api: ListApi = defaultListApi) {
  return tool(
    "get_list_item",
    "Read one item of a Slack List, each cell keyed by column name. Pass the List id or URL and the item id (Rec…); a List URL that carries record_id needs no item id.",
    {
      list: listRefField,
      item_id: z
        .string()
        .optional()
        .describe("Item id (Rec…). Optional when the List URL carries record_id"),
    },
    async (args) => {
      const itemId = args.item_id?.trim() || parseListRef(args.list)?.itemId;
      if (!itemId) return errorResult(NO_ITEM_ID_MESSAGE);

      const opened = await openList(ctx, args.list, "read");
      if (!opened.ok) return opened.error;
      const { client, listId } = opened;

      try {
        const [info, item] = await Promise.all([
          api.getListInfo(client, listId),
          api.getItem(client, listId, itemId),
        ]);
        return textResult({
          list_id: listId,
          item_id: itemId,
          fields: fromFields(info.columns, item.fields),
        });
      } catch (error) {
        return errorResult(listErrorMessage("read item", error));
      }
    },
  );
}
