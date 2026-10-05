import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  capItems,
  createReadListTool,
  DEFAULT_LIST_PAGE_SIZE,
  MAX_LIST_RESULT_CHARS,
} from "./readList.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import { NOT_A_LIST_REF_MESSAGE } from "../listTools.js";
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
    config: { repositories: [] },
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    slackClient,
  });
  return ctx;
}

const extra = { sessionId: "s1" };
const LIST_ID = "F0456ABC";
const NO_OPTIONS = { limit: undefined, cursor: undefined, archived: undefined };

const INFO: ListInfo = {
  id: LIST_ID,
  title: "Launch tasks",
  permalink: "https://acme.slack.com/lists/T0123/F0456ABC",
  columns: [
    { id: "Col1", key: "name", name: "Name", type: "text", isPrimary: true, choices: [] },
    {
      id: "Col2",
      key: "status",
      name: "Status",
      type: "select",
      isPrimary: false,
      choices: [
        { value: "opt_todo", label: "To do" },
        { value: "opt_done", label: "Done" },
      ],
    },
    { id: "Col3", key: "owner", name: "Owner", type: "user", isPrimary: false, choices: [] },
  ],
};

const ITEMS: ListItem[] = [
  {
    id: "Rec1",
    fields: [
      { columnId: "Col1", text: "Write docs" },
      { columnId: "Col2", select: ["opt_done"], text: "Done" },
      { columnId: "Col3", user: ["U7", "U8"] },
    ],
  },
];

function bigItems(count: number, chars: number): ListItem[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `Rec${index}`,
    fields: [{ columnId: "Col1", text: "a".repeat(chars) }],
  }));
}

