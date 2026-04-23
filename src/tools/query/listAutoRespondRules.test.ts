import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createListAutoRespondRulesTool } from "./listAutoRespondRules.js";
import type { QueryToolContext } from "../types.js";
import { addRule, clearAutoRespondCache } from "../../autoRespond.js";

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

describe("list_auto_respond_rules tool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lar-test-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearAutoRespondCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty array when no rules exist", async () => {
    const tool = createListAutoRespondRulesTool(buildCtx());
    const result: ToolHandlerResult = await tool.handler(
      { _placeholder: undefined },
      { sessionId: "test" },
    );
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.count, 0);
    assert.deepEqual(parsed.rules, []);
  });

  it("returns all rules with every field set", async () => {
    await addRule(["C1", "C2"], ["U1"], ["error"], "ctx", "pre");
    await addRule(["C3"]);

    const tool = createListAutoRespondRulesTool(buildCtx());
    const result: ToolHandlerResult = await tool.handler(
      { _placeholder: undefined },
      { sessionId: "test" },
    );
    const parsed = JSON.parse(result.content[0].text);

    assert.equal(parsed.count, 2);
    const first = parsed.rules[0];
    assert.deepEqual(first.channels, ["C1", "C2"]);
    assert.deepEqual(first.userFilters, ["U1"]);
    assert.deepEqual(first.keywords, ["error"]);
    assert.equal(first.extraContext, "ctx");
    assert.equal(first.preAnalysisContext, "pre");
    assert.equal(first.enabled, true);
    assert.ok(first.id);

    const second = parsed.rules[1];
    assert.deepEqual(second.channels, ["C3"]);
    assert.equal(second.userFilters, undefined);
    assert.equal(second.keywords, undefined);
    assert.equal(second.extraContext, undefined);
    assert.equal(second.preAnalysisContext, undefined);
  });
});
