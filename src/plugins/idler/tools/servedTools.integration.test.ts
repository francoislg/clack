import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createTestClackSdk } from "../../../plugins-sdk/testHelpers.js";
import type { ClackSdk } from "../../../plugins-sdk/sdk.js";
import { en as idlerEn, fr as idlerFr } from "../i18n/strings.js";
import { createListTopIdeasTool, createReprioritizeTool, createUpsertIdeaTool } from "./ideas.js";
import {
  createClearActivityTool,
  createReadActivityTool,
  createRecordActivityTool,
} from "./activity.js";
import { createRecordFireOutcomeTool } from "./fireOutcome.js";

// Drives the real Agent SDK MCP server end to end: a tool's zod schema is converted for
// `tools/list` by the MCP layer, not by our zod copy, and a shape that converter chokes on
// throws there — taking down the WHOLE server's listing, so every tool on it reads to Claude
// as "No such tool available". Only a served `tools/list` proves the always-on tools are
// reachable; `z.record` is one such shape.

type ServerTools = NonNullable<Parameters<typeof createSdkMcpServer>[0]["tools"]>;

async function servedToolNames(tools: ServerTools | ServerTools[number]): Promise<string[]> {
  const server = createSdkMcpServer({
    name: "idler",
    version: "1.0.0",
    tools: Array.isArray(tools) ? tools : [tools],
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.instance.connect(serverTransport);
  const client = new Client({ name: "served-tools-test", version: "1.0.0" });
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    return listed.tools.map((t) => t.name).sort();
  } finally {
    await client.close();
  }
}

describe("idler always-on MCP server", () => {
  let tempDir: string;
  let sdk: ClackSdk;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "idler-served-"));
    const created = createTestClackSdk("idler", tempDir);
    sdk = created.sdk;
    sdk.registerDictionary({ en: idlerEn, fr: idlerFr });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("serves every always-on tool over tools/list", async () => {
    const tools = [
      createListTopIdeasTool(sdk),
      createUpsertIdeaTool(sdk),
      createReprioritizeTool(sdk),
      createRecordActivityTool(sdk),
      createRecordFireOutcomeTool(sdk),
      createReadActivityTool(sdk),
      createClearActivityTool(sdk),
    ];
    assert.deepEqual(await servedToolNames(tools), [
      "clear_activity",
      "list_top_ideas",
      "read_activity",
      "record_activity",
      "record_fire_outcome",
      "reprioritize_idea",
      "upsert_idea",
    ]);
  });

  // Served alone, so a single unconvertible schema names itself instead of failing the batch.
  it("serves upsert_idea's schema, whose cursors field is the shape that broke the listing", async () => {
    assert.deepEqual(await servedToolNames(createUpsertIdeaTool(sdk)), ["upsert_idea"]);
  });
});
