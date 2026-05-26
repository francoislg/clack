import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAddAutoRespondRuleTool } from "./addAutoRespondRule.js";
import type { QueryToolContext } from "../types.js";
import { clearAutoRespondCache, getRules } from "../../autoRespond.js";
import type { ResolveChannelResult } from "../../slack/channelResolver.js";

const originalCwd = process.cwd;

// Use the MCP SDK's actual handler return type so the SDK's content union (text + image
// variants) is accepted. Tests narrow to text content via `textAt`.
type ToolHandlerResult = Awaited<
  ReturnType<ReturnType<typeof createAddAutoRespondRuleTool>["handler"]>
>;

/** Narrow a content block to its `text` field; throws if the entry is not a text block. */
function textAt(result: ToolHandlerResult, index: number): string {
  const block = result.content[index];
  if (!block || !("text" in block) || typeof block.text !== "string") {
    throw new Error(`Expected text content at index ${index}`);
  }
  return block.text;
}

function buildCtx(overrides: Partial<QueryToolContext> = {}): QueryToolContext {
  return {
    mode: "query" as const,
    userId: "U123",
    role: "admin",
    config: {} as QueryToolContext["config"],
    session: { sessionId: "test" } as QueryToolContext["session"],
    slackClient: undefined,
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    ...overrides,
  } as QueryToolContext;
}

function resolverFor(
  map: Record<string, string>,
): (input: string) => Promise<ResolveChannelResult> {
  return async (input: string) => {
    const key = input.replace(/^#/, "");
    if (input.startsWith("C") && !input.startsWith("#")) {
      return { ok: true, channelId: input };
    }
    const id = map[key];
    if (!id) {
      return { ok: false, error: `Channel "${key}" not found` };
    }
    return { ok: true, channelId: id };
  };
}

type AddTool = ReturnType<typeof createAddAutoRespondRuleTool>;

function call(tool: AddTool, args: Parameters<AddTool["handler"]>[0]): Promise<ToolHandlerResult> {
  return tool.handler(args, { sessionId: "test" });
}

describe("add_auto_respond_rule tool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "aar-test-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearAutoRespondCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("resolves a channel name to an ID before persisting", async () => {
    const tool = createAddAutoRespondRuleTool(buildCtx(), {
      resolveChannel: resolverFor({ engineering: "C999" }),
    });
    const result = await call(tool, {
      channels: ["#engineering"],
      userFilters: undefined,
      keywords: undefined,
      extraContext: undefined,
      preAnalysisContext: undefined,
    });

    const parsed = JSON.parse(textAt(result, 0));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.channels, ["C999"]);
    const rules = await getRules();
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].channels, ["C999"]);
  });

  it("passes through channel IDs unchanged and resolves names in the same array", async () => {
    const tool = createAddAutoRespondRuleTool(buildCtx(), {
      resolveChannel: resolverFor({ ops: "C2" }),
    });
    const result = await call(tool, {
      channels: ["C0123ABCDEF", "#ops"],
      userFilters: undefined,
      keywords: undefined,
      extraContext: undefined,
      preAnalysisContext: undefined,
    });

    const parsed = JSON.parse(textAt(result, 0));
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.channels, ["C0123ABCDEF", "C2"]);
  });

  it("returns an error and does not persist when channel resolution fails", async () => {
    const tool = createAddAutoRespondRuleTool(buildCtx(), {
      resolveChannel: resolverFor({ exists: "C1" }),
    });
    const result = await call(tool, {
      channels: ["#exists", "#nonexistent"],
      userFilters: undefined,
      keywords: undefined,
      extraContext: undefined,
      preAnalysisContext: undefined,
    });

    assert.equal(result.isError, true);
    assert.match(textAt(result, 0), /nonexistent/);
    const rules = await getRules();
    assert.equal(rules.length, 0);
  });

  it("persists all optional fields when supplied", async () => {
    const tool = createAddAutoRespondRuleTool(buildCtx(), {
      resolveChannel: resolverFor({ x: "C1" }),
    });
    const result = await call(tool, {
      channels: ["#x"],
      userFilters: ["U1"],
      keywords: ["error"],
      extraContext: "ctx",
      preAnalysisContext: "pre",
    });

    assert.equal(result.isError, undefined);
    const rules = await getRules();
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].userFilters, ["U1"]);
    assert.deepEqual(rules[0].keywords, ["error"]);
    assert.equal(rules[0].extraContext, "ctx");
    assert.equal(rules[0].preAnalysisContext, "pre");
    assert.equal(rules[0].enabled, true);
  });

  it("returns an error when slackClient is absent (default resolver)", async () => {
    const tool = createAddAutoRespondRuleTool(buildCtx());
    const result = await call(tool, {
      channels: ["C1"],
      userFilters: undefined,
      keywords: undefined,
      extraContext: undefined,
      preAnalysisContext: undefined,
    });
    assert.equal(result.isError, true);
    assert.match(textAt(result, 0), /Slack connection/);
  });
});
