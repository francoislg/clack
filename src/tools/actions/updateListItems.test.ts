import { describe, it, expect, vi, beforeEach } from "vitest";
import { createUpdateListItemsTool, MAX_CELLS_PER_UPDATE } from "./updateListItems.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import { LIST_READ_ONLY_MESSAGE } from "../listTools.js";
import { checkFileAccess, FILE_ACCESS_DENIED_MESSAGE } from "../../slack/requesterAccess.js";
import { slackError } from "../../slack/testCanvasApi.js";
import {
  createListApiMock,
  createTasksListInfo,
  type MockListApi,
} from "../../slack/testListApi.js";
import { createSlackClientMock, type MockSlackClient } from "../../slack/testSlackClient.js";

// The requester-access check is an outside dependency: stub it and assert the wiring.
vi.mock("../../slack/requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../slack/requesterAccess.js")>();
  return { ...actual, checkFileAccess: vi.fn(), recordGrant: vi.fn() };
});

type FileAccess = Awaited<ReturnType<typeof checkFileAccess>>;

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
    config: { repositories: [] },
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    slackClient,
  });
  return ctx;
}

const extra = { sessionId: "s1" };
const LIST_ID = "F0LIST123";

function setStatus(itemId: string, label: string) {
  return { item_id: itemId, fields: [{ column: "Status", value: label }] };
}

describe("update_list_items", () => {
  let client: MockSlackClient;
  let api: MockListApi;
  let ctx: QueryToolContext;

  beforeEach(() => {
    client = createSlackClientMock();
    api = createListApiMock();
    api.getListInfo.mockResolvedValue(createTasksListInfo());
    api.updateCells.mockResolvedValue(undefined);
    ctx = makeCtx(client);
    vi.mocked(checkFileAccess).mockReset();
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "write",
      creator: undefined,
    });
  });

  it("sends every update as one change, each cell carrying its row id", async () => {
    const result = await createUpdateListItemsTool(ctx, api).handler(
      { list: LIST_ID, updates: [setStatus("Rec1", "Done"), setStatus("Rec2", "Todo")] },
      extra,
    );

    expect(result.isError).not.toBe(true);
    expect(checkFileAccess).toHaveBeenCalledWith(
      { client, userId: "U1", role: "member", session: ctx.session },
      LIST_ID,
    );
    expect(api.updateCells).toHaveBeenCalledTimes(1);
    expect(api.updateCells).toHaveBeenCalledWith(client, LIST_ID, [
      { column_id: "Col2", select: ["done"], row_id: "Rec1" },
      { column_id: "Col2", select: ["todo"], row_id: "Rec2" },
    ]);
    expect(parseToolResult(result)).toEqual({
      list_id: LIST_ID,
      updated_item_ids: ["Rec1", "Rec2"],
      cells: 2,
    });
  });

  it("reports each item id once, in input order", async () => {
    const result = await createUpdateListItemsTool(ctx, api).handler(
      {
        list: LIST_ID,
        updates: [
          setStatus("Rec2", "Done"),
          { item_id: "Rec1", fields: [{ column: "Due", value: "2026-01-15" }] },
          { item_id: "Rec2", fields: [{ column: "Owner", value: "U2" }] },
        ],
      },
      extra,
    );

    expect(parseToolResult(result)).toEqual({
      list_id: LIST_ID,
      updated_item_ids: ["Rec2", "Rec1"],
      cells: 3,
    });
  });

  it("refuses more than the per-call maximum of cells before any Slack call", async () => {
    const fields = Array.from({ length: MAX_CELLS_PER_UPDATE }, () => ({
      column: "Status",
      value: "Done",
    }));

    const result = await createUpdateListItemsTool(ctx, api).handler(
      { list: LIST_ID, updates: [{ item_id: "Rec1", fields }, setStatus("Rec2", "Done")] },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe("Too many cells: at most 100 per call.");
    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(api.getListInfo).not.toHaveBeenCalled();
    expect(api.updateCells).not.toHaveBeenCalled();
  });

  it("sends nothing when a value is invalid, naming the item id", async () => {
    const result = await createUpdateListItemsTool(ctx, api).handler(
      {
        list: LIST_ID,
        updates: [
          setStatus("Rec1", "Done"),
          { item_id: "Rec2", fields: [{ column: "Due", value: "next week" }] },
        ],
      },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe(
      'Item Rec2: Column "Due" (date): needs a date as YYYY-MM-DD.',
    );
    expect(api.updateCells).not.toHaveBeenCalled();
  });

  const refusals: Array<{ name: string; verdict: FileAccess; message: string }> = [
    {
      name: "the requester has no access to the List",
      verdict: { allowed: false, reason: "no_evidence" },
      message: FILE_ACCESS_DENIED_MESSAGE,
    },
    {
      name: "the bot can only read the List",
      verdict: { allowed: true, botAccess: "read", creator: undefined },
      message: LIST_READ_ONLY_MESSAGE,
    },
  ];

  it.each(refusals)("refuses when $name", async ({ verdict, message }) => {
    vi.mocked(checkFileAccess).mockResolvedValue(verdict);

    const result = await createUpdateListItemsTool(ctx, api).handler(
      { list: LIST_ID, updates: [setStatus("Rec1", "Done")] },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe(message);
    expect(api.updateCells).not.toHaveBeenCalled();
  });

  it("maps a Slack error from the update", async () => {
    api.updateCells.mockRejectedValue(slackError("item_not_found"));

    const result = await createUpdateListItemsTool(ctx, api).handler(
      { list: LIST_ID, updates: [setStatus("Rec1", "Done")] },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe(
      "Slack could not find that List or item (update). It may be deleted, not a List, or not shared with Clack.",
    );
  });
});
