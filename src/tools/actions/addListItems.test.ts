import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAddListItemsTool, MAX_ITEMS_PER_ADD } from "./addListItems.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import { LIST_READ_ONLY_MESSAGE } from "../listTools.js";
import { checkFileAccess, FILE_ACCESS_DENIED_MESSAGE } from "../../slack/requesterAccess.js";
import { toRichText } from "../../slack/richText.js";
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
const LIST_ID = "F0LIST123";

function titled(title: string) {
  return { fields: [{ column: "Title", value: title }] };
}

describe("add_list_items", () => {
  let client: MockSlackClient;
  let api: MockListApi;
  let ctx: QueryToolContext;

  beforeEach(() => {
    client = createSlackClientMock();
    api = createListApiMock();
    api.getListInfo.mockResolvedValue(createTasksListInfo());
    ctx = makeCtx(client);
    vi.mocked(checkFileAccess).mockReset();
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "write",
      creator: undefined,
      facts: { filetype: "list" },
    });
  });

  it("creates every item with its translated cells and returns the ids", async () => {
    api.createItem.mockResolvedValueOnce("Rec1").mockResolvedValueOnce("Rec2");

    const result = await createAddListItemsTool(ctx, api).handler(
      {
        list: LIST_ID,
        items: [
          {
            fields: [
              { column: "Title", value: "Buy milk" },
              { column: "Status", value: "Done" },
            ],
          },
          {
            fields: [
              { column: "Title", value: "Ship it" },
              { column: "Owner", value: "U2" },
              { column: "Due", value: "2026-01-15" },
            ],
          },
        ],
      },
      extra,
    );

    expect(result.isError).not.toBe(true);
    expect(checkFileAccess).toHaveBeenCalledWith(
      { client, userId: "U1", role: "member", session: ctx.session },
      LIST_ID,
    );
    expect(api.getListInfo).toHaveBeenCalledWith(client, LIST_ID);
    expect(api.createItem.mock.calls).toEqual([
      [
        client,
        LIST_ID,
        [
          { column_id: "Col1", rich_text: [toRichText("Buy milk")] },
          { column_id: "Col2", select: ["done"] },
        ],
      ],
      [
        client,
        LIST_ID,
        [
          { column_id: "Col1", rich_text: [toRichText("Ship it")] },
          { column_id: "Col3", user: ["U2"] },
          { column_id: "Col4", date: ["2026-01-15"] },
        ],
      ],
    ]);
    expect(parseToolResult(result)).toEqual({
      list_id: LIST_ID,
      created_item_ids: ["Rec1", "Rec2"],
    });
  });

  it("refuses more than the per-call maximum before any Slack call", async () => {
    const items = Array.from({ length: MAX_ITEMS_PER_ADD + 1 }, (_, i) => titled(`Item ${i}`));

    const result = await createAddListItemsTool(ctx, api).handler({ list: LIST_ID, items }, extra);

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe("Too many items: at most 20 per call.");
    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(api.getListInfo).not.toHaveBeenCalled();
    expect(api.createItem).not.toHaveBeenCalled();
  });

  it("refuses when the requester has no access to the List", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({ allowed: false, reason: "no_evidence" });

    const result = await createAddListItemsTool(ctx, api).handler(
      { list: LIST_ID, items: [titled("A")] },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe(FILE_ACCESS_DENIED_MESSAGE);
    expect(api.createItem).not.toHaveBeenCalled();
  });

  it("refuses when the bot can only read the List", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "read",
      creator: undefined,
      facts: { filetype: "list" },
    });

    const result = await createAddListItemsTool(ctx, api).handler(
      { list: LIST_ID, items: [titled("A")] },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe(LIST_READ_ONLY_MESSAGE);
    expect(api.createItem).not.toHaveBeenCalled();
  });

  it("creates nothing when one item names an unknown column", async () => {
    const result = await createAddListItemsTool(ctx, api).handler(
      { list: LIST_ID, items: [titled("A"), { fields: [{ column: "Priority", value: "High" }] }] },
      extra,
    );

    expect(result.isError).toBe(true);
    const { error } = parseToolResult(result);
    expect(error).toMatch(/^Item 2: /);
    expect(error).toContain("Title, Status, Owner, Due");
    expect(api.createItem).not.toHaveBeenCalled();
  });

  it("reports the problems of every invalid item", async () => {
    const result = await createAddListItemsTool(ctx, api).handler(
      {
        list: LIST_ID,
        items: [
          { fields: [{ column: "Status", value: "Blocked" }] },
          titled("B"),
          { fields: [{ column: "Due", value: "tomorrow" }] },
        ],
      },
      extra,
    );

    expect(result.isError).toBe(true);
    const lines = String(parseToolResult(result).error).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^Item 1: Column "Status"/);
    expect(lines[1]).toMatch(/^Item 3: Column "Due"/);
    expect(api.createItem).not.toHaveBeenCalled();
  });

  it("stops at the first failed creation and names the items already created", async () => {
    api.createItem.mockResolvedValueOnce("Rec1").mockRejectedValueOnce(slackError("ratelimited"));

    const result = await createAddListItemsTool(ctx, api).handler(
      { list: LIST_ID, items: [titled("A"), titled("B"), titled("C")] },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(api.createItem).toHaveBeenCalledTimes(2);
    expect(parseToolResult(result).error).toBe(
      "Slack rate-limited add item. Wait a minute, then retry with fewer items. Item 2 of 3 failed; created before it: Rec1. The remaining items were not attempted.",
    );
  });

  it("says none were created when the first creation fails", async () => {
    api.createItem.mockRejectedValueOnce(slackError("ratelimited"));

    const result = await createAddListItemsTool(ctx, api).handler(
      { list: LIST_ID, items: [titled("A"), titled("B")] },
      extra,
    );

    expect(parseToolResult(result).error).toContain("Item 1 of 2 failed; created before it: none.");
  });

  it("maps a failure to read the List's columns", async () => {
    api.getListInfo.mockRejectedValue(slackError("file_not_found"));

    const result = await createAddListItemsTool(ctx, api).handler(
      { list: LIST_ID, items: [titled("A")] },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toMatch(/could not find that List/);
    expect(api.createItem).not.toHaveBeenCalled();
  });

  it("refuses a value that is no Slack reference without a Slack call", async () => {
    const result = await createAddListItemsTool(ctx, api).handler(
      { list: "not a list", items: [titled("A")] },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toMatch(/is not a Slack reference/);
    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(api.createItem).not.toHaveBeenCalled();
  });
});
