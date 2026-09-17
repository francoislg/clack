import { describe, it, expect, vi, beforeEach } from "vitest";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { createViewSlackFileTool } from "./viewSlackFile.js";
import { getCachedFilePath, readCachedFileBuffer, cacheFile } from "../../slack/fileCache.js";
import { downloadSlackFile } from "./viewSlackImage.js";
import { toolResultText } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import type { SlackFile } from "../../slack/slackFileBase.js";

vi.mock("../../slack/fileCache.js", () => ({
  getCachedFilePath: vi.fn(),
  readCachedFileBuffer: vi.fn(),
  cacheFile: vi.fn(),
}));

vi.mock("./viewSlackImage.js", () => ({
  downloadSlackFile: vi.fn(),
}));

function makeContext(files: Map<string, SlackFile>): QueryToolContext {
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
    availableFiles: files,
  };
}

function makeFile(overrides: Partial<SlackFile> = {}): SlackFile {
  return {
    id: "F1",
    name: "report.pdf",
    mimetype: "application/pdf",
    size: 100,
    url_private: "https://example.com/report.pdf",
    ...overrides,
  };
}

/**
 * Every branch must satisfy MCP's `CallToolResult` shape. A block the union does
 * not cover (e.g. an Anthropic-API `document` block) is rejected by the MCP
 * server before Claude ever sees it, surfacing as `-32602 Invalid tools/call
 * result` rather than as a tool error.
 */
async function callTool(files: Map<string, SlackFile>, fileId: string) {
  const tool = createViewSlackFileTool(makeContext(files));
  const result = await tool.handler({ file_id: fileId }, {});
  const parsed = CallToolResultSchema.safeParse(result);
  expect(parsed.error?.message ?? "valid").toBe("valid");
  return result;
}

describe("createViewSlackFileTool", () => {
  let files: Map<string, SlackFile>;

  beforeEach(() => {
    // `restoreMocks` does not clear call history on factory-created `vi.fn()`s.
    vi.clearAllMocks();
    files = new Map<string, SlackFile>([["F1", makeFile()]]);
    vi.mocked(getCachedFilePath).mockResolvedValue(null);
    vi.mocked(readCachedFileBuffer).mockResolvedValue(null);
    vi.mocked(cacheFile).mockResolvedValue("/app/data/cache/files/F1.pdf");
    vi.mocked(downloadSlackFile).mockResolvedValue(Buffer.from("%PDF-1.7 binary"));
  });

  it("creates a tool with correct name", () => {
    const tool = createViewSlackFileTool(makeContext(files));
    expect(tool.name).toBe("view_slack_file");
    expect(tool.description).toContain("file");
  });

  it("returns error for unknown file_id", async () => {
    const result = await callTool(files, "NONEXISTENT");
    expect(result.isError).toBe(true);
    expect(toolResultText(result)).toContain("Unknown file_id");
    expect(toolResultText(result)).toContain("F1");
  });

  it("returns the cached path for a PDF without downloading it", async () => {
    vi.mocked(getCachedFilePath).mockResolvedValue("/app/data/cache/files/F1.pdf");

    const result = await callTool(files, "F1");

    expect(getCachedFilePath).toHaveBeenCalledWith("F1");
    expect(downloadSlackFile).not.toHaveBeenCalled();
    expect(toolResultText(result)).toContain("/app/data/cache/files/F1.pdf");
    expect(toolResultText(result)).toContain("Read");
  });

  it("downloads, caches, and returns the cached path for an uncached PDF", async () => {
    vi.mocked(cacheFile).mockResolvedValue("/app/data/cache/files/downloaded.pdf");

    const result = await callTool(files, "F1");

    expect(downloadSlackFile).toHaveBeenCalledWith(
      "https://example.com/report.pdf",
      "xoxb-test-token",
    );
    expect(cacheFile).toHaveBeenCalledWith("F1", Buffer.from("%PDF-1.7 binary"), {
      mimeType: "application/pdf",
      originalName: "report.pdf",
    });
    expect(toolResultText(result)).toContain("/app/data/cache/files/downloaded.pdf");
  });

  it("never returns raw PDF bytes, only a path", async () => {
    vi.mocked(getCachedFilePath).mockResolvedValue("/app/data/cache/files/F1.pdf");

    const result = await callTool(files, "F1");

    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect(toolResultText(result)).not.toContain("%PDF");
  });

  it("returns an error result when the download fails", async () => {
    vi.mocked(downloadSlackFile).mockRejectedValue(new Error("403 Forbidden"));

    const result = await callTool(files, "F1");

    expect(result.isError).toBe(true);
    expect(toolResultText(result)).toContain("403 Forbidden");
  });

  it("tells Claude a download failure is unlikely to resolve on retry", async () => {
    vi.mocked(downloadSlackFile).mockRejectedValue(new Error("403 Forbidden"));

    const result = await callTool(files, "F1");

    expect(toolResultText(result)).toContain("does not resolve on retry");
    expect(toolResultText(result)).toContain("report.pdf");
  });

  it("returns text-tier files inline rather than as a path", async () => {
    files = new Map<string, SlackFile>([
      ["F1", makeFile({ name: "notes.txt", mimetype: "text/plain" })],
    ]);
    vi.mocked(downloadSlackFile).mockResolvedValue(Buffer.from("hello from the file"));

    const result = await callTool(files, "F1");

    expect(toolResultText(result)).toContain("notes.txt");
    expect(toolResultText(result)).toContain("hello from the file");
  });

  it("returns metadata-only text for unsupported binary formats", async () => {
    files = new Map<string, SlackFile>([
      ["F1", makeFile({ name: "archive.zip", mimetype: "application/zip", size: 4096 })],
    ]);

    const result = await callTool(files, "F1");

    expect(toolResultText(result)).toContain("archive.zip");
    expect(toolResultText(result)).toContain("application/zip");
    expect(toolResultText(result)).toContain("cannot be opened");
    expect(downloadSlackFile).not.toHaveBeenCalled();
  });

  it("tells Claude not to infer the contents of an unsupported format", async () => {
    files = new Map<string, SlackFile>([
      ["F1", makeFile({ name: "spec.docx", mimetype: "application/msword" })],
    ]);

    const result = await callTool(files, "F1");

    expect(toolResultText(result)).toContain("Do not infer or describe its contents");
  });

  it("refuses an oversized file without downloading it", async () => {
    files = new Map<string, SlackFile>([
      [
        "F1",
        makeFile({
          name: "demo.mov",
          mimetype: "video/quicktime",
          size: 25 * 1024 * 1024,
          unavailable: "too_large",
        }),
      ],
    ]);

    const result = await callTool(files, "F1");

    expect(downloadSlackFile).not.toHaveBeenCalled();
    expect(toolResultText(result)).toContain("demo.mov");
    expect(toolResultText(result)).toContain("too large");
    expect(toolResultText(result)).toContain("Do not infer");
  });

  it("returns metadata with formatted size for unsupported files", async () => {
    files = new Map<string, SlackFile>([
      [
        "F1",
        makeFile({
          name: "big.xlsx",
          mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          size: 2.5 * 1024 * 1024,
        }),
      ],
    ]);

    const result = await callTool(files, "F1");

    expect(toolResultText(result)).toContain("2.5 MB");
  });

  it("works with empty availableFiles map", () => {
    const tool = createViewSlackFileTool(makeContext(new Map()));
    expect(tool.name).toBe("view_slack_file");
  });
});
