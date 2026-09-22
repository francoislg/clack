import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { findUnlistableToolServers } from "./servedToolsCheck.js";

// Drives the real Agent SDK MCP server: the listing the check performs is the SDK's own
// conversion, so a shape that converter can't handle must surface as a failure here.

function serverWith(name: string, shape: z.ZodRawShape) {
  return {
    name,
    server: createSdkMcpServer({
      name,
      version: "1.0.0",
      tools: [tool("probe", "", shape, async () => ({ content: [] }))],
    }),
  };
}

describe("findUnlistableToolServers over the real SDK server", () => {
  it("flags a server whose tool schema breaks tools/list and passes a healthy one", async () => {
    const failures = await findUnlistableToolServers([
      serverWith("healthy", { id: z.string() }),
      serverWith("broken", { byKey: z.record(z.string(), z.string()) }),
    ]);

    assert.deepEqual(
      failures.map((f) => f.name),
      ["broken"],
    );
    assert.match(failures[0].error, /Cannot read properties of undefined/);
  });
});
