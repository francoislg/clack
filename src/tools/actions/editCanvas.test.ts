import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEditCanvasTool, planCanvasEdit, type CanvasEditArgs } from "./editCanvas.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import { checkFileAccess, FILE_ACCESS_DENIED_MESSAGE } from "../../slack/requesterAccess.js";
import { getBotUserId } from "../../slack/botIdentity.js";
import { createCanvasApiMock, slackError, type MockCanvasApi } from "../../slack/testCanvasApi.js";
import { createSlackClientMock } from "../../slack/testSlackClient.js";
import { stub } from "../../testStubs.js";

// The requester access check is an outside dependency: stub the verdict and assert the wiring.
vi.mock("../../slack/requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../slack/requesterAccess.js")>();
  return { ...actual, checkFileAccess: vi.fn() };
});
vi.mock("../../slack/botIdentity.js");

const CANVAS_ID = "F0456ABC";
const REMOVE = "delete";

function makeContext(slackClient: QueryToolContext["slackClient"]): QueryToolContext {
  return {
    mode: "query",
    userId: "U_REQ",
    role: "member",
    session: stub<QueryToolContext["session"]>({
      sessionId: "test-session",
      channelId: "C_DEFAULT",
      threadTs: "1234567890.000001",
    }),
    config: stub<QueryToolContext["config"]>({}),
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    slackClient,
  };
}

describe("planCanvasEdit", () => {
  it.each<[CanvasEditArgs, ReturnType<typeof planCanvasEdit>]>([
    [
      { operation: "insert_after", anchor_text: "Goals", markdown: "new" },
      {
        ok: true,
        plan: { kind: "anchored", operation: "insert_after", anchorText: "Goals", markdown: "new" },
      },
    ],
    [
      { operation: "insert_before", anchor_text: "Goals", markdown: "new" },
      {
        ok: true,
        plan: {
          kind: "anchored",
          operation: "insert_before",
          anchorText: "Goals",
          markdown: "new",
        },
      },
    ],
    [
      { operation: "replace", anchor_text: "Goals", markdown: "new" },
      {
        ok: true,
        plan: { kind: "anchored", operation: "replace", anchorText: "Goals", markdown: "new" },
      },
    ],
    [
      { operation: "replace", markdown: "new" },
      { ok: true, plan: { kind: "whole-replace", markdown: "new" } },
    ],
    [
      { operation: "replace", anchor_text: "   ", markdown: "new" },
      { ok: true, plan: { kind: "whole-replace", markdown: "new" } },
    ],
    [
      { operation: REMOVE, anchor_text: "Goals" },
      { ok: true, plan: { kind: "anchored-delete", anchorText: "Goals" } },
    ],
    [
      { operation: "insert_at_start", markdown: "new" },
      { ok: true, plan: { kind: "unanchored", operation: "insert_at_start", markdown: "new" } },
    ],
    [
      { operation: "insert_at_end", markdown: "new" },
      { ok: true, plan: { kind: "unanchored", operation: "insert_at_end", markdown: "new" } },
    ],
    [
      { operation: "rename", title: "Roadmap" },
      { ok: true, plan: { kind: "rename", title: "Roadmap" } },
    ],
  ])("plans %j", (args, expected) => {
    expect(planCanvasEdit(args)).toEqual(expected);
  });

  it.each<[CanvasEditArgs, string]>([
    [
      { operation: "insert_after", markdown: "new" },
      "insert_after needs anchor_text and markdown.",
    ],
    [
      { operation: "insert_after", anchor_text: "Goals" },
      "insert_after needs anchor_text and markdown.",
    ],
    [
      { operation: "insert_before", anchor_text: "Goals", markdown: "  " },
      "insert_before needs anchor_text and markdown.",
    ],
    [
      { operation: "insert_after", anchor_text: "Goals", markdown: "new", title: "T" },
      "title is only for rename.",
    ],
    [
      { operation: "insert_before", anchor_text: "Goals", markdown: "new", title: "T" },
      "title is only for rename.",
    ],
    [{ operation: "replace", anchor_text: "Goals" }, "replace needs markdown."],
    [{ operation: "replace", markdown: "new", title: "T" }, "title is only for rename."],
    [{ operation: REMOVE }, `${REMOVE} needs anchor_text.`],
    [{ operation: REMOVE, anchor_text: "Goals", markdown: "new" }, `${REMOVE} takes no markdown.`],
    [{ operation: REMOVE, anchor_text: "Goals", title: "T" }, "title is only for rename."],
    [{ operation: "insert_at_start" }, "insert_at_start needs markdown."],
    [{ operation: "insert_at_end", markdown: "" }, "insert_at_end needs markdown."],
    [
      { operation: "insert_at_start", anchor_text: "Goals", markdown: "new" },
      "insert_at_start takes no anchor_text.",
    ],
    [
      { operation: "insert_at_end", anchor_text: "Goals", markdown: "new" },
      "insert_at_end takes no anchor_text.",
    ],
    [{ operation: "insert_at_end", markdown: "new", title: "T" }, "title is only for rename."],
    [{ operation: "rename" }, "rename needs title."],
    [{ operation: "rename", title: " " }, "rename needs title."],
    [{ operation: "rename", title: "T", anchor_text: "Goals" }, "rename takes only title."],
    [{ operation: "rename", title: "T", markdown: "new" }, "rename takes only title."],
  ])("refuses %j", (args, error) => {
    expect(planCanvasEdit(args)).toEqual({ ok: false, error });
  });
});

