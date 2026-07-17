import { describe, it, expect, vi } from "vitest";
import { createRecallTool } from "./recall.js";
import type { MemorySearchResult } from "../../memoryRegistry.js";

interface ToolResult {
  content: { type: string; text?: string }[];
}

async function invoke<A>(
  tool: { handler: (args: A, extra?: never) => Promise<ToolResult> },
  args: A,
): Promise<ToolResult> {
  return tool.handler(args);
}

describe("recall tool", () => {
  it("passes search args through and returns the paginated result", async () => {
    const result: MemorySearchResult = { total: 3, limit: 1, offset: 2, entries: [] };
    const searchMemory = vi.fn(async () => result);
    const out = await invoke(createRecallTool({ searchMemory }), {
      query: "login",
      from: "2026-01-01T00:00:00.000Z",
      to: undefined,
      since_hours: undefined,
      limit: 1,
      offset: 2,
    });
    expect(searchMemory).toHaveBeenCalledWith(
      expect.objectContaining({ query: "login", limit: 1, offset: 2 }),
    );
    expect(JSON.parse(out.content[0].text ?? "{}")).toEqual(result);
  });

  it("computes `from` server-side when since_hours is given", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    try {
      const result: MemorySearchResult = { total: 0, limit: 20, offset: 0, entries: [] };
      const searchMemory = vi.fn(async () => result);
      await invoke(createRecallTool({ searchMemory }), {
        query: undefined,
        from: undefined,
        to: undefined,
        since_hours: 24,
        limit: undefined,
        offset: undefined,
      });
      expect(searchMemory).toHaveBeenCalledWith(
        expect.objectContaining({ from: "2026-07-16T12:00:00.000Z" }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("an explicit `from` wins over since_hours", async () => {
    const result: MemorySearchResult = { total: 0, limit: 20, offset: 0, entries: [] };
    const searchMemory = vi.fn(async () => result);
    await invoke(createRecallTool({ searchMemory }), {
      query: undefined,
      from: "2026-01-01T00:00:00.000Z",
      to: undefined,
      since_hours: 24,
      limit: undefined,
      offset: undefined,
    });
    expect(searchMemory).toHaveBeenCalledWith(
      expect.objectContaining({ from: "2026-01-01T00:00:00.000Z" }),
    );
  });

  it("surfaces the archive enrichment on linked memories in the tool output", async () => {
    const result: MemorySearchResult = {
      total: 1,
      limit: 20,
      offset: 0,
      entries: [
        {
          id: "note:a",
          what: "a",
          why: "b",
          references: [],
          linkedMemories: [
            { id: "sentry:1", reason: "tracked", archived: { summary: "crash", outcome: "done" } },
          ],
          createdAt: "t0",
          updatedAt: "t1",
        },
      ],
    };
    const searchMemory = vi.fn(async () => result);
    const out = await invoke(createRecallTool({ searchMemory }), {
      query: "tracked",
      from: undefined,
      to: undefined,
      since_hours: undefined,
      limit: undefined,
      offset: undefined,
    });
    // The tool serializes searchMemory's result unchanged, so the archive enrichment round-trips.
    expect(JSON.parse(out.content[0].text ?? "{}")).toEqual(result);
  });
});
