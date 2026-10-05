import { beforeEach, describe, expect, it } from "vitest";
import {
  createItem,
  createList,
  defaultListApi,
  deleteItems,
  getItem,
  getListInfo,
  listErrorMessage,
  listItems,
  shareListWithChannel,
  slugKey,
  updateCells,
} from "./lists.js";
import { isDirectConversation } from "./fileRef.js";
import { slackError } from "./testCanvasApi.js";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";

const LIST_ID = "F0LIST123";

describe("slugKey", () => {
  it("lowercases and turns punctuation into underscores", () => {
    expect(slugKey("Due Date (UTC)!", new Set())).toBe("due_date__utc");
  });

  it("uses col for a name with no alphanumerics", () => {
    expect(slugKey("", new Set())).toBe("col");
    expect(slugKey("!!!", new Set())).toBe("col");
  });

  it("appends a counter until the key is unused and records it", () => {
    const used = new Set<string>();

    expect(slugKey("Status", used)).toBe("status");
    expect(slugKey("status", used)).toBe("status_2");
    expect(slugKey("STATUS", used)).toBe("status_3");
    expect(used).toEqual(new Set(["status", "status_2", "status_3"]));
  });
});

describe("list API calls", () => {
  let client: MockSlackClient;

  beforeEach(() => {
    client = createSlackClientMock();
  });

  describe("getListInfo", () => {
    it("maps the file's schema, choices and max", async () => {
      client.files.info.mockResolvedValue({
        ok: true,
        file: {
          filetype: "list",
          title: "Roadmap",
          name: "roadmap-file",
          permalink: "https://acme.slack.com/lists/T1/F0LIST123",
          list_metadata: {
            schema: [
              { id: "Col1", key: "name", name: "Name", type: "text", is_primary_column: true },
              {
                id: "Col2",
                key: "status",
                name: "Status",
                type: "select",
                options: { choices: [{ value: "todo", label: "To do" }, { value: "done" }] },
              },
              { id: "Col3", key: "score", name: "Score", type: "rating", options: { max: 5 } },
            ],
          },
        },
      });
      const status = { id: "Col2", key: "status", name: "Status", type: "select" };
      const score = { id: "Col3", key: "score", name: "Score", type: "rating" };

      await expect(getListInfo(client, LIST_ID)).resolves.toEqual({
        id: LIST_ID,
        title: "Roadmap",
        permalink: "https://acme.slack.com/lists/T1/F0LIST123",
        columns: [
          { id: "Col1", key: "name", name: "Name", type: "text", isPrimary: true, choices: [] },
          {
            ...status,
            isPrimary: false,
            choices: [
              { value: "todo", label: "To do" },
              { value: "done", label: "done" },
            ],
          },
          { ...score, isPrimary: false, choices: [], max: 5 },
        ],
      });
      expect(client.files.info).toHaveBeenCalledWith({ file: LIST_ID });
    });

    it("falls back to the file name, then to an empty title", async () => {
      client.files.info.mockResolvedValueOnce({
        ok: true,
        file: { name: "roadmap-file", list_metadata: { schema: [] } },
      });
      client.files.info.mockResolvedValueOnce({
        ok: true,
        file: { list_metadata: { schema: [] } },
      });

      await expect(getListInfo(client, LIST_ID)).resolves.toEqual({
        id: LIST_ID,
        title: "roadmap-file",
        permalink: undefined,
        columns: [],
      });
      await expect(getListInfo(client, LIST_ID)).resolves.toMatchObject({ title: "" });
    });

    it("drops a column missing a required property", async () => {
      client.files.info.mockResolvedValue({
        ok: true,
        file: {
          list_metadata: {
            schema: [
              { id: "Col1", name: "No key", type: "text" },
              { id: "Col2", key: "name", name: "Name", type: "text" },
            ],
          },
        },
      });

      const info = await getListInfo(client, LIST_ID);

      expect(info.columns.map((column) => column.id)).toEqual(["Col2"]);
    });

    it("throws for a file that is not a list", async () => {
      client.files.info.mockResolvedValue({
        ok: true,
        file: { filetype: "quip", list_metadata: { schema: [] } },
      });

      await expect(getListInfo(client, LIST_ID)).rejects.toThrow("That file is not a Slack List");
    });

    it("throws when the file carries no schema", async () => {
      client.files.info.mockResolvedValueOnce({ ok: true, file: { filetype: "list" } });
      client.files.info.mockResolvedValueOnce({
        ok: true,
        file: { filetype: "list", list_metadata: {} },
      });

      await expect(getListInfo(client, LIST_ID)).rejects.toThrow("That file is not a Slack List");
      await expect(getListInfo(client, LIST_ID)).rejects.toThrow("That file is not a Slack List");
    });
  });

  describe("listItems", () => {
    it("maps items and their fields", async () => {
      // The SDK's response type declares only a few cell keys; Slack returns one per column type.
      const response = {
        ok: true,
        items: [
          {
            id: "Rec1",
            list_id: LIST_ID,
            fields: [
              { column_id: "Col1", key: "name", text: "Ship it" },
              { column_id: "Col2", select: ["todo"], user: ["U1"], channel: ["C1"] },
              { column_id: "Col3", date: ["2026-10-02"], email: ["a@b.co"], phone: ["+1555"] },
              { column_id: "Col4", number: [3], rating: [4], checkbox: true },
            ],
          },
        ],
        response_metadata: { next_cursor: "next-page" },
      };
      client.slackLists.items.list.mockResolvedValue(response);

      await expect(listItems(client, LIST_ID, { limit: 50 })).resolves.toEqual({
        items: [
          {
            id: "Rec1",
            fields: [
              { columnId: "Col1", key: "name", text: "Ship it" },
              { columnId: "Col2", select: ["todo"], user: ["U1"], channel: ["C1"] },
              { columnId: "Col3", date: ["2026-10-02"], email: ["a@b.co"], phone: ["+1555"] },
              { columnId: "Col4", number: [3], rating: [4], checkbox: true },
            ],
          },
        ],
        nextCursor: "next-page",
      });
    });

    it("omits cursor and archived when not given", async () => {
      client.slackLists.items.list.mockResolvedValue({ ok: true, items: [] });

      await listItems(client, LIST_ID, { limit: 50 });

      expect(client.slackLists.items.list).toHaveBeenCalledWith({ list_id: LIST_ID, limit: 50 });
      const [args] = client.slackLists.items.list.mock.calls[0];
      expect(Object.keys(args)).toEqual(["list_id", "limit"]);
    });

    it("passes cursor and archived when given", async () => {
      client.slackLists.items.list.mockResolvedValue({ ok: true, items: [] });

      await listItems(client, LIST_ID, { limit: 10, cursor: "abc", archived: true });

      expect(client.slackLists.items.list).toHaveBeenCalledWith({
        list_id: LIST_ID,
        limit: 10,
        cursor: "abc",
        archived: true,
      });
    });

    it("maps an empty next cursor to undefined", async () => {
      client.slackLists.items.list.mockResolvedValue({
        ok: true,
        items: [],
        response_metadata: { next_cursor: "" },
      });

      await expect(listItems(client, LIST_ID, { limit: 50 })).resolves.toEqual({
        items: [],
        nextCursor: undefined,
      });
    });

    it("drops an item without an id and a field without a column id", async () => {
      client.slackLists.items.list.mockResolvedValue({
        ok: true,
        items: [
          { fields: [{ column_id: "Col1", text: "orphan" }] },
          { id: "Rec2", fields: [{ text: "no column" }, { column_id: "Col1", text: "kept" }] },
        ],
      });

      const page = await listItems(client, LIST_ID, { limit: 50 });

      expect(page.items).toEqual([{ id: "Rec2", fields: [{ columnId: "Col1", text: "kept" }] }]);
    });

    it("ignores a cell key it does not know", async () => {
      const response = {
        ok: true,
        items: [{ id: "Rec1", fields: [{ column_id: "Col1", text: "x", vote: ["U1"] }] }],
      };
      client.slackLists.items.list.mockResolvedValue(response);

      const page = await listItems(client, LIST_ID, { limit: 50 });

      expect(page.items).toEqual([{ id: "Rec1", fields: [{ columnId: "Col1", text: "x" }] }]);
    });
  });

  describe("getItem", () => {
    it("returns the record", async () => {
      client.slackLists.items.info.mockResolvedValue({
        ok: true,
        record: { id: "Rec1", fields: [{ column_id: "Col1", text: "Ship it" }] },
      });

      await expect(getItem(client, LIST_ID, "Rec1")).resolves.toEqual({
        id: "Rec1",
        fields: [{ columnId: "Col1", text: "Ship it" }],
      });
      expect(client.slackLists.items.info).toHaveBeenCalledWith({ list_id: LIST_ID, id: "Rec1" });
    });

    it("throws when the response has no record", async () => {
      client.slackLists.items.info.mockResolvedValue({ ok: true });

      await expect(getItem(client, LIST_ID, "Rec1")).rejects.toThrow(
        "slackLists.items.info returned no item",
      );
    });
  });

  describe("createItem", () => {
    it("sends the cells as initial fields and returns the new id", async () => {
      client.slackLists.items.create.mockResolvedValue({ ok: true, item: { id: "Rec9" } });
      const cells = [
        { column_id: "Col2", select: ["todo"] },
        { column_id: "Col4", checkbox: true },
      ];

      await expect(createItem(client, LIST_ID, cells)).resolves.toBe("Rec9");
      expect(client.slackLists.items.create).toHaveBeenCalledWith({
        list_id: LIST_ID,
        initial_fields: cells,
      });
    });

    it("throws when the response has no item id", async () => {
      client.slackLists.items.create.mockResolvedValue({ ok: true, item: {} });

      await expect(createItem(client, LIST_ID, [])).rejects.toThrow(
        "slackLists.items.create returned no item id",
      );
    });
  });

  describe("updateCells", () => {
    it("sends the cells", async () => {
      const cells = [{ row_id: "Rec1", column_id: "Col2", select: ["done"] }];

      await expect(updateCells(client, LIST_ID, cells)).resolves.toBeUndefined();
      expect(client.slackLists.items.update).toHaveBeenCalledWith({ list_id: LIST_ID, cells });
    });
  });

  describe("deleteItems", () => {
    it("deletes the items in one call", async () => {
      await expect(deleteItems(client, LIST_ID, ["Rec1", "Rec2"])).resolves.toBeUndefined();
      expect(client.slackLists.items.deleteMultiple).toHaveBeenCalledWith({
        list_id: LIST_ID,
        ids: ["Rec1", "Rec2"],
      });
    });
  });

  describe("createList", () => {
    const task = { key: "task", name: "Task", type: "text", is_primary_column: true };

    it("makes the first column primary and gives every column a unique key", async () => {
      client.slackLists.create.mockResolvedValue({ ok: true, list_id: LIST_ID });

      await expect(
        createList(client, {
          name: "Roadmap",
          columns: [
            { name: "Task", type: "text" },
            { name: "Due date", type: "date" },
            { name: "due-date", type: "date" },
          ],
        }),
      ).resolves.toBe(LIST_ID);
      expect(client.slackLists.create).toHaveBeenCalledWith({
        name: "Roadmap",
        schema: [
          task,
          { key: "due_date", name: "Due date", type: "date" },
          { key: "due_date_2", name: "due-date", type: "date" },
        ],
      });
    });

    it("turns select options into choices with unique values and cycling colors", async () => {
      client.slackLists.create.mockResolvedValue({ ok: true, list_id: LIST_ID });
      const options = ["To do", "to-do", "Doing", "Done", "Blocked", "Parked", "Dropped"];

      await createList(client, {
        name: "Roadmap",
        columns: [
          { name: "Task", type: "text", options: [] },
          { name: "Status", type: "select", options },
        ],
      });

      const choices = [
        { value: "to_do", label: "To do", color: "blue" },
        { value: "to_do_2", label: "to-do", color: "green" },
        { value: "doing", label: "Doing", color: "yellow" },
        { value: "done", label: "Done", color: "red" },
        { value: "blocked", label: "Blocked", color: "purple" },
        { value: "parked", label: "Parked", color: "gray" },
        { value: "dropped", label: "Dropped", color: "blue" },
      ];
      expect(client.slackLists.create).toHaveBeenCalledWith({
        name: "Roadmap",
        schema: [task, { key: "status", name: "Status", type: "select", options: { choices } }],
      });
    });

    it("sends the description and todo mode only when given", async () => {
      client.slackLists.create.mockResolvedValue({ ok: true, list_id: LIST_ID });
      const columns = [{ name: "Task", type: "text" }];

      await createList(client, { name: "Plain", columns });
      await createList(client, { name: "Rich", columns, description: "Q4 work", todoMode: true });

      const [plain] = client.slackLists.create.mock.calls[0];
      expect(Object.keys(plain)).toEqual(["name", "schema"]);
      const section = { type: "rich_text_section", elements: [{ type: "text", text: "Q4 work" }] };
      expect(client.slackLists.create).toHaveBeenLastCalledWith({
        name: "Rich",
        schema: [task],
        description_blocks: [{ type: "rich_text", elements: [section] }],
        todo_mode: true,
      });
    });

    it("falls back to the id of the returned list object", async () => {
      // The SDK's response type declares `list_id` only.
      const response = { ok: true, list: { id: LIST_ID } };
      client.slackLists.create.mockResolvedValue(response);

      await expect(createList(client, { name: "Roadmap", columns: [] })).resolves.toBe(LIST_ID);
    });

    it("throws when the response has no list id", async () => {
      client.slackLists.create.mockResolvedValue({ ok: true });

      await expect(createList(client, { name: "Roadmap", columns: [] })).rejects.toThrow(
        "slackLists.create returned no list id",
      );
    });
  });

  describe("shareListWithChannel", () => {
    it("grants the channel write access", async () => {
      await expect(shareListWithChannel(client, LIST_ID, "C123")).resolves.toBeUndefined();
      expect(client.slackLists.access.set).toHaveBeenCalledWith({
        list_id: LIST_ID,
        access_level: "write",
        channel_ids: ["C123"],
      });
    });
  });
});

