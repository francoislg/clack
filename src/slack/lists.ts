import type { App } from "@slack/bolt";
import type { SlackListsCreateArguments } from "@slack/web-api";
import { z } from "zod";
import type {
  ListCell,
  ListCellUpdate,
  ListColumn,
  ListColumnChoice,
  ListField,
  ListItem,
} from "./listTypes.js";
import { isDirectConversation } from "./fileRef.js";
import { toRichText } from "./richText.js";
import { createSlackErrorMessage, type SlackErrorFormatter } from "./slackErrorMessage.js";

/**
 * Slack calls for Lists. Every function lets the WebClient's thrown error propagate;
 * callers turn it into a message with `listErrorMessage`.
 */

type SlackClient = App["client"];

type NewSchemaColumn = NonNullable<SlackListsCreateArguments["schema"]>[number];

const CHOICE_COLORS = ["blue", "green", "yellow", "red", "purple", "gray"];

const optionalString = z.string().optional().catch(undefined);
const optionalStrings = z.array(z.string()).optional().catch(undefined);
const optionalNumbers = z.array(z.number()).optional().catch(undefined);

const columnSchema = z.object({
  id: z.string(),
  key: z.string(),
  // Slack sends no name on the built-in todo columns (todo_completed, …); the key stands in.
  name: optionalString,
  type: z.string(),
  is_primary_column: z.boolean().optional().catch(undefined),
  options: z
    .object({
      choices: z
        .array(z.object({ value: z.string(), label: optionalString }))
        .optional()
        .catch(undefined),
      max: z.number().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

const listFileSchema = z.object({
  filetype: optionalString,
  title: optionalString,
  name: optionalString,
  permalink: optionalString,
  list_metadata: z
    .object({ schema: z.array(z.unknown()) })
    .optional()
    .catch(undefined),
});

const fieldSchema = z.object({
  column_id: z.string(),
  key: optionalString,
  text: optionalString,
  select: optionalStrings,
  user: optionalStrings,
  channel: optionalStrings,
  date: optionalStrings,
  email: optionalStrings,
  phone: optionalStrings,
  number: optionalNumbers,
  rating: optionalNumbers,
  checkbox: z.boolean().optional().catch(undefined),
});

const itemSchema = z.object({
  id: z.string(),
  fields: z.array(z.unknown()).optional().catch(undefined),
});

const itemsResponseSchema = z.object({
  items: z.array(z.unknown()).optional().catch(undefined),
});
const recordResponseSchema = z.object({ record: z.unknown() });
const createdItemResponseSchema = z.object({ item: z.object({ id: z.string() }) });
const createdListResponseSchema = z.object({
  list_id: optionalString,
  list: z.object({ id: z.string() }).optional().catch(undefined),
});

function parseColumn(raw: unknown): ListColumn | undefined {
  const parsed = columnSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const { id, key, name, type, is_primary_column, options } = parsed.data;
  const choices: ListColumnChoice[] = (options?.choices ?? []).map((choice) => ({
    value: choice.value,
    label: choice.label ?? choice.value,
  }));
  return {
    id,
    key,
    name: name ?? key,
    type,
    isPrimary: is_primary_column === true,
    choices,
    ...(options?.max === undefined ? {} : { max: options.max }),
  };
}

function parseField(raw: unknown): ListField | undefined {
  const parsed = fieldSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const { column_id, ...values } = parsed.data;
  const field: ListField = { columnId: column_id };
  if (values.key !== undefined) field.key = values.key;
  if (values.text !== undefined) field.text = values.text;
  if (values.select !== undefined) field.select = values.select;
  if (values.user !== undefined) field.user = values.user;
  if (values.channel !== undefined) field.channel = values.channel;
  if (values.date !== undefined) field.date = values.date;
  if (values.number !== undefined) field.number = values.number;
  if (values.rating !== undefined) field.rating = values.rating;
  if (values.email !== undefined) field.email = values.email;
  if (values.phone !== undefined) field.phone = values.phone;
  if (values.checkbox !== undefined) field.checkbox = values.checkbox;
  return field;
}

function parseItem(raw: unknown): ListItem | undefined {
  const parsed = itemSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  const fields: ListField[] = [];
  for (const rawField of parsed.data.fields ?? []) {
    const field = parseField(rawField);
    if (field !== undefined) fields.push(field);
  }
  return { id: parsed.data.id, fields };
}

export interface ListInfo {
  id: string;
  title: string;
  permalink: string | undefined;
  columns: ListColumn[];
}

export async function getListInfo(client: SlackClient, listId: string): Promise<ListInfo> {
  const response = await client.files.info({ file: listId });
  const parsed = listFileSchema.safeParse(response?.file);
  if (!parsed.success) throw new Error("That file is not a Slack List");
  const file = parsed.data;
  if (file.filetype !== undefined && file.filetype !== "list") {
    throw new Error("That file is not a Slack List");
  }
  if (file.list_metadata === undefined) throw new Error("That file is not a Slack List");

  const columns: ListColumn[] = [];
  for (const rawColumn of file.list_metadata.schema) {
    const column = parseColumn(rawColumn);
    if (column !== undefined) columns.push(column);
  }
  return {
    id: listId,
    title: file.title ?? file.name ?? "",
    permalink: file.permalink,
    columns,
  };
}

export interface ListItemsPage {
  items: ListItem[];
  nextCursor: string | undefined;
}

export async function listItems(
  client: SlackClient,
  listId: string,
  options: { limit: number; cursor?: string; archived?: boolean },
): Promise<ListItemsPage> {
  const response = await client.slackLists.items.list({
    list_id: listId,
    limit: options.limit,
    ...(options.cursor ? { cursor: options.cursor } : {}),
    ...(options.archived ? { archived: true } : {}),
  });
  const parsed = itemsResponseSchema.safeParse(response);
  const items: ListItem[] = [];
  for (const rawItem of parsed.success ? (parsed.data.items ?? []) : []) {
    const item = parseItem(rawItem);
    if (item !== undefined) items.push(item);
  }
  const nextCursor = response?.response_metadata?.next_cursor;
  return { items, nextCursor: nextCursor === "" ? undefined : nextCursor };
}

export async function getItem(
  client: SlackClient,
  listId: string,
  itemId: string,
): Promise<ListItem> {
  const response = await client.slackLists.items.info({ list_id: listId, id: itemId });
  const parsed = recordResponseSchema.safeParse(response);
  const item = parsed.success ? parseItem(parsed.data.record) : undefined;
  if (item === undefined) throw new Error("slackLists.items.info returned no item");
  return item;
}

export async function createItem(
  client: SlackClient,
  listId: string,
  cells: ListCell[],
): Promise<string> {
  const response = await client.slackLists.items.create({
    list_id: listId,
    initial_fields: cells,
  });
  const parsed = createdItemResponseSchema.safeParse(response);
  if (!parsed.success) throw new Error("slackLists.items.create returned no item id");
  return parsed.data.item.id;
}

export async function updateCells(
  client: SlackClient,
  listId: string,
  cells: ListCellUpdate[],
): Promise<void> {
  await client.slackLists.items.update({ list_id: listId, cells });
}

export async function deleteItems(
  client: SlackClient,
  listId: string,
  itemIds: string[],
): Promise<void> {
  await client.slackLists.items.deleteMultiple({ list_id: listId, ids: itemIds });
}

/**
 * A key unique within `used`: the name lowercased with every non-alphanumeric run turned into
 * `_`, then `_2`, `_3`, … appended until unused. Records the result in `used`.
 */
export function slugKey(name: string, used: Set<string>): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_")
      .replace(/^_+|_+$/g, "") || "col";
  let key = base;
  for (let suffix = 2; used.has(key); suffix += 1) key = `${base}_${suffix}`;
  used.add(key);
  return key;
}

export interface NewListColumn {
  name: string;
  type: string;
  options?: string[];
}

function toSchemaColumn(
  column: NewListColumn,
  index: number,
  usedKeys: Set<string>,
): NewSchemaColumn {
  const usedValues = new Set<string>();
  return {
    key: slugKey(column.name, usedKeys),
    name: column.name,
    type: column.type,
    ...(index === 0 ? { is_primary_column: true } : {}),
    ...(column.options?.length
      ? {
          options: {
            choices: column.options.map((label, choiceIndex) => ({
              value: slugKey(label, usedValues),
              label,
              color: CHOICE_COLORS[choiceIndex % CHOICE_COLORS.length],
            })),
          },
        }
      : {}),
  };
}

export async function createList(
  client: SlackClient,
  input: { name: string; description?: string; columns: NewListColumn[]; todoMode?: boolean },
): Promise<string> {
  const usedKeys = new Set<string>();
  const response = await client.slackLists.create({
    name: input.name,
    schema: input.columns.map((column, index) => toSchemaColumn(column, index, usedKeys)),
    ...(input.description ? { description_blocks: [toRichText(input.description)] } : {}),
    ...(input.todoMode ? { todo_mode: true } : {}),
  });
  const parsed = createdListResponseSchema.safeParse(response);
  const listId = parsed.success ? (parsed.data.list_id ?? parsed.data.list?.id) : undefined;
  if (!listId) throw new Error("slackLists.create returned no list id");
  return listId;
}

export async function shareListWithChannel(
  client: SlackClient,
  listId: string,
  channelId: string,
): Promise<void> {
  await client.slackLists.access.set({
    list_id: listId,
    access_level: "write",
    channel_ids: [channelId],
  });
}

const missingScope: SlackErrorFormatter = (operation) =>
  `Slack rejected ${operation}: the app is missing a Lists scope. An admin must re-upload the app manifest and reinstall the app to the workspace.`;
const paidPlanRequired: SlackErrorFormatter = (operation) =>
  `Slack rejected ${operation}: Lists need a paid Slack plan.`;
const notFound: SlackErrorFormatter = (operation) =>
  `Slack could not find that List or item (${operation}). It may be deleted, not a List, or not shared with Clack.`;
const notAllowed: SlackErrorFormatter = (operation) =>
  `Slack did not permit Clack to ${operation}. The List must be shared with a channel Clack is in, with edit access for changes.`;
const invalidValues: SlackErrorFormatter = (operation) =>
  `Slack rejected the values sent to ${operation}. Read the List again and check each column's type and options.`;

const LIST_ERROR_MESSAGES: ReadonlyMap<string, SlackErrorFormatter> = new Map([
  ["missing_scope", missingScope],
  ["paid_teams_only", paidPlanRequired],
  ["feature_not_enabled", paidPlanRequired],
  ["not_allowed_for_free_teams", paidPlanRequired],
  ["list_not_found", notFound],
  ["file_not_found", notFound],
  ["item_not_found", notFound],
  ["record_not_found", notFound],
  ["access_denied", notAllowed],
  ["no_permission", notAllowed],
  ["restricted_action", notAllowed],
  ["invalid_args", invalidValues],
  ["invalid_arguments", invalidValues],
  [
    "ratelimited",
    (operation: string): string =>
      `Slack rate-limited ${operation}. Wait a minute, then retry with fewer items.`,
  ],
]);

/** Claude-facing English message for a failed List operation. Logs the failure. */
export const listErrorMessage = createSlackErrorMessage("lists", LIST_ERROR_MESSAGES);

export interface ListApi {
  getListInfo: typeof getListInfo;
  listItems: typeof listItems;
  getItem: typeof getItem;
  createItem: typeof createItem;
  updateCells: typeof updateCells;
  deleteItems: typeof deleteItems;
  createList: typeof createList;
  shareListWithChannel: typeof shareListWithChannel;
  isDirectConversation: typeof isDirectConversation;
}

export const defaultListApi: ListApi = {
  getListInfo,
  listItems,
  getItem,
  createItem,
  updateCells,
  deleteItems,
  createList,
  shareListWithChannel,
  isDirectConversation,
};
