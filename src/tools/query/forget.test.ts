import { describe, it, expect, vi } from "vitest";
import { createForgetTool } from "./forget.js";

interface ToolResult {
  content: { type: string; text?: string }[];
}

async function invoke<A>(
  tool: { handler: (args: A, extra?: never) => Promise<ToolResult> },
  args: A,
): Promise<ToolResult> {
  return tool.handler(args);
}

describe("forget tool", () => {
  it("reports the deletion outcome from forgetMemory", async () => {
    const forgetMemory = vi.fn(async () => ({ deleted: false }));
    const out = await invoke(createForgetTool({ forgetMemory }), { id: "x" });
    expect(forgetMemory).toHaveBeenCalledWith("x");
    expect(JSON.parse(out.content[0].text ?? "{}")).toEqual({ id: "x", deleted: false });
  });
});
