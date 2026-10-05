import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import { listFieldsField, listRefField, loadListInfo, openList } from "../listTools.js";
import { defaultListApi, listErrorMessage, type ListApi } from "../../slack/lists.js";
import { toCells } from "../../slack/listCells.js";
import type { ListCell, ListColumn, ListFieldPair } from "../../slack/listTypes.js";

type SlackClient = NonNullable<QueryToolContext["slackClient"]>;

export const MAX_ITEMS_PER_ADD = 20;

type TranslatedItems = { ok: true; items: ListCell[][] } | { ok: false; problems: string[] };

type CreateOutcome =
  | { ok: true; createdIds: string[] }
  | { ok: false; createdIds: string[]; failedIndex: number; error: unknown };

/** Translates every item; collects every problem, each prefixed with its 1-based item number. */
function translateItems(
  columns: ListColumn[],
  items: Array<{ fields: ListFieldPair[] }>,
): TranslatedItems {
  const translated: ListCell[][] = [];
  const problems: string[] = [];
  items.forEach((item, index) => {
    const result = toCells(columns, item.fields);
    if (result.ok) translated.push(result.cells);
    else problems.push(...result.problems.map((problem) => `Item ${index + 1}: ${problem}`));
  });
  return problems.length === 0 ? { ok: true, items: translated } : { ok: false, problems };
}

/** Creates the items one at a time, stopping at the first failure. */
async function createSequentially(
  api: ListApi,
  client: SlackClient,
  listId: string,
  items: ListCell[][],
): Promise<CreateOutcome> {
  const createdIds: string[] = [];
  for (const [index, cells] of items.entries()) {
    try {
      createdIds.push(await api.createItem(client, listId, cells));
    } catch (error) {
      return { ok: false, createdIds, failedIndex: index, error };
    }
  }
  return { ok: true, createdIds };
}

/** `add_list_items` — validates every item against the List's columns, then creates them. */
export function createAddListItemsTool(ctx: QueryToolContext, api: ListApi = defaultListApi) {
  return tool(
    "add_list_items",
    "Add items to a Slack List. Each item is a list of { column, value } pairs using the column names read_list reports; select columns take an option label, user and channel columns take ids (resolve names with find_user / find_channel first), dates are YYYY-MM-DD. Up to 20 items per call. Nothing is added when any value is invalid. Items are created one at a time: if Slack fails part-way, the result names the items already created.",
    {
      list: listRefField,
      items: z
        .array(z.object({ fields: listFieldsField }))
        .min(1)
        .describe("Items to create"),
    },
    async (args) => {
      if (args.items.length > MAX_ITEMS_PER_ADD) {
        return errorResult(`Too many items: at most ${MAX_ITEMS_PER_ADD} per call.`);
      }

      const opened = await openList(ctx, args.list, "write");
      if (!opened.ok) return opened.error;
      const { client, listId } = opened;

      const loaded = await loadListInfo(api, client, listId);
      if (!loaded.ok) return loaded.error;

      const translated = translateItems(loaded.info.columns, args.items);
      if (!translated.ok) return errorResult(translated.problems.join("\n"));

      const outcome = await createSequentially(api, client, listId, translated.items);
      if (!outcome.ok) {
        const created = outcome.createdIds.length > 0 ? outcome.createdIds.join(", ") : "none";
        return errorResult(
          `${listErrorMessage("add item", outcome.error)} Item ${outcome.failedIndex + 1} of ${translated.items.length} failed; created before it: ${created}. The remaining items were not attempted.`,
        );
      }

      return textResult({ list_id: listId, created_item_ids: outcome.createdIds });
    },
  );
}
