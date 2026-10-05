import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { listFieldsField, listRefField, loadListInfo, openList } from "../listTools.js";
import { defaultListApi, listErrorMessage, type ListApi } from "../../slack/lists.js";
import { toCells } from "../../slack/listCells.js";
import type { ListCellUpdate, ListColumn, ListFieldPair } from "../../slack/listTypes.js";

export const MAX_CELLS_PER_UPDATE = 100;

interface ItemUpdate {
  item_id: string;
  fields: ListFieldPair[];
}

type TranslatedUpdates = { ok: true; cells: ListCellUpdate[] } | { ok: false; problems: string[] };

/** Translates every update; collects every problem, each prefixed with its item id. */
function translateUpdates(columns: ListColumn[], updates: ItemUpdate[]): TranslatedUpdates {
  const cells: ListCellUpdate[] = [];
  const problems: string[] = [];
  for (const update of updates) {
    const result = toCells(columns, update.fields);
    if (result.ok) cells.push(...result.cells.map((cell) => ({ ...cell, row_id: update.item_id })));
    else problems.push(...result.problems.map((problem) => `Item ${update.item_id}: ${problem}`));
  }
  return problems.length === 0 ? { ok: true, cells } : { ok: false, problems };
}

function countCells(updates: ItemUpdate[]): number {
  return updates.reduce((total, update) => total + update.fields.length, 0);
}

/** `update_list_items` — validates every cell against the List's columns, then sends one change. */
export function createUpdateListItemsTool(ctx: QueryToolContext, api: ListApi = defaultListApi) {
  return tool(
    "update_list_items",
    "Change cells of existing items of a Slack List. Each update names an item id (Rec…, from read_list) and { column, value } pairs using the column names read_list reports. Up to 100 cells per call, sent as one change. Nothing is changed when any value is invalid.",
    {
      list: listRefField,
      updates: z
        .array(
          z.object({
            item_id: z.string().min(1).describe("Item id (Rec…)"),
            fields: listFieldsField,
          }),
        )
        .min(1),
    },
    async (args) => {
      if (countCells(args.updates) > MAX_CELLS_PER_UPDATE) {
        return errorResult(`Too many cells: at most ${MAX_CELLS_PER_UPDATE} per call.`);
      }

      const opened = await openList(ctx, args.list, "write");
      if (!opened.ok) return opened.error;
      const { client, listId } = opened;

      const loaded = await loadListInfo(api, client, listId);
      if (!loaded.ok) return loaded.error;

      const translated = translateUpdates(loaded.info.columns, args.updates);
      if (!translated.ok) return errorResult(translated.problems.join("\n"));

      try {
        await api.updateCells(client, listId, translated.cells);
      } catch (error) {
        return errorResult(listErrorMessage("update", error));
      }

      return textResult({
        list_id: listId,
        updated_item_ids: [...new Set(args.updates.map((update) => update.item_id))],
        cells: translated.cells.length,
      });
    },
  );
}
