import { vi, type Mock } from "vitest";
import type { ListApi, ListInfo } from "./lists.js";
import type { ListColumn, ListItem } from "./listTypes.js";

export type MockListApi = { [K in keyof ListApi]: Mock<ListApi[K]> };

/** Every `ListApi` member as a vitest mock typed from the real signature. Unprogrammed members
 *  return `undefined`. */
export function createListApiMock(): MockListApi {
  return {
    getListInfo: vi.fn<ListApi["getListInfo"]>(),
    listItems: vi.fn<ListApi["listItems"]>(),
    getItem: vi.fn<ListApi["getItem"]>(),
    createItem: vi.fn<ListApi["createItem"]>(),
    updateCells: vi.fn<ListApi["updateCells"]>(),
    deleteItems: vi.fn<ListApi["deleteItems"]>(),
    createList: vi.fn<ListApi["createList"]>(),
    shareListWithChannel: vi.fn<ListApi["shareListWithChannel"]>(),
    isDirectConversation: vi.fn<ListApi["isDirectConversation"]>(),
  };
}

/** The id of the live List the real-shape fixtures are modeled on. */
export const REAL_SHAPE_LIST_ID = "F0BSE12AF7Z";

/** `files.info` → `list_metadata.schema` as Slack returns it for a todo-mode List: a text
 *  primary column, the built-in todo columns (fixed ids, no `name`), and a custom text column
 *  whose `key` differs from its `id`. A fresh array per call. */
export function realShapeListSchema() {
  return [
    { id: "Col0BSP4Q5HNX", key: "name", name: "Name", type: "text", is_primary_column: true },
    { id: "Col00", key: "todo_completed", type: "todo_completed" },
    { id: "Col01", key: "todo_assignee", type: "todo_assignee" },
    { id: "Col02", key: "todo_due_date", type: "todo_due_date" },
    {
      id: "Col0BSVF85HFU",
      key: "Col0BTPSMN90Q",
      name: "Details",
      type: "text",
      options: { format: "text" },
    },
  ];
}

/** `slackLists.items.list` items as Slack returns them: empty cells are omitted, an empty name
 *  carries `value: null` / `text: ""` / `rich_text: []`, an unchecked todo carries
 *  `value: false` / `checkbox: false`. A fresh array per call. */
export function realShapeListItems() {
  // The live API sends `value: null`, which @slack/web-api's `Field` type doesn't model — hence
  // a captured JSON payload here, and a permissive zod parser in lists.ts.
  return JSON.parse(REAL_SHAPE_ITEMS_JSON);
}

const REAL_SHAPE_ITEMS_JSON = `[
  {
    "id": "Rec0EMPTY",
    "list_id": "${REAL_SHAPE_LIST_ID}",
    "fields": [
      { "key": "name", "value": null, "text": "", "rich_text": [], "column_id": "Col0BSP4Q5HNX" },
      { "key": "todo_completed", "value": false, "checkbox": false, "column_id": "Col00" }
    ]
  },
  {
    "id": "Rec0FILLED",
    "list_id": "${REAL_SHAPE_LIST_ID}",
    "fields": [
      {
        "key": "name",
        "value": "Ship it",
        "text": "Ship it",
        "rich_text": [
          {
            "type": "rich_text",
            "elements": [
              { "type": "rich_text_section", "elements": [{ "type": "text", "text": "Ship it" }] }
            ]
          }
        ],
        "column_id": "Col0BSP4Q5HNX"
      },
      { "key": "todo_completed", "value": false, "checkbox": false, "column_id": "Col00" },
      {
        "key": "Col0BTPSMN90Q",
        "value": "Before Friday",
        "text": "Before Friday",
        "rich_text": [
          {
            "type": "rich_text",
            "elements": [
              {
                "type": "rich_text_section",
                "elements": [{ "type": "text", "text": "Before Friday" }]
              }
            ]
          }
        ],
        "column_id": "Col0BSVF85HFU"
      }
    ]
  }
]`;

function todoColumn(key: string): Omit<ListColumn, "id"> {
  return { key, name: key, type: key, isPrimary: false, choices: [] };
}

/** `realShapeListSchema()` as `getListInfo` parses it. A fresh object per call. */
export function realShapeListInfo(): ListInfo {
  return {
    id: REAL_SHAPE_LIST_ID,
    title: "Todo",
    permalink: `https://acme.slack.com/lists/T0123/${REAL_SHAPE_LIST_ID}`,
    columns: [
      {
        id: "Col0BSP4Q5HNX",
        key: "name",
        name: "Name",
        type: "text",
        isPrimary: true,
        choices: [],
      },
      { ...todoColumn("todo_completed"), id: "Col00" },
      { ...todoColumn("todo_assignee"), id: "Col01" },
      { ...todoColumn("todo_due_date"), id: "Col02" },
      {
        id: "Col0BSVF85HFU",
        key: "Col0BTPSMN90Q",
        name: "Details",
        type: "text",
        isPrimary: false,
        choices: [],
      },
    ],
  };
}

/** `realShapeListItems()` as `listItems` parses them. A fresh array per call. */
export function realShapeParsedItems(): ListItem[] {
  return [
    {
      id: "Rec0EMPTY",
      fields: [
        { columnId: "Col0BSP4Q5HNX", key: "name", text: "" },
        { columnId: "Col00", key: "todo_completed", checkbox: false },
      ],
    },
    {
      id: "Rec0FILLED",
      fields: [
        { columnId: "Col0BSP4Q5HNX", key: "name", text: "Ship it" },
        { columnId: "Col00", key: "todo_completed", checkbox: false },
        { columnId: "Col0BSVF85HFU", key: "Col0BTPSMN90Q", text: "Before Friday" },
      ],
    },
  ];
}

/** A "Tasks" List (`F0LIST123`) with Title (primary text), Status (select Todo/Done), Owner
 *  (user) and Due (date) columns. A fresh object per call. */
export function createTasksListInfo(): ListInfo {
  return {
    id: "F0LIST123",
    title: "Tasks",
    permalink: "https://acme.slack.com/lists/T0123/F0LIST123",
    columns: [
      { id: "Col1", key: "title", name: "Title", type: "text", isPrimary: true, choices: [] },
      {
        id: "Col2",
        key: "status",
        name: "Status",
        type: "select",
        isPrimary: false,
        choices: [
          { value: "todo", label: "Todo" },
          { value: "done", label: "Done" },
        ],
      },
      { id: "Col3", key: "owner", name: "Owner", type: "user", isPrimary: false, choices: [] },
      { id: "Col4", key: "due", name: "Due", type: "date", isPrimary: false, choices: [] },
    ],
  };
}
