import { describe, it, expect, vi, beforeEach } from "vitest";
import { createGetListItemTool, NO_ITEM_ID_MESSAGE } from "./getListItem.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import type { ListInfo } from "../../slack/lists.js";
import type { ListItem } from "../../slack/listTypes.js";
import { checkFileAccess, FILE_ACCESS_DENIED_MESSAGE } from "../../slack/requesterAccess.js";
import { slackError } from "../../slack/testCanvasApi.js";
import { createListApiMock, type MockListApi } from "../../slack/testListApi.js";
import { createSlackClientMock, type MockSlackClient } from "../../slack/testSlackClient.js";

// The requester access check is an outside dependency: stub the verdict and assert the wiring.
vi.mock("../../slack/requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../slack/requesterAccess.js")>();
  return { ...actual, checkFileAccess: vi.fn() };
});

function makeCtx(slackClient: MockSlackClient | undefined): QueryToolContext {
  const ctx: QueryToolContext = Object.assign(Object.create(null), {
    mode: "query",
    userId: "U1",
    role: "member",
    session: {
      sessionId: "s1",
      channelId: "C1",
      messageTs: "1.0",
      threadTs: "1.0",
      userId: "U1",
      threadContext: [],
      errors: [],
      lastActivity: Date.now(),
      createdAt: Date.now(),
    },
    config: { repositories: [], lists: { mode: "write" } },
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    slackClient,
  });
  return ctx;
}

const extra = { sessionId: "s1" };
const LIST_ID = "F0456ABC";
const LIST_URL_WITH_RECORD = "https://acme.slack.com/lists/T0123/F0456ABC?record_id=Rec789ABC";

const INFO: ListInfo = {
  id: LIST_ID,
  title: "Launch tasks",
  permalink: undefined,
  columns: [
    { id: "Col1", key: "name", name: "Name", type: "text", isPrimary: true, choices: [] },
    {
      id: "Col2",
      key: "status",
      name: "Status",
      type: "select",
      isPrimary: false,
      choices: [{ value: "opt_done", label: "Done" }],
    },
  ],
};

const ITEM: ListItem = {
  id: "Rec1",
  fields: [
    { columnId: "Col1", text: "Write docs" },
    { columnId: "Col2", select: ["opt_done"] },
  ],
};

describe("get_list_item", () => {
  let client: MockSlackClient;
  let api: MockListApi;
  let ctx: QueryToolContext;

  beforeEach(() => {
    client = createSlackClientMock();
    api = createListApiMock();
    api.getListInfo.mockResolvedValue(INFO);
    api.getItem.mockResolvedValue(ITEM);
    ctx = makeCtx(client);
    vi.mocked(checkFileAccess).mockReset();
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "read",
      creator: "U1",
      facts: { filetype: "list" },
    });
  });

  it("returns the item's translated fields for a List id and item id", async () => {
    const result = await createGetListItemTool(ctx, api).handler(
      { list: LIST_ID, item_id: "Rec1" },
      extra,
    );

    expect(result.isError).not.toBe(true);
    expect(api.getListInfo).toHaveBeenCalledWith(client, LIST_ID);
    expect(api.getItem).toHaveBeenCalledWith(client, LIST_ID, "Rec1");
    expect(parseToolResult(result)).toEqual({
      list_id: LIST_ID,
      item_id: "Rec1",
      fields: [
        { column: "Name", value: "Write docs" },
        { column: "Status", value: "Done" },
      ],
    });
  });

  it("takes the item id from the URL's record_id when item_id is absent", async () => {
    const result = await createGetListItemTool(ctx, api).handler(
      { list: LIST_URL_WITH_RECORD, item_id: undefined },
      extra,
    );

    expect(api.getItem).toHaveBeenCalledWith(client, LIST_ID, "Rec789ABC");
    expect(parseToolResult(result).item_id).toBe("Rec789ABC");
  });

  it("prefers an explicit item_id over the URL's record_id", async () => {
    const result = await createGetListItemTool(ctx, api).handler(
      { list: LIST_URL_WITH_RECORD, item_id: " Rec1 " },
      extra,
    );

    expect(api.getItem).toHaveBeenCalledWith(client, LIST_ID, "Rec1");
    expect(parseToolResult(result).item_id).toBe("Rec1");
  });

  it.each([{ item_id: undefined }, { item_id: "   " }])(
    "errors without calling the List api when no item id is given ($item_id)",
    async ({ item_id }) => {
      const result = await createGetListItemTool(ctx, api).handler(
        { list: LIST_ID, item_id },
        extra,
      );

      expect(result.isError).toBe(true);
      expect(parseToolResult(result).error).toBe(NO_ITEM_ID_MESSAGE);
      expect(checkFileAccess).not.toHaveBeenCalled();
      expect(api.getListInfo).not.toHaveBeenCalled();
      expect(api.getItem).not.toHaveBeenCalled();
    },
  );

  it("refuses a List the requester cannot see, without reading it", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({ allowed: false, reason: "no_evidence" });

    const result = await createGetListItemTool(ctx, api).handler(
      { list: LIST_ID, item_id: "Rec1" },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe(FILE_ACCESS_DENIED_MESSAGE);
    expect(api.getListInfo).not.toHaveBeenCalled();
    expect(api.getItem).not.toHaveBeenCalled();
  });

  it("maps a Slack error to its List message", async () => {
    api.getItem.mockRejectedValue(slackError("item_not_found"));

    const result = await createGetListItemTool(ctx, api).handler(
      { list: LIST_ID, item_id: "Rec1" },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toMatch(
      /Slack could not find that List or item \(read item\)/,
    );
  });
});
