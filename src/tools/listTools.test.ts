import { describe, it, expect, vi, beforeEach } from "vitest";
import { LIST_READ_ONLY_MESSAGE, loadListInfo, openList } from "./listTools.js";
import { parseToolResult } from "./testHelpers.js";
import type { QueryToolContext } from "./types.js";
import {
  checkFileAccess,
  FILE_ACCESS_DENIED_MESSAGE,
  type FileFacts,
} from "../slack/requesterAccess.js";
import type { SlackFileRef, SlackRef } from "../slack/slackRefs.js";
import { listErrorMessage } from "../slack/lists.js";
import { slackError } from "../slack/testCanvasApi.js";
import { createListApiMock, createTasksListInfo, type MockListApi } from "../slack/testListApi.js";
import { createSlackClientMock, type MockSlackClient } from "../slack/testSlackClient.js";

// The requester access check is an outside dependency: stub the verdict and assert the wiring.
vi.mock("../slack/requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../slack/requesterAccess.js")>();
  return { ...actual, checkFileAccess: vi.fn() };
});

// The error-message mapping is an outside dependency: stub it and assert the wiring.
vi.mock("../slack/lists.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../slack/lists.js")>();
  return { ...actual, listErrorMessage: vi.fn() };
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
    config: { repositories: [], lists: { mode: "write" }, canvases: { mode: "read" } },
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    slackClient,
    availableRefs: new Map<string, SlackRef>(),
  });
  return ctx;
}

const LIST_FACTS: FileFacts = { filetype: "list", prettyType: "List" };

function allow(botAccess: "read" | "write" | undefined, facts: FileFacts = LIST_FACTS): void {
  vi.mocked(checkFileAccess).mockResolvedValue({
    allowed: true,
    botAccess,
    creator: "U1",
    facts,
  });
}

function registeredList(id: string): SlackFileRef {
  return {
    type: "file",
    id,
    kind: "list",
    label: "Slack List",
    reader: "read_list",
    mustOpen: false,
    fromCurrentMessage: true,
  };
}

describe("openList", () => {
  let client: MockSlackClient;
  let ctx: QueryToolContext;

  beforeEach(() => {
    client = createSlackClientMock();
    ctx = makeCtx(client);
    vi.mocked(checkFileAccess).mockReset();
    allow("read");
  });

  it("errors without a Slack client, before any access check", async () => {
    const opened = await openList(makeCtx(undefined), "F0456ABC", "read");

    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(parseToolResult(opened.error).error).toMatch(/Slack client is not available/);
    expect(checkFileAccess).not.toHaveBeenCalled();
  });

  it("redirects a message permalink to fetch_slack_message, before any access check", async () => {
    const opened = await openList(
      ctx,
      "https://acme.slack.com/archives/C123/p1700000000000100",
      "read",
    );

    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(parseToolResult(opened.error).error).toMatch(
      /is a Slack message: use fetch_slack_message/,
    );
    expect(checkFileAccess).not.toHaveBeenCalled();
  });

  it("refuses a value that is no Slack reference, before any access check", async () => {
    const opened = await openList(ctx, "hello world", "read");

    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(parseToolResult(opened.error).error).toMatch(/is not a Slack reference/);
    expect(checkFileAccess).not.toHaveBeenCalled();
  });

  it("redirects a canvas to read_canvas", async () => {
    allow("write", { filetype: "quip", prettyType: "Canvas" });

    const opened = await openList(ctx, "F0456ABC", "read");

    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(parseToolResult(opened.error).error).toBe('"F0456ABC" is a Canvas: use read_canvas');
  });

  it("registers an unregistered List it opens", async () => {
    await openList(ctx, "F0456ABC", "read");

    expect(ctx.availableRefs?.get("F0456ABC")).toMatchObject({
      kind: "list",
      fromCurrentMessage: false,
    });
  });

  it("still checks access on a registered List", async () => {
    ctx.availableRefs?.set("F0456ABC", registeredList("F0456ABC"));

    const opened = await openList(ctx, "F0456ABC", "read");

    expect(checkFileAccess).toHaveBeenCalledTimes(1);
    expect(opened.ok).toBe(true);
  });

  it("refuses a write on a registered List when the bot can only read it", async () => {
    ctx.availableRefs?.set("F0456ABC", registeredList("F0456ABC"));
    allow("read");

    const opened = await openList(ctx, "F0456ABC", "write");

    expect(checkFileAccess).toHaveBeenCalledTimes(1);
    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(parseToolResult(opened.error).error).toBe(LIST_READ_ONLY_MESSAGE);
  });

  it("refuses a List the requester cannot see", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({ allowed: false, reason: "no_evidence" });

    const opened = await openList(ctx, "F0456ABC", "read");

    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(opened.error.isError).toBe(true);
    expect(parseToolResult(opened.error).error).toBe(FILE_ACCESS_DENIED_MESSAGE);
  });

  it.each([
    { access: "read", botAccess: "read" },
    { access: "write", botAccess: "write" },
    { access: "write", botAccess: undefined },
  ] as const)("opens for $access when the bot's access is $botAccess", async (row) => {
    allow(row.botAccess);

    const opened = await openList(ctx, "F0456ABC", row.access);

    expect(opened).toEqual({ ok: true, client, listId: "F0456ABC", itemId: undefined });
  });

  it("refuses a write when the bot can only read the List", async () => {
    allow("read");

    const opened = await openList(ctx, "F0456ABC", "write");

    expect(opened.ok).toBe(false);
    if (opened.ok) return;
    expect(parseToolResult(opened.error).error).toBe(LIST_READ_ONLY_MESSAGE);
  });

  it("resolves a List URL carrying record_id to the list id and item id", async () => {
    const opened = await openList(
      ctx,
      "https://acme.slack.com/lists/T0123/F0456ABC?record_id=Rec789ABC",
      "read",
    );

    expect(opened).toEqual({ ok: true, client, listId: "F0456ABC", itemId: "Rec789ABC" });
  });

  it("checks access with the context's client, requester and session, and the List id", async () => {
    await openList(ctx, "https://acme.slack.com/lists/T0123/F0456ABC", "read");

    expect(checkFileAccess).toHaveBeenCalledTimes(1);
    expect(checkFileAccess).toHaveBeenCalledWith(
      { client, userId: "U1", role: "member", session: ctx.session },
      "F0456ABC",
    );
  });
});

describe("loadListInfo", () => {
  let client: MockSlackClient;
  let api: MockListApi;

  beforeEach(() => {
    client = createSlackClientMock();
    api = createListApiMock();
  });

  it("returns the List's schema", async () => {
    const info = createTasksListInfo();
    api.getListInfo.mockResolvedValue(info);

    const loaded = await loadListInfo(api, client, "F0LIST123");

    expect(loaded).toEqual({ ok: true, info });
    expect(api.getListInfo).toHaveBeenCalledWith(client, "F0LIST123");
  });

  it("returns the read error when the lookup fails", async () => {
    const failure = slackError("internal_error");
    api.getListInfo.mockRejectedValue(failure);
    vi.mocked(listErrorMessage).mockReturnValue("read went wrong");

    const loaded = await loadListInfo(api, client, "F0LIST123");

    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(listErrorMessage).toHaveBeenCalledWith("read", failure);
    expect(loaded.error.isError).toBe(true);
    expect(parseToolResult(loaded.error).error).toBe("read went wrong");
  });
});
