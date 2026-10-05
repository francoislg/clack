import type {
  SlackListsItemsCreateArguments,
  SlackListsItemsUpdateArguments,
} from "@slack/web-api";

/** One option of a select column. Cells carry `value`; people see `label`. */
export interface ListColumnChoice {
  value: string;
  label: string;
}

/** A List column, as read from the List file's `list_metadata.schema`. */
export interface ListColumn {
  id: string;
  key: string;
  name: string;
  type: string;
  isPrimary: boolean;
  /** Options of a select column; empty for every other type. */
  choices: ListColumnChoice[];
  /** Highest value of a rating column. */
  max?: number;
}

/** One cell of an item, as Slack returns it. `text` is Slack's plain-text rendering. */
export interface ListField {
  columnId: string;
  key?: string;
  text?: string;
  select?: string[];
  user?: string[];
  channel?: string[];
  date?: string[];
  number?: number[];
  rating?: number[];
  email?: string[];
  phone?: string[];
  checkbox?: boolean;
}

export interface ListItem {
  id: string;
  fields: ListField[];
}

/** A value Claude sends for, or reads from, one cell. */
export type ListFieldValue = string | number | boolean | string[];

/** One `{ column, value }` pair of a tool call or a tool result. */
export interface ListFieldPair {
  column: string;
  value: ListFieldValue;
}

/** A typed cell for `slackLists.items.create` (`initial_fields`). */
export type ListCell = NonNullable<SlackListsItemsCreateArguments["initial_fields"]>[number];

/** A typed cell for `slackLists.items.update`: a `ListCell` plus its `row_id`. */
export type ListCellUpdate = SlackListsItemsUpdateArguments["cells"][number];
