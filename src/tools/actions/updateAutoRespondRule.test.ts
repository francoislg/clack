import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createUpdateAutoRespondRuleTool } from "./updateAutoRespondRule.js";
import type { QueryToolContext } from "../types.js";
import { addRule, clearAutoRespondCache, getRule } from "../../autoRespond.js";
import { seedEphemeralRule } from "../../ephemeralRules.js";
import type { ResolveChannelResult } from "../../slack/channelResolver.js";

const originalCwd = process.cwd;

type ToolHandlerResult = Awaited<
  ReturnType<ReturnType<typeof createUpdateAutoRespondRuleTool>["handler"]>
>;

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
    if (input.startsWith("C") && !input.startsWith("#")) {
      return { ok: true, channelId: input };
    }
    const key = input.replace(/^#/, "");
    const id = map[key];
    if (!id) {
      return { ok: false, error: `Channel "${key}" not found` };
    }
    return { ok: true, channelId: id };
  };
}

type UpdateTool = ReturnType<typeof createUpdateAutoRespondRuleTool>;

function call(
  tool: UpdateTool,
  args: Parameters<UpdateTool["handler"]>[0],
): Promise<ToolHandlerResult> {
  return tool.handler(args, { sessionId: "test" });
}

describe("update_auto_respond_rule tool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "uar-test-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearAutoRespondCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("partial patch preserves fields omitted from the patch", async () => {
    const rule = await addRule(["C1"], ["U1"], ["error"], "ctx", "pre");

    const tool = createUpdateAutoRespondRuleTool(buildCtx(), {
      resolveChannel: resolverFor({}),
    });
    const result = await call(tool, {
      id: rule.id,
      channels: undefined,
      userFilters: undefined,
      keywords: undefined,
      extraContext: "new ctx",
      preAnalysisContext: undefined,
      attentionLevel: undefined,
    });

    assert.equal(result.isError, undefined);
    const stored = await getRule(rule.id);
    assert.ok(stored);
    assert.deepEqual(stored.channels, ["C1"]);
    assert.deepEqual(stored.userFilters, ["U1"]);
    assert.deepEqual(stored.keywords, ["error"]);
    assert.equal(stored.extraContext, "new ctx");
    assert.equal(stored.preAnalysisContext, "pre");
  });

  it("empty string clears extraContext", async () => {
    const rule = await addRule(["C1"], undefined, undefined, "before");

    const tool = createUpdateAutoRespondRuleTool(buildCtx(), {
      resolveChannel: resolverFor({}),
    });
    await call(tool, {
      id: rule.id,
      channels: undefined,
      userFilters: undefined,
      keywords: undefined,
      extraContext: "",
      preAnalysisContext: undefined,
      attentionLevel: undefined,
    });

    const stored = await getRule(rule.id);
    assert.ok(stored);
    assert.equal(stored.extraContext, undefined);
  });

  it("empty array clears keywords", async () => {
    const rule = await addRule(["C1"], undefined, ["error", "crash"]);

    const tool = createUpdateAutoRespondRuleTool(buildCtx(), {
      resolveChannel: resolverFor({}),
    });
    await call(tool, {
      id: rule.id,
      channels: undefined,
      userFilters: undefined,
      keywords: [],
      extraContext: undefined,
      preAnalysisContext: undefined,
      attentionLevel: undefined,
    });

    const stored = await getRule(rule.id);
    assert.ok(stored);
    assert.equal(stored.keywords, undefined);
  });

  it("re-resolves channel names on update", async () => {
    const rule = await addRule(["C1"]);

    const tool = createUpdateAutoRespondRuleTool(buildCtx(), {
      resolveChannel: resolverFor({ ops: "C_OPS" }),
    });
    await call(tool, {
      id: rule.id,
      channels: ["#ops"],
      userFilters: undefined,
      keywords: undefined,
      extraContext: undefined,
      preAnalysisContext: undefined,
      attentionLevel: undefined,
    });

    const stored = await getRule(rule.id);
    assert.ok(stored);
    assert.deepEqual(stored.channels, ["C_OPS"]);
  });

  it("returns error and does not mutate when channel resolution fails", async () => {
    const rule = await addRule(["C1"], undefined, ["keep"]);

    const tool = createUpdateAutoRespondRuleTool(buildCtx(), {
      resolveChannel: resolverFor({}),
    });
    const result = await call(tool, {
      id: rule.id,
      channels: ["#nonexistent"],
      userFilters: undefined,
      keywords: undefined,
      extraContext: undefined,
      preAnalysisContext: undefined,
      attentionLevel: undefined,
    });

    assert.equal(result.isError, true);
    const stored = await getRule(rule.id);
    assert.ok(stored);
    assert.deepEqual(stored.channels, ["C1"]);
    assert.deepEqual(stored.keywords, ["keep"]);
  });

  it("returns error when channels is an empty array", async () => {
    const rule = await addRule(["C1"]);

    const tool = createUpdateAutoRespondRuleTool(buildCtx(), {
      resolveChannel: resolverFor({}),
    });
    const result = await call(tool, {
      id: rule.id,
      channels: [],
      userFilters: undefined,
      keywords: undefined,
      extraContext: undefined,
      preAnalysisContext: undefined,
      attentionLevel: undefined,
    });

    assert.equal(result.isError, true);
    assert.match(textAt(result, 0), /cannot be empty/);
  });

  it("returns error for unknown rule ID", async () => {
    const tool = createUpdateAutoRespondRuleTool(buildCtx(), {
      resolveChannel: resolverFor({}),
    });
    const result = await call(tool, {
      id: "nope",
      channels: undefined,
      userFilters: undefined,
      keywords: undefined,
      extraContext: "x",
      preAnalysisContext: undefined,
      attentionLevel: undefined,
    });

    assert.equal(result.isError, true);
    assert.match(textAt(result, 0), /not found/);
  });

  it("rejects ephemeral rules with a pointer to channel_attention_level", async () => {
    const rule = await seedEphemeralRule({
      channel: "C1",
      attentionLevel: "medium",
      sessionId: "sess-1",
      anchorText: "digest",
    });

    const tool = createUpdateAutoRespondRuleTool(buildCtx(), {
      resolveChannel: resolverFor({}),
    });
    const result = await call(tool, {
      id: rule.id,
      channels: undefined,
      userFilters: undefined,
      keywords: undefined,
      extraContext: "x",
      preAnalysisContext: undefined,
      attentionLevel: undefined,
    });

    assert.equal(result.isError, true);
    assert.match(textAt(result, 0), /ephemeral channel conversation/);
    assert.match(textAt(result, 0), /channel_attention_level/);
    const stored = await getRule(rule.id);
    assert.ok(stored, "rule must survive the rejected update");
  });
});
