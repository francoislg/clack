import { describe, it, expect, vi } from "vitest";
import { createRememberTool } from "./remember.js";
import type { MemoryEntry } from "../../memoryRegistry.js";

interface ToolResult {
  content: { type: string; text?: string }[];
}

async function invoke<A>(
  tool: { handler: (args: A, extra?: never) => Promise<ToolResult> },
  args: A,
): Promise<ToolResult> {
  return tool.handler(args);
}

describe("remember tool", () => {
  it("calls rememberCore with the args and reports id + updatedAt", async () => {
    const entry: MemoryEntry = {
      id: "note:a",
      what: "a",
      why: "b",
      references: [],
      linkedMemories: [],
      createdAt: "t0",
      updatedAt: "t1",
    };
    const rememberCore = vi.fn(async () => entry);
    const result = await invoke(createRememberTool({ rememberCore }), {
      id: "note:a",
      what: "a",
      why: "b",
      staleAfter: undefined,
      nextSteps: undefined,
      references: undefined,
      linkedMemories: undefined,
    });
    expect(rememberCore).toHaveBeenCalledWith(
      expect.objectContaining({ id: "note:a", what: "a", why: "b" }),
    );
    expect(JSON.parse(result.content[0].text ?? "{}")).toEqual({
      ok: true,
      id: "note:a",
      updatedAt: "t1",
    });
  });

  it("forwards linkedMemories to rememberCore", async () => {
    const entry: MemoryEntry = {
      id: "note:a",
      what: "a",
      why: "b",
      references: [],
      linkedMemories: [{ id: "sentry:1", reason: "root cause of" }],
      createdAt: "t0",
      updatedAt: "t1",
    };
    const rememberCore = vi.fn(async () => entry);
    await invoke(createRememberTool({ rememberCore }), {
      id: "note:a",
      what: "a",
      why: "b",
      staleAfter: undefined,
      nextSteps: undefined,
      references: undefined,
      linkedMemories: [{ id: "sentry:1", reason: "root cause of" }],
    });
    expect(rememberCore).toHaveBeenCalledWith(
      expect.objectContaining({
        linkedMemories: [{ id: "sentry:1", reason: "root cause of" }],
      }),
    );
  });
});
