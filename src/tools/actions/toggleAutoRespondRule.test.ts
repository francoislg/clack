import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createToggleAutoRespondRuleTool } from "./toggleAutoRespondRule.js";
import type { QueryToolContext } from "../types.js";
import { addRule, clearAutoRespondCache, getRule } from "../../autoRespond.js";

const originalCwd = process.cwd;

interface ToolHandlerResult {
  content: Array<{ text: string }>;
  isError?: boolean;
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
    allowScheduledMessages: false,
    ...overrides,
  } as QueryToolContext;
}

type ToggleTool = ReturnType<typeof createToggleAutoRespondRuleTool>;

function call(
  tool: ToggleTool,
  args: Parameters<ToggleTool["handler"]>[0],
): Promise<ToolHandlerResult> {
  return tool.handler(args, { sessionId: "test" });
}

describe("toggle_auto_respond_rule tool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "tar-test-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearAutoRespondCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("toggles enabled → disabled", async () => {
    const rule = await addRule(["C1"]);
    assert.equal(rule.enabled, true);

    const tool = createToggleAutoRespondRuleTool(buildCtx());
    const result = await call(tool, { id: rule.id });

    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.enabled, false);
    const stored = await getRule(rule.id);
    assert.equal(stored?.enabled, false);
  });

  it("toggles disabled → enabled", async () => {
    const rule = await addRule(["C1"]);
    const tool = createToggleAutoRespondRuleTool(buildCtx());
    await call(tool, { id: rule.id });
    const result = await call(tool, { id: rule.id });

    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.enabled, true);
  });

  it("returns error for unknown rule ID", async () => {
    const tool = createToggleAutoRespondRuleTool(buildCtx());
    const result = await call(tool, { id: "nope" });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not found/);
  });
});
