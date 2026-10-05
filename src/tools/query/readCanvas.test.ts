import { describe, it, expect, vi, beforeEach } from "vitest";
import { createReadCanvasTool, MAX_CANVAS_CHARS } from "./readCanvas.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import { checkFileAccess, FILE_ACCESS_DENIED_MESSAGE } from "../../slack/requesterAccess.js";
import { createCanvasApiMock, slackError, type MockCanvasApi } from "../../slack/testCanvasApi.js";
import { createSlackClientMock, type MockSlackClient } from "../../slack/testSlackClient.js";
import type { SlackRef } from "../../slack/slackRefs.js";

const CANVAS_FACTS = { filetype: "quip", prettyType: "Canvas" };

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
    config: { repositories: [], canvases: { mode: "read" } },
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    slackClient,
    availableRefs: new Map<string, SlackRef>(),
  });
  return ctx;
}

const extra = { sessionId: "s1" };

describe("read_canvas", () => {
  let client: MockSlackClient;
  let api: MockCanvasApi;
  let ctx: QueryToolContext;

  beforeEach(() => {
    client = createSlackClientMock();
    api = createCanvasApiMock();
    api.getCanvasMarkdown.mockResolvedValue("# Title\n\nBody");
    ctx = makeCtx(client);
    vi.mocked(checkFileAccess).mockReset();
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "read",
      creator: "U1",
      facts: CANVAS_FACTS,
    });
  });

  it("returns the canvas markdown for a canvas id", async () => {
    const result = await createReadCanvasTool(ctx, api).handler({ canvas: "F0456ABC" }, extra);

    expect(result.isError).not.toBe(true);
    expect(api.getCanvasMarkdown).toHaveBeenCalledWith(client, "F0456ABC");
    expect(parseToolResult(result)).toEqual({
      canvas_id: "F0456ABC",
      markdown: "# Title\n\nBody",
    });
  });

  it("resolves a Slack canvas URL to its canvas id", async () => {
    const result = await createReadCanvasTool(ctx, api).handler(
      { canvas: "https://acme.slack.com/docs/T0123/F0456ABC" },
      extra,
    );

    expect(vi.mocked(checkFileAccess).mock.calls[0][1]).toBe("F0456ABC");
    expect(api.getCanvasMarkdown).toHaveBeenCalledWith(client, "F0456ABC");
    expect(parseToolResult(result).canvas_id).toBe("F0456ABC");
  });

  it("redirects a message permalink to fetch_slack_message without calling Slack", async () => {
    const result = await createReadCanvasTool(ctx, api).handler(
      { canvas: "https://acme.slack.com/archives/C123/p1700000000000100" },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toMatch(/is a Slack message: use fetch_slack_message/);
    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(api.getCanvasMarkdown).not.toHaveBeenCalled();
  });

  it("refuses a value that is no Slack reference without calling Slack", async () => {
    const result = await createReadCanvasTool(ctx, api).handler({ canvas: "hello" }, extra);

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toMatch(/is not a Slack reference/);
    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(api.getCanvasMarkdown).not.toHaveBeenCalled();
  });

  it("redirects an image to view_slack_file without a canvas call", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "read",
      creator: "U1",
      facts: { mimetype: "image/png" },
    });

    const result = await createReadCanvasTool(ctx, api).handler({ canvas: "F0IMAGE01" }, extra);

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe('"F0IMAGE01" is an Image: use view_slack_file');
    expect(api.getCanvasMarkdown).not.toHaveBeenCalled();
  });

  it("still checks access on a registered canvas before reading it", async () => {
    ctx.availableRefs?.set("F0456ABC", {
      type: "file",
      id: "F0456ABC",
      kind: "canvas",
      label: "Canvas",
      reader: "read_canvas",
      mustOpen: false,
      fromCurrentMessage: true,
    });
    vi.mocked(checkFileAccess).mockResolvedValue({ allowed: false, reason: "no_evidence" });

    const result = await createReadCanvasTool(ctx, api).handler({ canvas: "F0456ABC" }, extra);

    expect(checkFileAccess).toHaveBeenCalledTimes(1);
    expect(parseToolResult(result).error).toBe(FILE_ACCESS_DENIED_MESSAGE);
    expect(api.getCanvasMarkdown).not.toHaveBeenCalled();
  });

  it("registers an unregistered canvas it reads", async () => {
    const result = await createReadCanvasTool(ctx, api).handler({ canvas: "F0456ABC" }, extra);

    expect(result.isError).not.toBe(true);
    expect(ctx.availableRefs?.get("F0456ABC")).toMatchObject({
      kind: "canvas",
      reader: "read_canvas",
      fromCurrentMessage: false,
    });
  });

  it("refuses a canvas the requester cannot see, without reading it", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({ allowed: false, reason: "no_evidence" });

    const result = await createReadCanvasTool(ctx, api).handler({ canvas: "F0456ABC" }, extra);

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe(FILE_ACCESS_DENIED_MESSAGE);
    expect(api.getCanvasMarkdown).not.toHaveBeenCalled();
  });

  it("checks access with the context's client, requester and session", async () => {
    await createReadCanvasTool(ctx, api).handler({ canvas: "F0456ABC" }, extra);

    expect(checkFileAccess).toHaveBeenCalledTimes(1);
    const [req, fileId] = vi.mocked(checkFileAccess).mock.calls[0];
    expect(req.client).toBe(ctx.slackClient);
    expect(req.userId).toBe("U1");
    expect(req.role).toBe("member");
    expect(req.session).toBe(ctx.session);
    expect(fileId).toBe("F0456ABC");
  });

  it("truncates a canvas longer than the cap and says so", async () => {
    api.getCanvasMarkdown.mockResolvedValue("a".repeat(150_000));

    const parsed = parseToolResult(
      await createReadCanvasTool(ctx, api).handler({ canvas: "F0456ABC" }, extra),
    );

    expect(parsed.markdown).toHaveLength(MAX_CANVAS_CHARS);
    expect(parsed.truncated).toBe(true);
    expect(parsed.note).toBe("Canvas truncated to the first 100000 characters of 150000.");
  });

  it("returns a canvas of exactly the cap untruncated", async () => {
    api.getCanvasMarkdown.mockResolvedValue("a".repeat(MAX_CANVAS_CHARS));

    const parsed = parseToolResult(
      await createReadCanvasTool(ctx, api).handler({ canvas: "F0456ABC" }, extra),
    );

    expect(parsed.markdown).toHaveLength(MAX_CANVAS_CHARS);
    expect(parsed).not.toHaveProperty("truncated");
    expect(parsed).not.toHaveProperty("note");
  });

  it("names the manifest re-upload and reinstall on a missing scope", async () => {
    api.getCanvasMarkdown.mockRejectedValue(slackError("missing_scope"));

    const result = await createReadCanvasTool(ctx, api).handler({ canvas: "F0456ABC" }, extra);

    expect(result.isError).toBe(true);
    const { error } = parseToolResult(result);
    expect(error).toMatch(/re-upload the app manifest/);
    expect(error).toMatch(/reinstall/);
  });

  it("errors when no Slack client is available", async () => {
    const result = await createReadCanvasTool(makeCtx(undefined), api).handler(
      { canvas: "F0456ABC" },
      extra,
    );

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toMatch(/Slack client is not available/);
    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(api.getCanvasMarkdown).not.toHaveBeenCalled();
  });
});
