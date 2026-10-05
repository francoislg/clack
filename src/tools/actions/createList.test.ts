import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCreateListTool, CREATABLE_COLUMN_TYPES } from "./createList.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import { recordGrant } from "../../slack/requesterAccess.js";
import type { ListInfo, NewListColumn } from "../../slack/lists.js";
import { slackError } from "../../slack/testCanvasApi.js";
import { createListApiMock, type MockListApi } from "../../slack/testListApi.js";
import { createSlackClientMock, type MockSlackClient } from "../../slack/testSlackClient.js";

// Recording a session grant is an outside dependency: stub it and assert the wiring.
vi.mock("../../slack/requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../slack/requesterAccess.js")>();
  return { ...actual, checkFileAccess: vi.fn(), recordGrant: vi.fn() };
});

function makeCtx(
  slackClient: MockSlackClient | undefined,
  channelId: string = "C1",
): QueryToolContext {
  const ctx: QueryToolContext = Object.assign(Object.create(null), {
    mode: "query",
    userId: "U1",
    role: "member",
    session: {
      sessionId: "s1",
      channelId,
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
const LIST_ID = "F0NEWLIST";
const PERMALINK = "https://acme.slack.com/lists/T0123/F0NEWLIST";

const TITLE: NewListColumn = { name: "Title", type: "text" };
const STATUS: NewListColumn = { name: "Status", type: "select", options: ["Todo", "Done"] };
function listArgs(columns: NewListColumn[]) {
  return { name: "Tasks", description: undefined, columns, todo_mode: undefined };
}

const input = listArgs([TITLE, STATUS]);

const LIST_INFO: ListInfo = { id: LIST_ID, title: "Tasks", permalink: PERMALINK, columns: [] };

describe("create_list", () => {
  let client: MockSlackClient;
  let api: MockListApi;
  let ctx: QueryToolContext;

  beforeEach(() => {
    client = createSlackClientMock();
    api = createListApiMock();
    api.createList.mockResolvedValue(LIST_ID);
    api.isDirectConversation.mockResolvedValue(false);
    api.shareListWithChannel.mockResolvedValue(undefined);
    api.getListInfo.mockResolvedValue(LIST_INFO);
    ctx = makeCtx(client);
    vi.mocked(recordGrant).mockReset();
    vi.mocked(recordGrant).mockResolvedValue(undefined);
  });

  it("creates the List, shares it with the session channel and records the grant", async () => {
    const result = await createCreateListTool(ctx, api).handler(input, extra);

    expect(result.isError).not.toBe(true);
    expect(api.createList).toHaveBeenCalledWith(client, {
      name: "Tasks",
      description: undefined,
      columns: [TITLE, STATUS],
      todoMode: undefined,
    });
    expect(api.isDirectConversation).toHaveBeenCalledWith(client, "C1");
    expect(api.shareListWithChannel).toHaveBeenCalledWith(client, LIST_ID, "C1");
    expect(recordGrant).toHaveBeenCalledWith(
      { client, userId: "U1", role: "member", session: ctx.session },
      LIST_ID,
    );
    expect(api.getListInfo).toHaveBeenCalledWith(client, LIST_ID);
    expect(parseToolResult(result)).toEqual({
      list_id: LIST_ID,
      permalink: PERMALINK,
      shared_with_channel: "C1",
    });
  });

  it("passes the description and todo mode through", async () => {
    await createCreateListTool(ctx, api).handler(
      { ...input, description: "Sprint work", todo_mode: true },
      extra,
    );

    expect(api.createList).toHaveBeenCalledWith(client, {
      name: "Tasks",
      description: "Sprint work",
      columns: [TITLE, STATUS],
      todoMode: true,
    });
  });

  it("does not share the List in a DM", async () => {
    api.isDirectConversation.mockResolvedValue(true);

    const result = await createCreateListTool(ctx, api).handler(input, extra);

    expect(api.shareListWithChannel).not.toHaveBeenCalled();
    expect(recordGrant).toHaveBeenCalledWith(expect.anything(), LIST_ID);
    expect(parseToolResult(result)).toEqual({ list_id: LIST_ID, permalink: PERMALINK });
  });

  it("skips sharing when the session has no channel id", async () => {
    const result = await createCreateListTool(makeCtx(client, ""), api).handler(input, extra);

    expect(api.isDirectConversation).not.toHaveBeenCalled();
    expect(api.shareListWithChannel).not.toHaveBeenCalled();
    expect(parseToolResult(result)).toEqual({ list_id: LIST_ID, permalink: PERMALINK });
  });

  it("succeeds with a warning when sharing fails", async () => {
    api.shareListWithChannel.mockRejectedValue(slackError("restricted_action"));

    const result = await createCreateListTool(ctx, api).handler(input, extra);

    expect(result.isError).not.toBe(true);
    expect(parseToolResult(result)).toEqual({
      list_id: LIST_ID,
      permalink: PERMALINK,
      warning:
        "Slack did not permit Clack to share. The List must be shared with a channel Clack is in, with edit access for changes.",
    });
    expect(recordGrant).toHaveBeenCalledWith(expect.anything(), LIST_ID);
  });

  it("maps a Slack error from the creation and neither shares nor records a grant", async () => {
    api.createList.mockRejectedValue(slackError("missing_scope"));

    const result = await createCreateListTool(ctx, api).handler(input, extra);

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toMatch(/missing a Lists scope/);
    expect(api.isDirectConversation).not.toHaveBeenCalled();
    expect(api.shareListWithChannel).not.toHaveBeenCalled();
    expect(recordGrant).not.toHaveBeenCalled();
  });

  it("still returns the id when the permalink lookup fails", async () => {
    api.getListInfo.mockRejectedValue(new Error("boom"));

    const result = await createCreateListTool(ctx, api).handler(input, extra);

    expect(result.isError).not.toBe(true);
    expect(parseToolResult(result)).toEqual({ list_id: LIST_ID, shared_with_channel: "C1" });
  });

  it("errors when no Slack client is available", async () => {
    const result = await createCreateListTool(makeCtx(undefined), api).handler(input, extra);

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toMatch(/Slack client is not available/);
    expect(api.createList).not.toHaveBeenCalled();
  });

  const invalid: Array<{ name: string; columns: NewListColumn[]; error: string }> = [
    {
      name: "the first column is not text",
      columns: [{ name: "Count", type: "number" }],
      error: "The first column is the item title and must be of type text.",
    },
    {
      name: "two columns share a name, ignoring case",
      columns: [TITLE, STATUS, { name: " status ", type: "text" }],
      error: 'Column name " status " is used more than once.',
    },
    {
      name: "three columns share a name (reported once)",
      columns: [TITLE, STATUS, { name: "status", type: "text" }, { name: "STATUS", type: "text" }],
      error: 'Column name "status" is used more than once.',
    },
    {
      name: "a column type is not supported",
      columns: [TITLE, { name: "Votes", type: "vote" }],
      error: `Column "Votes": type "vote" is not supported. Supported: ${CREATABLE_COLUMN_TYPES.join(", ")}.`,
    },
    {
      name: "a todo column type is requested",
      columns: [TITLE, { name: "Done", type: "todo_completed" }],
      error: `Column "Done": type "todo_completed" is not supported. Supported: ${CREATABLE_COLUMN_TYPES.join(", ")}.`,
    },
    {
      name: "options are given on a text column",
      columns: [TITLE, { name: "Notes", type: "text", options: ["A"] }],
      error: 'Column "Notes": only select and multi_select columns take options.',
    },
    {
      name: "a select column has no options",
      columns: [TITLE, { name: "Status", type: "select" }],
      error: 'Column "Status": a select column needs options.',
    },
    {
      name: "a multi_select column has empty options",
      columns: [TITLE, { name: "Tags", type: "multi_select", options: [] }],
      error: 'Column "Tags": a multi_select column needs options.',
    },
    {
      name: "there are two problems",
      columns: [
        { name: "Count", type: "number" },
        { name: "Status", type: "select" },
      ],
      error:
        'The first column is the item title and must be of type text.\nColumn "Status": a select column needs options.',
    },
  ];

  it.each(invalid)("creates nothing when $name", async ({ columns, error }) => {
    const result = await createCreateListTool(ctx, api).handler(listArgs(columns), extra);

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe(error);
    expect(api.createList).not.toHaveBeenCalled();
    expect(recordGrant).not.toHaveBeenCalled();
  });

  it("offers every writable type except the todo ones", () => {
    expect(CREATABLE_COLUMN_TYPES).toEqual([
      "text",
      "number",
      "checkbox",
      "date",
      "select",
      "multi_select",
      "user",
      "channel",
      "rating",
      "email",
      "phone",
      "link",
    ]);
  });
});
