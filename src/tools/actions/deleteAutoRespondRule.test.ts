import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeleteAutoRespondRuleTool } from "./deleteAutoRespondRule.js";
import type { QueryToolContext } from "../types.js";
import { addRule, clearAutoRespondCache, getRules } from "../../autoRespond.js";

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

type DeleteTool = ReturnType<typeof createDeleteAutoRespondRuleTool>;

function call(
  tool: DeleteTool,
  args: Parameters<DeleteTool["handler"]>[0],
): Promise<ToolHandlerResult> {
  return tool.handler(args, { sessionId: "test" });
}

describe("delete_auto_respond_rule tool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "dar-test-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearAutoRespondCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("deletes an existing rule", async () => {
    const rule = await addRule(["C1"]);
    await addRule(["C2"]);

    const tool = createDeleteAutoRespondRuleTool(buildCtx());
    const result = await call(tool, { id: rule.id });

    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.deleted, true);
    const remaining = await getRules();
    assert.equal(remaining.length, 1);
    assert.notEqual(remaining[0].id, rule.id);
  });

  it("returns error for unknown rule ID", async () => {
    const tool = createDeleteAutoRespondRuleTool(buildCtx());
    const result = await call(tool, { id: "nope" });

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not found/);
  });
});
