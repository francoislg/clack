import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import {
  createDeleteListItemsTool,
  MAX_ITEMS_PER_DELETE,
  MAX_LOOKUP_PAGES,
} from "./deleteListItems.js";
import { makeCtx, makeIntentStore } from "./proposeConfigUpdate.testHelpers.js";
import type { IntentStore } from "../server.js";
import { LIST_READ_ONLY_MESSAGE } from "../listTools.js";
import { parseToolResult } from "../testHelpers.js";
import { checkFileAccess, FILE_ACCESS_DENIED_MESSAGE } from "../../slack/requesterAccess.js";
import { createSlackClientMock, type MockSlackClient } from "../../slack/testSlackClient.js";
import { createListApiMock, type MockListApi } from "../../slack/testListApi.js";
import type { ListInfo } from "../../slack/lists.js";
import type { ListItem } from "../../slack/listTypes.js";

// The requester access check is an outside dependency: stub the verdict and assert the wiring.
vi.mock("../../slack/requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../slack/requesterAccess.js")>();
  return { ...actual, checkFileAccess: vi.fn() };
});

const LIST_ID = "F0456ABC";

const LIST_INFO: ListInfo = {
  id: LIST_ID,
  title: "Groceries",
  permalink: undefined,
  columns: [
    { id: "Col1", key: "name", name: "Name", type: "text", isPrimary: true, choices: [] },
    { id: "Col2", key: "notes", name: "Notes", type: "text", isPrimary: false, choices: [] },
  ],
};

function item(id: string, name: string | undefined): ListItem {
  return {
    id,
    fields: [
      ...(name === undefined ? [] : [{ columnId: "Col1", text: name }]),
      { columnId: "Col2", text: "a note" },
    ],
  };
}

