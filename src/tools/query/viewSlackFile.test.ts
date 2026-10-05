import { describe, it, expect, vi, beforeEach, type MockInstance } from "vitest";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { createViewSlackFileTool } from "./viewSlackFile.js";
import {
  getCachedFilePath,
  readCachedFileBase64,
  readCachedFileBuffer,
  cacheFile,
} from "../../slack/fileCache.js";
import { toolResultText } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import type { SlackFile, SlackImageFile } from "../../slack/slackFileBase.js";
import type { SlackFileRef, SlackRef } from "../../slack/slackRefs.js";
import { checkFileAccess, FILE_ACCESS_DENIED_MESSAGE } from "../../slack/requesterAccess.js";
import { createSlackClientMock, type MockSlackClient } from "../../slack/testSlackClient.js";
import { stub } from "../../testStubs.js";

// The requester access check is an outside dependency: stub the verdict and assert the wiring.
vi.mock("../../slack/requesterAccess.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../slack/requesterAccess.js")>();
  return { ...actual, checkFileAccess: vi.fn() };
});

vi.mock("../../slack/fileCache.js", () => ({
  getCachedFilePath: vi.fn(),
  readCachedFileBase64: vi.fn(),
  readCachedFileBuffer: vi.fn(),
  cacheFile: vi.fn(),
}));

/** A registry entry for an attached file, with the facts the resolver would carry. */
function refOf(file: SlackFile): SlackFileRef {
  const image = file.mimetype.startsWith("image/");
  return {
    type: "file",
    id: file.id,
    kind: image ? "image" : "file",
    label: image ? "Image" : file.mimetype,
    reader: "view_slack_file",
    mustOpen: image,
    fromCurrentMessage: true,
    name: file.name,
    facts: {
      name: file.name,
      mimetype: file.mimetype,
      size: file.size,
      urlPrivate: file.url_private,
    },
    ...(file.unavailable === "too_large" && { tooLarge: true }),
  };
}

function registryOf(
  files: Map<string, SlackFile>,
  images?: Map<string, SlackImageFile>,
): Map<string, SlackRef> {
  const registry = new Map<string, SlackRef>();
  for (const [id, file] of [...files, ...(images ?? [])]) registry.set(id, refOf(file));
  return registry;
}

function makeContext(
  files: Map<string, SlackFile>,
  images?: Map<string, SlackImageFile>,
): QueryToolContext {
  return makeRegistryContext(registryOf(files, images));
}

function makeRegistryContext(availableRefs: Map<string, SlackRef>): QueryToolContext {
  return {
    mode: "query",
    userId: "U123",
    role: "member",
    session: {} as QueryToolContext["session"],
    config: {
      slack: { botToken: "xoxb-test-token" },
    } as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    availableRefs,
  };
}

function makeFile(overrides: Partial<SlackFile> = {}): SlackFile {
  return {
    id: "F0FILE001",
    name: "report.pdf",
    mimetype: "application/pdf",
    size: 100,
    url_private: "https://files.slack.com/report.pdf",
    ...overrides,
  };
}

function makeImage(overrides: Partial<SlackImageFile> = {}): SlackImageFile {
  return makeFile({
    id: "F0IMAGE01",
    name: "shot.png",
    mimetype: "image/png",
    url_private: "https://files.slack.com/shot.png",
    ...overrides,
  });
}

/**
 * Every branch must satisfy MCP's `CallToolResult` shape. A block the union does
 * not cover (e.g. an Anthropic-API `document` block) is rejected by the MCP
 * server before Claude ever sees it, surfacing as `-32602 Invalid tools/call
 * result` rather than as a tool error.
 */
async function callTool(
  files: Map<string, SlackFile>,
  fileId: string,
  images?: Map<string, SlackImageFile>,
) {
  const tool = createViewSlackFileTool(makeContext(files, images));
  const result = await tool.handler({ file_id: fileId }, {});
  const parsed = CallToolResultSchema.safeParse(result);
  expect(parsed.error?.message ?? "valid").toBe("valid");
  return result;
}

