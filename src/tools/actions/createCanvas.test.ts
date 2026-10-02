import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCreateCanvasTool } from "./createCanvas.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import { recordGrant } from "../../slack/requesterAccess.js";
import { createCanvasApiMock, slackError, type MockCanvasApi } from "../../slack/testCanvasApi.js";
import { createSlackClientMock, type MockSlackClient } from "../../slack/testSlackClient.js";

// Recording a session grant is an outside dependency: stub it and assert the wiring.
vi.mock("../../slack/requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../slack/requesterAccess.js")>();
  return { ...actual, recordGrant: vi.fn() };
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
const input = { title: "Plan", markdown: "# Plan\n\nBody" };
const PERMALINK = "https://acme.slack.com/docs/T0123/F0NEW123";

describe("create_canvas", () => {
  let client: MockSlackClient;
  let api: MockCanvasApi;
  let ctx: QueryToolContext;

  beforeEach(() => {
    client = createSlackClientMock();
    api = createCanvasApiMock();
    api.createCanvas.mockResolvedValue("F0NEW123");
    api.isDirectConversation.mockResolvedValue(false);
    api.shareCanvasWithChannel.mockResolvedValue(undefined);
    api.canvasPermalink.mockResolvedValue(PERMALINK);
    ctx = makeCtx(client);
    vi.mocked(recordGrant).mockReset();
    vi.mocked(recordGrant).mockResolvedValue(undefined);
  });

  it("creates the canvas, shares it with the session channel and records the grant", async () => {
    const result = await createCreateCanvasTool(ctx, api).handler(input, extra);

    expect(result.isError).not.toBe(true);
    expect(api.createCanvas).toHaveBeenCalledWith(client, input);
    expect(api.isDirectConversation).toHaveBeenCalledWith(client, "C1");
    expect(api.shareCanvasWithChannel).toHaveBeenCalledWith(client, "F0NEW123", "C1");
    expect(recordGrant).toHaveBeenCalledWith(
      { client, userId: "U1", role: "member", session: ctx.session },
      "F0NEW123",
    );
    expect(parseToolResult(result)).toEqual({
      canvas_id: "F0NEW123",
      permalink: PERMALINK,
      shared_with_channel: "C1",
    });
  });

  it("does not share the canvas in a DM", async () => {
    api.isDirectConversation.mockResolvedValue(true);

    const result = await createCreateCanvasTool(ctx, api).handler(input, extra);

    expect(api.shareCanvasWithChannel).not.toHaveBeenCalled();
    expect(recordGrant).toHaveBeenCalledWith(expect.anything(), "F0NEW123");
    expect(parseToolResult(result)).toEqual({ canvas_id: "F0NEW123", permalink: PERMALINK });
  });

  it("succeeds with a warning when sharing fails", async () => {
    api.shareCanvasWithChannel.mockRejectedValue(slackError("restricted_action"));

    const result = await createCreateCanvasTool(ctx, api).handler(input, extra);

    expect(result.isError).not.toBe(true);
    const parsed = parseToolResult(result);
    expect(parsed.canvas_id).toBe("F0NEW123");
    expect(parsed.permalink).toBe(PERMALINK);
    expect(typeof parsed.warning).toBe("string");
    expect(parsed).not.toHaveProperty("shared_with_channel");
    expect(recordGrant).toHaveBeenCalledWith(expect.anything(), "F0NEW123");
  });

  it("succeeds with a warning and no share when the conversation lookup fails", async () => {
    api.isDirectConversation.mockRejectedValue(new Error("boom"));

    const result = await createCreateCanvasTool(ctx, api).handler(input, extra);

    expect(result.isError).not.toBe(true);
    const parsed = parseToolResult(result);
    expect(parsed.canvas_id).toBe("F0NEW123");
    expect(typeof parsed.warning).toBe("string");
    expect(api.shareCanvasWithChannel).not.toHaveBeenCalled();
  });

  it("skips sharing when the session has no channel id", async () => {
    const result = await createCreateCanvasTool(makeCtx(client, ""), api).handler(input, extra);

    expect(api.isDirectConversation).not.toHaveBeenCalled();
    expect(api.shareCanvasWithChannel).not.toHaveBeenCalled();
    expect(parseToolResult(result)).toEqual({ canvas_id: "F0NEW123", permalink: PERMALINK });
  });

  it("names the paid plan when a free workspace cannot create a canvas", async () => {
    api.createCanvas.mockRejectedValue(slackError("free_teams_cannot_create_standalone_canvases"));

    const result = await createCreateCanvasTool(ctx, api).handler(input, extra);

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toMatch(/paid Slack plan/);
    expect(api.isDirectConversation).not.toHaveBeenCalled();
    expect(api.shareCanvasWithChannel).not.toHaveBeenCalled();
    expect(recordGrant).not.toHaveBeenCalled();
  });

  it("succeeds without a permalink when the permalink lookup fails", async () => {
    api.canvasPermalink.mockRejectedValue(new Error("boom"));

    const result = await createCreateCanvasTool(ctx, api).handler(input, extra);

    expect(result.isError).not.toBe(true);
    expect(parseToolResult(result)).toEqual({ canvas_id: "F0NEW123", shared_with_channel: "C1" });
  });

  it("errors when no Slack client is available", async () => {
    const result = await createCreateCanvasTool(makeCtx(undefined), api).handler(input, extra);

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toMatch(/Slack client is not available/);
    expect(api.createCanvas).not.toHaveBeenCalled();
  });
});