describe("delete_list_items", () => {
  let client: MockSlackClient;
  let api: MockListApi;
  let store: IntentStore;
  let stage: MockInstance<IntentStore["stage"]>;

  beforeEach(() => {
    client = createSlackClientMock();
    api = createListApiMock();
    store = makeIntentStore();
    stage = vi.spyOn(store, "stage");
    vi.mocked(checkFileAccess).mockReset();
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "write",
      creator: "U123",
    });
    api.getListInfo.mockResolvedValue(LIST_INFO);
    api.listItems.mockResolvedValue({
      items: [item("Rec1", "Buy milk"), item("Rec2", "Buy eggs"), item("Rec3", "Buy tea")],
      nextCursor: undefined,
    });
  });

  async function call(itemIds: string[]) {
    const toolDef = createDeleteListItemsTool(makeCtx({ slackClient: client }), store, api);
    const result = await toolDef.handler({ list: LIST_ID, item_ids: itemIds }, {});
    return { result, parsed: parseToolResult(result) };
  }

  it("stages the deletion with ids and primary-column labels, and removes nothing", async () => {
    const { result, parsed } = await call(["Rec2", "Rec1"]);

    const items = [
      { id: "Rec2", label: "Buy eggs" },
      { id: "Rec1", label: "Buy milk" },
    ];
    expect(result.isError).toBeFalsy();
    expect(stage).toHaveBeenCalledTimes(1);
    expect(stage).toHaveBeenCalledWith({ type: "list_items_delete", listId: LIST_ID, items });
    expect(parsed.ref).toBe(stage.mock.results[0]?.value);
    expect(parsed.list_id).toBe(LIST_ID);
    expect(parsed.items).toEqual(items);
    expect(parsed.applied).toBe(false);
    expect(parsed.instruction).toMatch(/STAGED/);
    expect(api.deleteItems).not.toHaveBeenCalled();
  });

  it("reads the List with the opened client and id", async () => {
    await call(["Rec1"]);

    expect(api.getListInfo).toHaveBeenCalledWith(client, LIST_ID);
    expect(api.listItems).toHaveBeenCalledWith(client, LIST_ID, { limit: 100, cursor: undefined });
  });

  it("refuses more than the per-call maximum before any access check", async () => {
    const ids = Array.from({ length: MAX_ITEMS_PER_DELETE + 1 }, (_, index) => `Rec${index}`);

    const { result, parsed } = await call(ids);

    expect(result.isError).toBe(true);
    expect(parsed.error).toBe("Too many items: at most 50 per deletion.");
    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(api.getListInfo).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
  });

  it("collapses duplicate ids", async () => {
    const { parsed } = await call(["Rec1", "Rec1", "Rec3", "Rec1"]);

    expect(parsed.items).toEqual([
      { id: "Rec1", label: "Buy milk" },
      { id: "Rec3", label: "Buy tea" },
    ]);
  });

  it("counts distinct ids against the maximum", async () => {
    const ids = Array.from({ length: MAX_ITEMS_PER_DELETE + 1 }, () => "Rec1");

    const { result } = await call(ids);

    expect(result.isError).toBeFalsy();
    expect(stage).toHaveBeenCalledTimes(1);
  });

  it("stages nothing when the requester cannot see the List", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({ allowed: false, reason: "no_evidence" });

    const { result, parsed } = await call(["Rec1"]);

    expect(result.isError).toBe(true);
    expect(parsed.error).toBe(FILE_ACCESS_DENIED_MESSAGE);
    expect(api.getListInfo).not.toHaveBeenCalled();
    expect(stage).not.toHaveBeenCalled();
  });

  it("stages nothing when the bot can only read the List", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "read",
      creator: "U123",
    });

    const { result, parsed } = await call(["Rec1"]);

    expect(result.isError).toBe(true);
    expect(parsed.error).toBe(LIST_READ_ONLY_MESSAGE);
    expect(stage).not.toHaveBeenCalled();
  });

  it("names the ids that are not in the List and stages nothing", async () => {
    const { result, parsed } = await call(["Rec1", "RecGone", "RecAlsoGone"]);

    expect(result.isError).toBe(true);
    expect(parsed.error).toBe(
      "These items were not found in the List: RecGone, RecAlsoGone. Read the List again for current item ids.",
    );
    expect(stage).not.toHaveBeenCalled();
  });

  it("follows the cursor to an item on the second page", async () => {
    api.listItems
      .mockResolvedValueOnce({ items: [item("Rec1", "Buy milk")], nextCursor: "cursor-2" })
      .mockResolvedValueOnce({ items: [item("Rec9", "Buy jam")], nextCursor: "cursor-3" });

    const { parsed } = await call(["Rec9"]);

    expect(parsed.items).toEqual([{ id: "Rec9", label: "Buy jam" }]);
    expect(api.listItems).toHaveBeenCalledTimes(2);
    expect(api.listItems).toHaveBeenLastCalledWith(client, LIST_ID, {
      limit: 100,
      cursor: "cursor-2",
    });
  });

  it("stops reading after the page limit", async () => {
    api.listItems.mockResolvedValue({ items: [], nextCursor: "more" });

    const { result } = await call(["Rec1"]);

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe(
      "These items were not found in the first 1000 items of the List (the search stops there): Rec1. Read the List again for current item ids.",
    );
    expect(api.listItems).toHaveBeenCalledTimes(MAX_LOOKUP_PAGES);
    expect(stage).not.toHaveBeenCalled();
  });

  it.each([
    { title: "empty", name: "   " },
    { title: "absent", name: undefined },
  ])("labels an item by its id when the primary cell is $title", async ({ name }) => {
    api.listItems.mockResolvedValue({ items: [item("Rec1", name)], nextCursor: undefined });

    const { parsed } = await call(["Rec1"]);

    expect(parsed.items).toEqual([{ id: "Rec1", label: "Rec1" }]);
  });

  it("labels every item by its id when the schema has no primary column", async () => {
    api.getListInfo.mockResolvedValue({
      ...LIST_INFO,
      columns: LIST_INFO.columns.map((column) => ({ ...column, isPrimary: false })),
    });
    api.listItems.mockResolvedValue({ items: [item("Rec1", "Buy milk")], nextCursor: undefined });

    const { parsed } = await call(["Rec1"]);

    expect(parsed.items).toEqual([{ id: "Rec1", label: "Rec1" }]);
  });

  it("cuts a label to 80 characters", async () => {
    api.listItems.mockResolvedValue({
      items: [item("Rec1", `  ${"x".repeat(120)}`)],
      nextCursor: undefined,
    });

    const { parsed } = await call(["Rec1"]);

    expect(parsed.items).toEqual([{ id: "Rec1", label: "x".repeat(80) }]);
  });

  it("reports a failed List read and stages nothing", async () => {
    api.listItems.mockRejectedValue(new Error("boom"));

    const { result, parsed } = await call(["Rec1"]);

    expect(result.isError).toBe(true);
    expect(parsed.error).toBe("read failed: boom");
    expect(stage).not.toHaveBeenCalled();
  });
});