describe("read_list", () => {
  let client: MockSlackClient;
  let api: MockListApi;
  let ctx: QueryToolContext;

  beforeEach(() => {
    client = createSlackClientMock();
    api = createListApiMock();
    api.getListInfo.mockResolvedValue(INFO);
    api.listItems.mockResolvedValue({ items: ITEMS, nextCursor: undefined });
    ctx = makeCtx(client);
    vi.mocked(checkFileAccess).mockReset();
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "read",
      creator: "U1",
    });
  });

  it("returns the title, columns and translated items", async () => {
    const result = await createReadListTool(ctx, api).handler(
      { list: LIST_ID, ...NO_OPTIONS },
      extra,
    );

    expect(result.isError).not.toBe(true);
    expect(api.getListInfo).toHaveBeenCalledWith(client, LIST_ID);
    expect(parseToolResult(result)).toEqual({
      list_id: LIST_ID,
      title: "Launch tasks",
      permalink: "https://acme.slack.com/lists/T0123/F0456ABC",
      columns: [
        { name: "Name", type: "text", primary: true },
        { name: "Status", type: "select", options: ["To do", "Done"] },
        { name: "Owner", type: "user" },
      ],
      items: [
        {
          item_id: "Rec1",
          fields: [
            { column: "Name", value: "Write docs" },
            { column: "Status", value: "Done" },
            { column: "Owner", value: ["U7", "U8"] },
          ],
        },
      ],
    });
  });

  it("omits the permalink when the List has none", async () => {
    api.getListInfo.mockResolvedValue({ ...INFO, permalink: undefined });

    const parsed = parseToolResult(
      await createReadListTool(ctx, api).handler({ list: LIST_ID, ...NO_OPTIONS }, extra),
    );

    expect(parsed).not.toHaveProperty("permalink");
  });

  it("asks for the default page size when no limit is given", async () => {
    await createReadListTool(ctx, api).handler({ list: LIST_ID, ...NO_OPTIONS }, extra);

    expect(api.listItems).toHaveBeenCalledWith(client, LIST_ID, {
      limit: DEFAULT_LIST_PAGE_SIZE,
      cursor: undefined,
      archived: undefined,
    });
    expect(DEFAULT_LIST_PAGE_SIZE).toBe(50);
  });

  it("passes limit, cursor and archived through", async () => {
    await createReadListTool(ctx, api).handler(
      { list: LIST_ID, limit: 10, cursor: "abc", archived: true },
      extra,
    );

    expect(api.listItems).toHaveBeenCalledWith(client, LIST_ID, {
      limit: 10,
      cursor: "abc",
      archived: true,
    });
  });

  it("returns next_cursor when the page has one", async () => {
    api.listItems.mockResolvedValue({ items: ITEMS, nextCursor: "next123" });

    const parsed = parseToolResult(
      await createReadListTool(ctx, api).handler({ list: LIST_ID, ...NO_OPTIONS }, extra),
    );

    expect(parsed.next_cursor).toBe("next123");
  });

  it("omits next_cursor on the last page", async () => {
    const parsed = parseToolResult(
      await createReadListTool(ctx, api).handler({ list: LIST_ID, ...NO_OPTIONS }, extra),
    );

    expect(parsed).not.toHaveProperty("next_cursor");
  });

  it("resolves a Slack List URL to its List id", async () => {
    const result = await createReadListTool(ctx, api).handler(
      { list: "https://acme.slack.com/lists/T0123/F0456ABC", ...NO_OPTIONS },
      extra,
    );

    expect(vi.mocked(checkFileAccess).mock.calls[0][1]).toBe(LIST_ID);
    expect(api.getListInfo).toHaveBeenCalledWith(client, LIST_ID);
    expect(parseToolResult(result).list_id).toBe(LIST_ID);
  });

  it("rejects a non-List reference without calling the List api", async () => {
    const result = await createReadListTool(ctx, api).handler(
      { list: "https://acme.slack.com/archives/C123/p1700000000000100", ...NO_OPTIONS },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe(NOT_A_LIST_REF_MESSAGE);
    expect(api.getListInfo).not.toHaveBeenCalled();
    expect(api.listItems).not.toHaveBeenCalled();
  });

  it("refuses a List the requester cannot see, without reading it", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({ allowed: false, reason: "no_evidence" });

    const result = await createReadListTool(ctx, api).handler(
      { list: LIST_ID, ...NO_OPTIONS },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe(FILE_ACCESS_DENIED_MESSAGE);
    expect(api.getListInfo).not.toHaveBeenCalled();
    expect(api.listItems).not.toHaveBeenCalled();
  });

  it("names the manifest re-upload and reinstall on a missing scope", async () => {
    api.listItems.mockRejectedValue(slackError("missing_scope"));

    const result = await createReadListTool(ctx, api).handler(
      { list: LIST_ID, ...NO_OPTIONS },
      extra,
    );

    expect(result.isError).toBe(true);
    const { error } = parseToolResult(result);
    expect(error).toMatch(/Slack rejected read: the app is missing a Lists scope/);
    expect(error).toMatch(/reinstall/);
  });

  it("cuts an oversized page at an item boundary and drops the cursor", async () => {
    api.listItems.mockResolvedValue({ items: bigItems(3, 40_000), nextCursor: "next123" });

    const parsed = parseToolResult(
      await createReadListTool(ctx, api).handler({ list: LIST_ID, ...NO_OPTIONS }, extra),
    );

    expect(parsed.items).toHaveLength(2);
    expect(parsed.items.map((item: { item_id: string }) => item.item_id)).toEqual(["Rec0", "Rec1"]);
    expect(parsed.truncated).toBe(true);
    expect(parsed.note).toBe(
      "Result cut after 2 of 3 items on this page to stay under 100000 characters. Call again with a smaller limit.",
    );
    expect(parsed).not.toHaveProperty("next_cursor");
  });
});

describe("capItems", () => {
  // JSON.stringify of an n-character string is n + 2 characters long.
  it.each([
    { name: "keeps every item when all fit", sizes: [10, 10, 10], max: 100, kept: 3 },
    { name: "keeps a run that lands exactly on the cap", sizes: [48, 48], max: 100, kept: 2 },
    { name: "cuts mid-way at an item boundary", sizes: [40, 40, 40], max: 100, kept: 2 },
    {
      name: "keeps nothing when the first item is over the cap",
      sizes: [200, 1],
      max: 100,
      kept: 0,
    },
    { name: "keeps nothing of an empty page", sizes: [], max: 100, kept: 0 },
  ])("$name", ({ sizes, max, kept }) => {
    const items = sizes.map((size) => "a".repeat(size));

    expect(capItems(items, max)).toEqual(items.slice(0, kept));
  });

  it("caps at MAX_LIST_RESULT_CHARS by default", () => {
    const items = ["a".repeat(MAX_LIST_RESULT_CHARS - 2), "b"];

    expect(capItems(items)).toEqual([items[0]]);
  });
});