describe("listErrorMessage", () => {
  const missingScope = [
    "Slack rejected add items: the app is missing a Lists scope.",
    "An admin must re-upload the app manifest and reinstall the app to the workspace.",
  ].join(" ");
  const paidPlan = "Slack rejected add items: Lists need a paid Slack plan.";
  const notFound = [
    "Slack could not find that List or item (add items).",
    "It may be deleted, not a List, or not shared with Clack.",
  ].join(" ");
  const notAllowed = [
    "Slack did not permit Clack to add items.",
    "The List must be shared with a channel Clack is in, with edit access for changes.",
  ].join(" ");
  const invalidValues = [
    "Slack rejected the values sent to add items.",
    "Read the List again and check each column's type and options.",
  ].join(" ");
  const rateLimited = "Slack rate-limited add items. Wait a minute, then retry with fewer items.";

  it.each([
    ["missing_scope", missingScope],
    ["paid_teams_only", paidPlan],
    ["feature_not_enabled", paidPlan],
    ["not_allowed_for_free_teams", paidPlan],
    ["list_not_found", notFound],
    ["file_not_found", notFound],
    ["item_not_found", notFound],
    ["record_not_found", notFound],
    ["access_denied", notAllowed],
    ["no_permission", notAllowed],
    ["restricted_action", notAllowed],
    ["invalid_args", invalidValues],
    ["invalid_arguments", invalidValues],
    ["ratelimited", rateLimited],
  ])("maps %s", (code, expected) => {
    expect(listErrorMessage("add items", slackError(code))).toBe(expected);
  });

  it("names an unmapped code", () => {
    expect(listErrorMessage("add items", slackError("internal_error"))).toBe(
      "Slack rejected add items: internal_error.",
    );
  });

  it("falls back to the error message for a plain Error", () => {
    expect(listErrorMessage("add items", new Error("socket hang up"))).toBe(
      "add items failed: socket hang up",
    );
  });
});

describe("defaultListApi", () => {
  it("bundles the list functions", () => {
    expect(defaultListApi).toEqual({
      getListInfo,
      listItems,
      getItem,
      createItem,
      updateCells,
      deleteItems,
      createList,
      shareListWithChannel,
      isDirectConversation,
    });
  });
});
