import { beforeEach, describe, expect, it } from "vitest";
import {
  canvasErrorMessage,
  canvasPermalink,
  createCanvas,
  defaultCanvasApi,
  editCanvas,
  findSections,
  getCanvasMarkdown,
  parseCanvasRef,
  shareCanvasWithChannel,
} from "./canvases.js";
import { isDirectConversation } from "./fileRef.js";
import { slackError } from "./testCanvasApi.js";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";

const CANVAS_ID = "F0456ABC";

describe("parseCanvasRef", () => {
  it("accepts a bare canvas id", () => {
    expect(parseCanvasRef("F0456ABC")).toBe("F0456ABC");
  });

  it("trims surrounding whitespace", () => {
    expect(parseCanvasRef("  F0456ABC\n")).toBe("F0456ABC");
  });

  it("extracts the id from a /docs/<team>/<id> URL", () => {
    expect(parseCanvasRef("https://acme.slack.com/docs/T0123/F0456ABC")).toBe("F0456ABC");
  });

  it("extracts the id from a /canvas/<id> URL", () => {
    expect(parseCanvasRef("https://acme.slack.com/canvas/F0456ABC")).toBe("F0456ABC");
  });

  it("extracts the id from a URL with a query string", () => {
    expect(parseCanvasRef("https://acme.slack.com/docs/T0123/F0456ABC?focus_section_id=temp")).toBe(
      "F0456ABC",
    );
  });

  it("extracts the id from a URL with trailing segments", () => {
    expect(parseCanvasRef("https://acme.slack.com/canvas/F0456ABC/edit")).toBe("F0456ABC");
  });

  it("rejects a message permalink", () => {
    expect(
      parseCanvasRef("https://acme.slack.com/archives/C0123ABCD/p1700000000000100"),
    ).toBeUndefined();
  });

  it("rejects a non-slack host", () => {
    expect(parseCanvasRef("https://example.com/docs/T0123/F0456ABC")).toBeUndefined();
    expect(parseCanvasRef("https://notslack.com/canvas/F0456ABC")).toBeUndefined();
  });

  it("rejects an empty string", () => {
    expect(parseCanvasRef("")).toBeUndefined();
  });

  it("rejects a channel id", () => {
    expect(parseCanvasRef("C0456ABC")).toBeUndefined();
  });
});

describe("canvas API calls", () => {
  let client: MockSlackClient;

  beforeEach(() => {
    client = createSlackClientMock();
  });

  describe("getCanvasMarkdown", () => {
    it("requests markdown content and returns it", async () => {
      const contentResponse = { ok: true, content: "# Title" };
      client.apiCall.mockResolvedValue(contentResponse);

      await expect(getCanvasMarkdown(client, CANVAS_ID)).resolves.toBe("# Title");
      expect(client.apiCall).toHaveBeenCalledWith("canvases.getContent", {
        canvas_id: CANVAS_ID,
        content_type: "markdown",
      });
    });

    it("throws when the response has no content", async () => {
      client.apiCall.mockResolvedValue({ ok: true });

      await expect(getCanvasMarkdown(client, CANVAS_ID)).rejects.toThrow(
        "canvases.getContent returned no content",
      );
    });
  });

  describe("createCanvas", () => {
    it("creates a markdown canvas and returns its id", async () => {
      client.canvases.create.mockResolvedValue({ ok: true, canvas_id: CANVAS_ID });

      await expect(createCanvas(client, { title: "Notes", markdown: "hello" })).resolves.toBe(
        CANVAS_ID,
      );
      expect(client.canvases.create).toHaveBeenCalledWith({
        title: "Notes",
        document_content: { type: "markdown", markdown: "hello" },
      });
    });

    it("throws when the response has no canvas id", async () => {
      client.canvases.create.mockResolvedValue({ ok: true });

      await expect(createCanvas(client, { title: "Notes", markdown: "hello" })).rejects.toThrow(
        "canvases.create returned no canvas id",
      );
    });
  });

  describe("shareCanvasWithChannel", () => {
    it("grants the channel read access", async () => {
      client.canvases.access.set.mockResolvedValue({ ok: true });

      await expect(shareCanvasWithChannel(client, CANVAS_ID, "C123")).resolves.toBeUndefined();
      expect(client.canvases.access.set).toHaveBeenCalledWith({
        canvas_id: CANVAS_ID,
        access_level: "read",
        channel_ids: ["C123"],
      });
    });
  });

  describe("findSections", () => {
    it("looks sections up by text and returns their ids", async () => {
      client.canvases.sections.lookup.mockResolvedValue({
        ok: true,
        sections: [{ id: "temp:C:1" }, { id: "temp:C:2" }],
      });

      await expect(findSections(client, CANVAS_ID, "Roadmap")).resolves.toEqual([
        "temp:C:1",
        "temp:C:2",
      ]);
      expect(client.canvases.sections.lookup).toHaveBeenCalledWith({
        canvas_id: CANVAS_ID,
        criteria: { contains_text: "Roadmap" },
      });
    });

    it("returns an empty array when Slack returns no sections", async () => {
      client.canvases.sections.lookup.mockResolvedValue({ ok: true });

      await expect(findSections(client, CANVAS_ID, "Roadmap")).resolves.toEqual([]);
    });
  });

  describe("editCanvas", () => {
    const documentContent = { type: "markdown", markdown: "body" };

    it.each(["insert_after", "insert_before"] as const)(
      "sends %s with a section and content",
      async (operation) => {
        await editCanvas(client, CANVAS_ID, { operation, sectionId: "S1", markdown: "body" });

        expect(client.canvases.edit).toHaveBeenCalledWith({
          canvas_id: CANVAS_ID,
          changes: [{ operation, section_id: "S1", document_content: documentContent }],
        });
      },
    );

    it.each(["insert_at_start", "insert_at_end"] as const)(
      "sends %s with content only",
      async (operation) => {
        await editCanvas(client, CANVAS_ID, { operation, markdown: "body" });

        expect(client.canvases.edit).toHaveBeenCalledWith({
          canvas_id: CANVAS_ID,
          changes: [{ operation, document_content: documentContent }],
        });
      },
    );

    it("sends a section replace with its section id", async () => {
      await editCanvas(client, CANVAS_ID, {
        operation: "replace",
        sectionId: "S1",
        markdown: "body",
      });

      expect(client.canvases.edit).toHaveBeenCalledWith({
        canvas_id: CANVAS_ID,
        changes: [{ operation: "replace", section_id: "S1", document_content: documentContent }],
      });
    });

    it("sends a whole-document replace without a section id", async () => {
      await editCanvas(client, CANVAS_ID, { operation: "replace", markdown: "body" });

      expect(client.canvases.edit).toHaveBeenCalledWith({
        canvas_id: CANVAS_ID,
        changes: [{ operation: "replace", document_content: documentContent }],
      });
      const [args] = client.canvases.edit.mock.calls[0];
      expect(Object.keys(args.changes[0])).not.toContain("section_id");
    });

    it("removes a section by its id", async () => {
      await editCanvas(client, CANVAS_ID, { operation: "delete", sectionId: "S1" });

      expect(client.canvases.edit).toHaveBeenCalledWith({
        canvas_id: CANVAS_ID,
        changes: [{ operation: "delete", section_id: "S1" }],
      });
    });

    it("sends a rename through apiCall", async () => {
      await editCanvas(client, CANVAS_ID, { operation: "rename", title: "New title" });

      expect(client.apiCall).toHaveBeenCalledWith("canvases.edit", {
        canvas_id: CANVAS_ID,
        changes: [
          { operation: "rename", title_content: { type: "markdown", markdown: "New title" } },
        ],
      });
      expect(client.canvases.edit).not.toHaveBeenCalled();
    });
  });

  describe("canvasPermalink", () => {
    it("returns the file permalink", async () => {
      client.files.info.mockResolvedValue({
        ok: true,
        file: { permalink: "https://acme.slack.com/docs/T0123/F0456ABC" },
      });

      await expect(canvasPermalink(client, CANVAS_ID)).resolves.toBe(
        "https://acme.slack.com/docs/T0123/F0456ABC",
      );
      expect(client.files.info).toHaveBeenCalledWith({ file: CANVAS_ID });
    });

    it("returns undefined when the file has no permalink", async () => {
      client.files.info.mockResolvedValue({ ok: true, file: {} });

      await expect(canvasPermalink(client, CANVAS_ID)).resolves.toBeUndefined();
    });
  });
});