describe("edit_canvas", () => {
  let client: ReturnType<typeof createSlackClientMock>;
  let api: MockCanvasApi;
  let ctx: QueryToolContext;

  beforeEach(() => {
    vi.mocked(checkFileAccess).mockReset();
    vi.mocked(getBotUserId).mockReset();
    client = createSlackClientMock();
    api = createCanvasApiMock();
    api.findSections.mockResolvedValue(["S1"]);
    api.editCanvas.mockResolvedValue(undefined);
    ctx = makeContext(client);
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "write",
      creator: "U_HUMAN",
    });
    vi.mocked(getBotUserId).mockResolvedValue("U_BOT");
  });

  function run(args: { canvas?: string } & CanvasEditArgs) {
    return createEditCanvasTool(ctx, api).handler(
      { canvas: CANVAS_ID, anchor_text: undefined, markdown: undefined, title: undefined, ...args },
      {},
    );
  }

  it("is named edit_canvas", () => {
    expect(createEditCanvasTool(ctx, api).name).toBe("edit_canvas");
  });

  it("inserts after the one section matching the anchor", async () => {
    const result = await run({ operation: "insert_after", anchor_text: "Goals", markdown: "new" });

    expect(checkFileAccess).toHaveBeenCalledWith(
      { client, userId: "U_REQ", role: "member", session: ctx.session },
      CANVAS_ID,
    );
    expect(api.findSections).toHaveBeenCalledWith(client, CANVAS_ID, "Goals");
    expect(api.editCanvas).toHaveBeenCalledTimes(1);
    expect(api.editCanvas).toHaveBeenCalledWith(client, CANVAS_ID, {
      operation: "insert_after",
      sectionId: "S1",
      markdown: "new",
    });
    expect(result.isError).not.toBe(true);
    expect(parseToolResult(result)).toEqual({
      canvas_id: CANVAS_ID,
      operation: "insert_after",
      applied: true,
    });
  });

  it("replaces the matching section", async () => {
    await run({ operation: "replace", anchor_text: "Goals", markdown: "new" });

    expect(api.editCanvas).toHaveBeenCalledWith(client, CANVAS_ID, {
      operation: "replace",
      sectionId: "S1",
      markdown: "new",
    });
  });

  it("removes the matching section", async () => {
    await run({ operation: REMOVE, anchor_text: "Goals" });

    expect(api.findSections).toHaveBeenCalledWith(client, CANVAS_ID, "Goals");
    expect(api.editCanvas).toHaveBeenCalledWith(client, CANVAS_ID, {
      operation: REMOVE,
      sectionId: "S1",
    });
  });

  it.each(["insert_at_start", "insert_at_end"] as const)(
    "applies %s without looking up a section",
    async (operation) => {
      await run({ operation, markdown: "new" });

      expect(api.findSections).not.toHaveBeenCalled();
      expect(api.editCanvas).toHaveBeenCalledWith(client, CANVAS_ID, {
        operation,
        markdown: "new",
      });
    },
  );

  it("renames without looking up a section", async () => {
    await run({ operation: "rename", title: "Roadmap" });

    expect(api.findSections).not.toHaveBeenCalled();
    expect(api.editCanvas).toHaveBeenCalledWith(client, CANVAS_ID, {
      operation: "rename",
      title: "Roadmap",
    });
  });

  it("refuses an anchor that matches several sections", async () => {
    api.findSections.mockResolvedValue(["S1", "S2", "S3"]);

    const result = await run({ operation: "insert_after", anchor_text: "Goals", markdown: "new" });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toContain("3 sections");
    expect(api.editCanvas).not.toHaveBeenCalled();
  });

  it("refuses an anchor that matches no section", async () => {
    api.findSections.mockResolvedValue([]);

    const result = await run({ operation: REMOVE, anchor_text: "Goals" });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toContain("read_canvas");
    expect(api.editCanvas).not.toHaveBeenCalled();
  });

  it("refuses arguments that do not fit the operation before any Slack call", async () => {
    const result = await run({ operation: "insert_at_end", anchor_text: "Goals", markdown: "new" });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe("insert_at_end takes no anchor_text.");
    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(api.findSections).not.toHaveBeenCalled();
    expect(api.editCanvas).not.toHaveBeenCalled();
  });

  it("refuses a reference that is not a canvas", async () => {
    const result = await run({ canvas: "C0123456", operation: "rename", title: "Roadmap" });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toContain("Not a canvas reference");
    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(api.editCanvas).not.toHaveBeenCalled();
  });

  it("refuses when the requester has no access to the canvas", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({ allowed: false, reason: "no_evidence" });

    const result = await run({ operation: "insert_after", anchor_text: "Goals", markdown: "new" });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe(FILE_ACCESS_DENIED_MESSAGE);
    expect(api.findSections).not.toHaveBeenCalled();
    expect(api.editCanvas).not.toHaveBeenCalled();
  });

  it("refuses when Clack has read-only access", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "read",
      creator: "U_HUMAN",
    });

    const result = await run({ operation: "insert_after", anchor_text: "Goals", markdown: "new" });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toContain("read-only access");
    expect(api.findSections).not.toHaveBeenCalled();
    expect(api.editCanvas).not.toHaveBeenCalled();
  });

  it("proceeds when Clack's access level is unknown", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: undefined,
      creator: "U_HUMAN",
    });

    const result = await run({ operation: "insert_at_end", markdown: "new" });

    expect(result.isError).not.toBe(true);
    expect(api.editCanvas).toHaveBeenCalledTimes(1);
  });

  it("replaces a whole canvas Clack created", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "write",
      creator: "U_BOT",
    });

    const result = await run({ operation: "replace", markdown: "new" });

    expect(result.isError).not.toBe(true);
    expect(getBotUserId).toHaveBeenCalledWith(client);
    expect(api.findSections).not.toHaveBeenCalled();
    expect(api.editCanvas).toHaveBeenCalledWith(client, CANVAS_ID, {
      operation: "replace",
      markdown: "new",
    });
  });

  it.each([["U_HUMAN"], [undefined]])(
    "refuses a whole replace on a canvas created by %s",
    async (creator) => {
      vi.mocked(checkFileAccess).mockResolvedValue({ allowed: true, botAccess: "write", creator });

      const result = await run({ operation: "replace", markdown: "new" });

      expect(result.isError).toBe(true);
      expect(parseToolResult(result).error).toContain("only allowed on canvases Clack created");
      expect(api.editCanvas).not.toHaveBeenCalled();
    },
  );

  it("reports an error when the bot identity lookup fails during a whole replace", async () => {
    vi.mocked(checkFileAccess).mockResolvedValue({
      allowed: true,
      botAccess: "write",
      creator: "U_BOT",
    });
    vi.mocked(getBotUserId).mockRejectedValue(new Error("auth.test failed"));

    const result = await run({ operation: "replace", markdown: "new" });

    expect(result.isError).toBe(true);
    expect(api.editCanvas).not.toHaveBeenCalled();
  });

  it("acts on the canvas id from a Slack canvas URL", async () => {
    await run({
      canvas: "https://acme.slack.com/docs/T0123/F0456ABC",
      operation: "insert_after",
      anchor_text: "Goals",
      markdown: "new",
    });

    expect(checkFileAccess).toHaveBeenCalledWith(expect.anything(), "F0456ABC");
    expect(api.findSections).toHaveBeenCalledWith(client, "F0456ABC", "Goals");
    expect(api.editCanvas).toHaveBeenCalledWith(client, "F0456ABC", expect.anything());
  });

  it("reports a locked canvas when the edit is rejected", async () => {
    api.editCanvas.mockRejectedValue(slackError("canvas_editing_locked"));

    const result = await run({ operation: "insert_at_end", markdown: "new" });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toContain("locked");
  });

  it("reports the reinstall when the section lookup lacks a scope", async () => {
    api.findSections.mockRejectedValue(slackError("missing_scope"));

    const result = await run({ operation: "insert_after", anchor_text: "Goals", markdown: "new" });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toContain("reinstall");
    expect(api.editCanvas).not.toHaveBeenCalled();
  });

  it("refuses when no Slack client is available", async () => {
    ctx = makeContext(undefined);

    const result = await run({ operation: "rename", title: "Roadmap" });

    expect(result.isError).toBe(true);
    expect(parseToolResult(result).error).toBe("Slack client is not available in this context");
    expect(checkFileAccess).not.toHaveBeenCalled();
  });
});
