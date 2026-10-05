import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import type { QueryToolContext } from "../types.js";
import { textResult, errorResult } from "../helpers.js";
import {
  defaultListApi,
  listErrorMessage,
  type ListApi,
  type NewListColumn,
} from "../../slack/lists.js";
import { WRITABLE_COLUMN_TYPES } from "../../slack/listCells.js";
import { recordGrant } from "../../slack/requesterAccess.js";
import { permalinkOrUndefined, shareWithSessionChannel } from "../fileCreation.js";

/** Column types a new List may declare. */
export const CREATABLE_COLUMN_TYPES: readonly string[] = WRITABLE_COLUMN_TYPES.filter(
  (type) => !type.startsWith("todo_"),
);

const OPTION_COLUMN_TYPES: readonly string[] = ["select", "multi_select"];

function columnProblems(column: NewListColumn): string[] {
  const problems: string[] = [];
  if (!CREATABLE_COLUMN_TYPES.includes(column.type)) {
    problems.push(
      `Column "${column.name}": type "${column.type}" is not supported. Supported: ${CREATABLE_COLUMN_TYPES.join(", ")}.`,
    );
    return problems;
  }
  const takesOptions = OPTION_COLUMN_TYPES.includes(column.type);
  if (!takesOptions && column.options !== undefined) {
    problems.push(`Column "${column.name}": only select and multi_select columns take options.`);
  }
  if (takesOptions && !column.options?.length) {
    problems.push(`Column "${column.name}": a ${column.type} column needs options.`);
  }
  return problems;
}

function duplicateNameProblems(columns: NewListColumn[]): string[] {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const problems: string[] = [];
  for (const column of columns) {
    const key = column.name.trim().toLowerCase();
    if (seen.has(key) && !reported.has(key)) {
      reported.add(key);
      problems.push(`Column name "${column.name}" is used more than once.`);
    }
    seen.add(key);
  }
  return problems;
}

/** Every problem with the requested columns; empty when the List can be created. */
function validateColumns(columns: NewListColumn[]): string[] {
  const problems: string[] = [];
  if (columns[0]?.type !== "text") {
    problems.push("The first column is the item title and must be of type text.");
  }
  for (const column of columns) problems.push(...columnProblems(column));
  problems.push(...duplicateNameProblems(columns));
  return problems;
}

/** `create_list` — creates a List, shares it with the session's channel, and records the
 *  requester's access to it on the session. */
export function createCreateListTool(ctx: QueryToolContext, api: ListApi = defaultListApi) {
  return tool(
    "create_list",
    "Create a Slack List to track items. Give it a name and its columns; the first column is the item title and must be of type text. Column types: text, number, checkbox, date, select, multi_select, user, channel, rating, email, phone, link. select and multi_select columns take their option labels in options. todo_mode adds Slack's built-in completed / assignee / due date columns. Outside a DM or group DM the List is shared with the current channel with edit access. Returns the List id and permalink; include the permalink in your answer. Add items with add_list_items.",
    {
      name: z.string().min(1),
      description: z.string().optional(),
      columns: z
        .array(
          z.object({
            name: z.string().min(1),
            type: z.string().describe("Column type"),
            options: z
              .array(z.string().min(1))
              .optional()
              .describe("Option labels, for select and multi_select columns"),
          }),
        )
        .min(1),
      todo_mode: z.boolean().optional(),
    },
    async (args) => {
      const problems = validateColumns(args.columns);
      if (problems.length > 0) return errorResult(problems.join("\n"));

      if (!ctx.slackClient) {
        return errorResult("Slack client is not available in this context");
      }
      const client = ctx.slackClient;

      let listId: string;
      try {
        listId = await api.createList(client, {
          name: args.name,
          description: args.description,
          columns: args.columns,
          todoMode: args.todo_mode,
        });
      } catch (error) {
        return errorResult(listErrorMessage("create", error));
      }

      const { sharedWith, warning } = await shareWithSessionChannel({
        client,
        fileId: listId,
        channelId: ctx.session.channelId,
        isDirectConversation: api.isDirectConversation,
        share: api.shareListWithChannel,
        errorMessage: listErrorMessage,
      });

      await recordGrant(
        { client, userId: ctx.userId, role: ctx.role, session: ctx.session },
        listId,
      );

      const permalink = await permalinkOrUndefined(
        async () => (await api.getListInfo(client, listId)).permalink,
        `create_list ${listId}`,
      );

      return textResult({
        list_id: listId,
        ...(permalink !== undefined && { permalink }),
        ...(sharedWith !== undefined && { shared_with_channel: sharedWith }),
        ...(warning !== undefined && { warning }),
      });
    },
  );
}