describe("canvasErrorMessage", () => {
  const missingScope = [
    "Slack rejected edit canvas: the app is missing a canvas scope.",
    "An admin must re-upload the app manifest and reinstall the app to the workspace.",
  ].join(" ");
  const paidPlan = "Slack rejected edit canvas: canvases need a paid Slack plan.";
  const notFound = [
    "Slack could not find that canvas (edit canvas).",
    "It may be deleted, not a canvas, or not shared with Clack.",
  ].join(" ");
  const notAllowed = [
    "Slack did not permit Clack to edit canvas the canvas.",
    "Reading or editing needs the canvas shared with a channel Clack is in (with edit access for edits);",
    "creating or sharing may be blocked by a workspace canvas restriction.",
  ].join(" ");

  it.each([
    ["missing_scope", missingScope],
    ["free_teams_cannot_create_standalone_canvases", paidPlan],
    ["free_teams_cannot_edit_standalone_canvases", paidPlan],
    ["free_team_canvas_tab_already_exists", paidPlan],
    ["canvas_not_found", notFound],
    ["canvas_deleted", notFound],
    ["file_not_found", notFound],
    ["access_denied", notAllowed],
    ["no_permission", notAllowed],
    ["restricted_action", notAllowed],
    ["canvas_editing_locked", "That canvas is locked for editing (edit canvas)."],
    ["canvas_too_large", "That canvas is too large (edit canvas)."],
    ["ratelimited", "Slack rate-limited edit canvas. Wait a minute before retrying."],
  ])("maps %s", (code, expected) => {
    expect(canvasErrorMessage("edit canvas", slackError(code))).toBe(expected);
  });

  it("names an unmapped code", () => {
    expect(canvasErrorMessage("edit canvas", slackError("internal_error"))).toBe(
      "Slack rejected edit canvas: internal_error.",
    );
  });

  it("falls back to the error message for a plain Error", () => {
    expect(canvasErrorMessage("edit canvas", new Error("socket hang up"))).toBe(
      "edit canvas failed: socket hang up",
    );
  });
});

describe("defaultCanvasApi", () => {
  it("bundles the canvas functions", () => {
    expect(defaultCanvasApi).toEqual({
      getCanvasMarkdown,
      createCanvas,
      shareCanvasWithChannel,
      isDirectConversation,
      findSections,
      editCanvas,
      canvasPermalink,
    });
  });
});