describe("createViewSlackFileTool", () => {
  let files: Map<string, SlackFile>;
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    // `restoreMocks` does not clear call history on factory-created `vi.fn()`s.
    vi.clearAllMocks();
    files = new Map<string, SlackFile>([["F0FILE001", makeFile()]]);
    vi.mocked(getCachedFilePath).mockResolvedValue(null);
    vi.mocked(readCachedFileBase64).mockResolvedValue(null);
    vi.mocked(readCachedFileBuffer).mockResolvedValue(null);
    vi.mocked(cacheFile).mockResolvedValue("/app/data/cache/files/F1.pdf");
    fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("%PDF-1.7 binary", { status: 200 }));
  });

  it("creates a tool with correct name", () => {
    const tool = createViewSlackFileTool(makeContext(files));
    expect(tool.name).toBe("view_slack_file");
    expect(tool.description).toContain("file");
  });

  it("refuses a value that is no Slack reference without a Slack call", async () => {
    const result = await callTool(files, "NONEXISTENT");

    expect(result.isError).toBe(true);
    expect(toolResultText(result)).toContain("is not a Slack reference");
    expect(checkFileAccess).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("opens a registered file with no access check", async () => {
    vi.mocked(getCachedFilePath).mockResolvedValue("/app/data/cache/files/F1.pdf");

    await callTool(files, "F0FILE001");

    expect(checkFileAccess).not.toHaveBeenCalled();
  });

  describe("unregistered file", () => {
    let client: MockSlackClient;
    let registry: Map<string, SlackRef>;

    function run(fileId: string) {
      registry = new Map();
      client = createSlackClientMock();
      const ctx = { ...makeRegistryContext(registry), slackClient: client };
      return createViewSlackFileTool(ctx).handler({ file_id: fileId }, {});
    }

    it("resolves, registers and opens a file the requester can see", async () => {
      vi.mocked(checkFileAccess).mockResolvedValue({
        allowed: true,
        botAccess: "read",
        creator: "U1",
        facts: {
          name: "plan.pdf",
          mimetype: "application/pdf",
          size: 100,
          urlPrivate: "https://files.slack.com/plan.pdf",
        },
      });

      await run("F0PLAN001");

      expect(checkFileAccess).toHaveBeenCalledWith(
        expect.objectContaining({ client, userId: "U123" }),
        "F0PLAN001",
      );
      expect(registry.get("F0PLAN001")).toMatchObject({ kind: "document", name: "plan.pdf" });
      expect(fetchSpy).toHaveBeenCalledWith("https://files.slack.com/plan.pdf", expect.anything());
    });

    it("refuses a file the requester cannot see without downloading it", async () => {
      vi.mocked(checkFileAccess).mockResolvedValue({ allowed: false, reason: "no_evidence" });

      const result = await run("F0PLAN001");

      expect(result.isError).toBe(true);
      expect(toolResultText(result)).toContain(FILE_ACCESS_DENIED_MESSAGE);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("redirects a List to read_list without downloading it", async () => {
      vi.mocked(checkFileAccess).mockResolvedValue({
        allowed: true,
        botAccess: "read",
        creator: "U1",
        facts: { filetype: "list", prettyType: "List" },
      });
      registry = new Map();
      client = createSlackClientMock();
      const ctx = {
        ...makeRegistryContext(registry),
        slackClient: client,
        config: stub<QueryToolContext["config"]>({
          slack: { botToken: "xoxb-test-token" },
          lists: { mode: "read", writeRole: "dev" },
        }),
      };

      const result = await createViewSlackFileTool(ctx).handler({ file_id: "F0LIST001" }, {});

      expect(result.isError).toBe(true);
      expect(toolResultText(result)).toContain("is a Slack List: use read_list");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("returns the cached path for a PDF without downloading it", async () => {
    vi.mocked(getCachedFilePath).mockResolvedValue("/app/data/cache/files/F1.pdf");

    const result = await callTool(files, "F0FILE001");

    expect(getCachedFilePath).toHaveBeenCalledWith("F0FILE001");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(toolResultText(result)).toContain("/app/data/cache/files/F1.pdf");
    expect(toolResultText(result)).toContain("Read");
  });

  it("downloads, caches, and returns the cached path for an uncached PDF", async () => {
    vi.mocked(cacheFile).mockResolvedValue("/app/data/cache/files/downloaded.pdf");

    const result = await callTool(files, "F0FILE001");

    expect(fetchSpy).toHaveBeenCalledWith("https://files.slack.com/report.pdf", {
      headers: { Authorization: "Bearer xoxb-test-token" },
      redirect: "manual",
    });
    expect(cacheFile).toHaveBeenCalledWith("F0FILE001", Buffer.from("%PDF-1.7 binary"), {
      mimeType: "application/pdf",
      originalName: "report.pdf",
    });
    expect(toolResultText(result)).toContain("/app/data/cache/files/downloaded.pdf");
  });

  it("follows a redirect to a Slack file host with the Authorization header", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://files-edu.slack-edge.com/f" },
        }),
      )
      .mockResolvedValueOnce(new Response("%PDF-1.7 binary", { status: 200 }));

    await callTool(files, "F0FILE001");

    expect(fetchSpy).toHaveBeenLastCalledWith("https://files-edu.slack-edge.com/f", {
      headers: { Authorization: "Bearer xoxb-test-token" },
      redirect: "manual",
    });
  });

  it("follows a redirect to another host without the bot token", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://cdn.example.com/f" } }),
      )
      .mockResolvedValueOnce(new Response("%PDF-1.7 binary", { status: 200 }));

    await callTool(files, "F0FILE001");

    expect(fetchSpy).toHaveBeenLastCalledWith("https://cdn.example.com/f", {
      headers: {},
      redirect: "manual",
    });
  });

  it("resolves a relative redirect against the current URL", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/f/2" } }))
      .mockResolvedValueOnce(new Response("%PDF-1.7 binary", { status: 200 }));

    await callTool(files, "F0FILE001");

    expect(fetchSpy).toHaveBeenLastCalledWith("https://files.slack.com/f/2", {
      headers: { Authorization: "Bearer xoxb-test-token" },
      redirect: "manual",
    });
  });

  it("never returns raw PDF bytes, only a path", async () => {
    vi.mocked(getCachedFilePath).mockResolvedValue("/app/data/cache/files/F1.pdf");

    const result = await callTool(files, "F0FILE001");

    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect(toolResultText(result)).not.toContain("%PDF");
  });

  it("returns an error result when the download fails", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 403, statusText: "Forbidden" }));

    const result = await callTool(files, "F0FILE001");

    expect(result.isError).toBe(true);
    expect(toolResultText(result)).toContain("403 Forbidden");
  });

  it("tells Claude a download failure is unlikely to resolve on retry", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 403, statusText: "Forbidden" }));

    const result = await callTool(files, "F0FILE001");

    expect(toolResultText(result)).toContain("does not resolve on retry");
    expect(toolResultText(result)).toContain("report.pdf");
  });

  it("reports an HTML login page as a missing files:read scope", async () => {
    fetchSpy.mockResolvedValue(
      new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
    );

    const result = await callTool(files, "F0FILE001");

    expect(result.isError).toBe(true);
    expect(toolResultText(result)).toContain("files:read");
  });

  it("returns text-tier files inline rather than as a path", async () => {
    files = new Map<string, SlackFile>([
      ["F0FILE001", makeFile({ name: "notes.txt", mimetype: "text/plain" })],
    ]);
    fetchSpy.mockResolvedValue(new Response("hello from the file", { status: 200 }));

    const result = await callTool(files, "F0FILE001");

    expect(toolResultText(result)).toContain("notes.txt");
    expect(toolResultText(result)).toContain("hello from the file");
  });

  it("returns a cached text-tier file without downloading it", async () => {
    files = new Map<string, SlackFile>([
      ["F0FILE001", makeFile({ name: "notes.txt", mimetype: "text/plain" })],
    ]);
    vi.mocked(readCachedFileBuffer).mockResolvedValue({
      data: Buffer.from("cached text"),
      mimeType: "text/plain",
    });

    const result = await callTool(files, "F0FILE001");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(toolResultText(result)).toContain("cached text");
  });

  it("returns metadata-only text for unsupported binary formats", async () => {
    files = new Map<string, SlackFile>([
      ["F0FILE001", makeFile({ name: "archive.zip", mimetype: "application/zip", size: 4096 })],
    ]);

    const result = await callTool(files, "F0FILE001");

    expect(toolResultText(result)).toContain("archive.zip");
    expect(toolResultText(result)).toContain("application/zip");
    expect(toolResultText(result)).toContain("cannot be opened");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tells Claude not to infer the contents of an unsupported format", async () => {
    files = new Map<string, SlackFile>([
      ["F0FILE001", makeFile({ name: "spec.docx", mimetype: "application/msword" })],
    ]);

    const result = await callTool(files, "F0FILE001");

    expect(toolResultText(result)).toContain("Do not infer or describe its contents");
  });

  it("refuses an oversized file without downloading it", async () => {
    files = new Map<string, SlackFile>([
      [
        "F0FILE001",
        makeFile({
          name: "demo.mov",
          mimetype: "video/quicktime",
          size: 25 * 1024 * 1024,
          unavailable: "too_large",
        }),
      ],
    ]);

    const result = await callTool(files, "F0FILE001");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(toolResultText(result)).toContain("demo.mov");
    expect(toolResultText(result)).toContain("too large");
    expect(toolResultText(result)).toContain("Do not infer");
  });

  it("returns metadata with formatted size for unsupported files", async () => {
    files = new Map<string, SlackFile>([
      [
        "F0FILE001",
        makeFile({
          name: "big.xlsx",
          mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: 2.5 * 1024 * 1024,
        }),
      ],
    ]);

    const result = await callTool(files, "F0FILE001");

    expect(toolResultText(result)).toContain("2.5 MB");
  });

  it("works with an empty registry", () => {
    const tool = createViewSlackFileTool(makeContext(new Map()));
    expect(tool.name).toBe("view_slack_file");
  });

  it("refuses an inaccessible ref with the access-denied message and no download", async () => {
    const registry = new Map<string, SlackRef>([
      [
        "F0FILE009",
        {
          type: "file",
          id: "F0FILE009",
          kind: "file",
          label: "Slack file",
          reader: "view_slack_file",
          mustOpen: false,
          fromCurrentMessage: true,
          inaccessible: true,
        },
      ],
    ]);
    const tool = createViewSlackFileTool(makeRegistryContext(registry));

    const result = await tool.handler({ file_id: "F0FILE009" }, {});

    expect(result.isError).toBe(true);
    expect(toolResultText(result)).toContain(FILE_ACCESS_DENIED_MESSAGE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("downloads a text-resolved ref from its access-check facts", async () => {
    const registry = new Map<string, SlackRef>([
      [
        "F0FILE007",
        {
          type: "file",
          id: "F0FILE007",
          kind: "document",
          label: "PDF",
          reader: "view_slack_file",
          mustOpen: true,
          fromCurrentMessage: true,
          name: "plan.pdf",
          facts: {
            name: "plan.pdf",
            mimetype: "application/pdf",
            size: 100,
            urlPrivate: "https://files.slack.com/plan.pdf",
          },
        },
      ],
    ]);
    const tool = createViewSlackFileTool(makeRegistryContext(registry));

    await tool.handler({ file_id: "F0FILE007" }, {});

    expect(fetchSpy).toHaveBeenCalledWith("https://files.slack.com/plan.pdf", {
      headers: { Authorization: "Bearer xoxb-test-token" },
      redirect: "manual",
    });
  });

  describe("image tier", () => {
    let images: Map<string, SlackImageFile>;

    beforeEach(() => {
      images = new Map<string, SlackImageFile>([["F0IMAGE01", makeImage()]]);
    });

    it("returns a cached image as an image block without downloading it", async () => {
      vi.mocked(readCachedFileBase64).mockResolvedValue({
        data: "Y2FjaGVk",
        mimeType: "image/png",
      });

      const result = await callTool(new Map(), "F0IMAGE01", images);

      expect(readCachedFileBase64).toHaveBeenCalledWith("F0IMAGE01");
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(result.content).toEqual([{ type: "image", data: "Y2FjaGVk", mimeType: "image/png" }]);
    });

    it("downloads, caches, and returns an uncached image as an image block", async () => {
      fetchSpy.mockResolvedValue(new Response("png-bytes", { status: 200 }));
      vi.mocked(cacheFile).mockResolvedValue("/app/data/cache/files/I1.png");

      const result = await callTool(new Map(), "F0IMAGE01", images);

      expect(fetchSpy).toHaveBeenCalledWith("https://files.slack.com/shot.png", {
        headers: { Authorization: "Bearer xoxb-test-token" },
        redirect: "manual",
      });
      expect(cacheFile).toHaveBeenCalledWith("F0IMAGE01", Buffer.from("png-bytes"), {
        mimeType: "image/png",
        originalName: "shot.png",
      });
      expect(result.content).toEqual([
        {
          type: "image",
          data: Buffer.from("png-bytes").toString("base64"),
          mimeType: "image/png",
        },
      ]);
    });

    it("routes a registered image to the image tier by mimetype", async () => {
      vi.mocked(readCachedFileBase64).mockResolvedValue({
        data: "Y2FjaGVk",
        mimeType: "image/jpeg",
      });

      const result = await callTool(
        new Map([["F0IMAGE01", makeImage({ mimetype: "image/jpeg" })]]),
        "F0IMAGE01",
      );

      expect(result.content).toEqual([{ type: "image", data: "Y2FjaGVk", mimeType: "image/jpeg" }]);
    });

    it("refuses an oversized image without downloading it", async () => {
      images = new Map<string, SlackImageFile>([
        [
          "F0IMAGE01",
          makeImage({ name: "huge.png", size: 25 * 1024 * 1024, unavailable: "too_large" }),
        ],
      ]);

      const result = await callTool(new Map(), "F0IMAGE01", images);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(readCachedFileBase64).not.toHaveBeenCalled();
      expect(toolResultText(result)).toContain("huge.png");
      expect(toolResultText(result)).toContain("too large");
      expect(toolResultText(result)).toContain("Do not infer");
    });

    it("returns a descriptive error result when the image download fails", async () => {
      fetchSpy.mockRejectedValue(new Error("network down"));

      const result = await callTool(new Map(), "F0IMAGE01", images);

      expect(result.isError).toBe(true);
      expect(cacheFile).not.toHaveBeenCalled();
      expect(toolResultText(result)).toContain("shot.png");
      expect(toolResultText(result)).toContain("network down");
      expect(toolResultText(result)).toContain("does not resolve on retry");
    });
  });
});
