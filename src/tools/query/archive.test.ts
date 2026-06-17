import { describe, it, expect, vi } from "vitest";
import { createArchiveTool } from "./archive.js";
import { createGetArchivedTool } from "./getArchived.js";
import { createPruneArchiveTool } from "./pruneArchive.js";

interface ToolResult {
  content: { type: string; text?: string }[];
}

async function invoke<A>(
  tool: { handler: (args: A, extra?: never) => Promise<ToolResult> },
  args: A,
): Promise<ToolResult> {
  return tool.handler(args);
}

function parse(out: ToolResult): unknown {
  return JSON.parse(out.content[0].text ?? "{}");
}

describe("archive tool", () => {
  it("calls archive with the lean note and reports the outcome", async () => {
    const archive = vi.fn(async () => ({ archived: true }));
    const out = await invoke(createArchiveTool({ archive }), {
      id: "sentry:1234",
      summary: "Login crash",
      outcome: "Fixed in PR #123",
      link: "https://x/123",
    });
    expect(archive).toHaveBeenCalledWith("sentry:1234", {
      summary: "Login crash",
      outcome: "Fixed in PR #123",
      link: "https://x/123",
    });
    expect(parse(out)).toEqual({ id: "sentry:1234", archived: true });
  });

  it("reports archived:false when the entry is missing or vetoed", async () => {
    const archive = vi.fn(async () => ({ archived: false }));
    const out = await invoke(createArchiveTool({ archive }), {
      id: "missing:1",
      summary: "x",
      outcome: "y",
      link: undefined,
    });
    expect(parse(out)).toEqual({ id: "missing:1", archived: false });
  });
});

describe("get_archived tool", () => {
  it("returns the record and found:true on a hit", async () => {
    const record = {
      id: "sentry:1234",
      summary: "s",
      outcome: "o",
      archivedAt: "2026-06-16T12:00:00.000Z",
    };
    const getArchived = vi.fn(async () => record);
    const out = await invoke(createGetArchivedTool({ getArchived }), { id: "sentry:1234" });
    expect(getArchived).toHaveBeenCalledWith("sentry:1234");
    expect(parse(out)).toEqual({ id: "sentry:1234", found: true, record });
  });

  it("returns found:false and null on a miss", async () => {
    const getArchived = vi.fn(async () => null);
    const out = await invoke(createGetArchivedTool({ getArchived }), { id: "sentry:9999" });
    expect(parse(out)).toEqual({ id: "sentry:9999", found: false, record: null });
  });
});

describe("prune_archive tool", () => {
  it("calls pruneArchive and reports the pruned ids", async () => {
    const pruneArchive = vi.fn(async () => ["old:1", "old:2"]);
    const out = await invoke(createPruneArchiveTool({ pruneArchive }), {});
    expect(pruneArchive).toHaveBeenCalled();
    expect(parse(out)).toEqual({ prunedCount: 2, pruned: ["old:1", "old:2"] });
  });
});
