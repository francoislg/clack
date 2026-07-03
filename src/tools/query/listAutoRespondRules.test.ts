import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createListAutoRespondRulesTool } from "./listAutoRespondRules.js";
import type { QueryToolContext } from "../types.js";
import { addRule, clearAutoRespondCache } from "../../autoRespond.js";
import { seedEphemeralRule, clearEphemeralRulesCache } from "../../ephemeralRules.js";

const originalCwd = process.cwd;

type ToolHandlerResult = Awaited<
  ReturnType<ReturnType<typeof createListAutoRespondRulesTool>["handler"]>
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

describe("list_auto_respond_rules tool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lar-test-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearAutoRespondCache();
    clearEphemeralRulesCache();
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
    const parsed = JSON.parse(textAt(result, 0));
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
    const parsed = JSON.parse(textAt(result, 0));

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

describe("list_auto_respond_rules tool — ephemeral rules projection", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lar-test-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearAutoRespondCache();
    clearEphemeralRulesCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("marks ephemeral rule as dormant when expiresAt < now", async () => {
    const futureExpiry = Date.now() + 10_000;
    await seedEphemeralRule({
      channel: "C_EPHEMERAL",
      attentionLevel: "medium",
      sessionId: "s1",
      anchorText: "test message",
    });

    const tool = createListAutoRespondRulesTool(buildCtx());
    const result: ToolHandlerResult = await tool.handler(
      { _placeholder: undefined },
      { sessionId: "test" },
    );
    const parsed = JSON.parse(textAt(result, 0));

    assert.equal(parsed.rules.length, 1);
    const ephemeralRule = parsed.rules[0];
    assert.equal(ephemeralRule.kind, "ephemeral");
    const now = Date.now();
    const isDormant = ephemeralRule.expiresAt < now;
    assert.equal(ephemeralRule.dormant, isDormant);
  });

  it("marks ephemeral rule as NOT dormant when expiresAt > now", async () => {
    await seedEphemeralRule({
      channel: "C_EPHEMERAL",
      attentionLevel: "medium",
      sessionId: "sess-1",
      anchorText: "fresh message",
    });

    const tool = createListAutoRespondRulesTool(buildCtx());
    const result: ToolHandlerResult = await tool.handler(
      { _placeholder: undefined },
      { sessionId: "test" },
    );
    const parsed = JSON.parse(textAt(result, 0));

    assert.equal(parsed.rules.length, 1);
    const ephemeralRule = parsed.rules[0];
    assert.equal(ephemeralRule.kind, "ephemeral");
    assert.equal(ephemeralRule.dormant, false);
  });

  it("sets linkedSessions to sessionIds.length for ephemeral rules", async () => {
    await seedEphemeralRule({
      channel: "C_EPH",
      attentionLevel: "medium",
      sessionId: "s1",
      anchorText: "test",
    });

    const tool = createListAutoRespondRulesTool(buildCtx());
    const result: ToolHandlerResult = await tool.handler(
      { _placeholder: undefined },
      { sessionId: "test" },
    );
    const parsed = JSON.parse(textAt(result, 0));

    assert.equal(parsed.rules[0].linkedSessions, 1);
  });

  it("truncates anchorText to 200 chars for ephemeral rules", async () => {
    const longText = "x".repeat(250);
    await seedEphemeralRule({
      channel: "C_EPH",
      attentionLevel: "medium",
      sessionId: "s1",
      anchorText: longText,
    });

    const tool = createListAutoRespondRulesTool(buildCtx());
    const result: ToolHandlerResult = await tool.handler(
      { _placeholder: undefined },
      { sessionId: "test" },
    );
    const parsed = JSON.parse(textAt(result, 0));

    assert.equal(parsed.rules[0].anchorText.length, 200);
    assert.equal(parsed.rules[0].anchorText, "x".repeat(200));
  });

  it("does not truncate anchorText when it's already 200 chars or less", async () => {
    const shortText = "short message";
    await seedEphemeralRule({
      channel: "C_EPH",
      attentionLevel: "medium",
      sessionId: "s1",
      anchorText: shortText,
    });

    const tool = createListAutoRespondRulesTool(buildCtx());
    const result: ToolHandlerResult = await tool.handler(
      { _placeholder: undefined },
      { sessionId: "test" },
    );
    const parsed = JSON.parse(textAt(result, 0));

    assert.equal(parsed.rules[0].anchorText, shortText);
  });

  it("passes standing rules through unchanged", async () => {
    await addRule(["C1", "C2"], ["U1"], ["error"], "extra ctx", "pre-analysis");

    const tool = createListAutoRespondRulesTool(buildCtx());
    const result: ToolHandlerResult = await tool.handler(
      { _placeholder: undefined },
      { sessionId: "test" },
    );
    const parsed = JSON.parse(textAt(result, 0));

    assert.equal(parsed.rules.length, 1);
    const standingRule = parsed.rules[0];
    assert.deepEqual(standingRule.channels, ["C1", "C2"]);
    assert.deepEqual(standingRule.userFilters, ["U1"]);
    assert.deepEqual(standingRule.keywords, ["error"]);
    assert.equal(standingRule.extraContext, "extra ctx");
    assert.equal(standingRule.preAnalysisContext, "pre-analysis");
    assert.equal(standingRule.enabled, true);
    assert.ok(!("dormant" in standingRule));
    assert.ok(!("linkedSessions" in standingRule));
    assert.ok(!("anchorText" in standingRule));
  });

  it("mixes standing and ephemeral rules in same list", async () => {
    await addRule(["C1"]);
    await seedEphemeralRule({
      channel: "C_EPH",
      attentionLevel: "medium",
      sessionId: "s1",
      anchorText: "ephemeral msg",
    });

    const tool = createListAutoRespondRulesTool(buildCtx());
    const result: ToolHandlerResult = await tool.handler(
      { _placeholder: undefined },
      { sessionId: "test" },
    );
    const parsed = JSON.parse(textAt(result, 0));

    assert.equal(parsed.rules.length, 2);
    const allRules = parsed.rules;
    const hasEphemeral = allRules.some((r: { kind?: string }) => r.kind === "ephemeral");
    const hasStanding = allRules.some((r: { kind?: string }) => !r.kind);
    assert.ok(hasEphemeral);
    assert.ok(hasStanding);
  });
});
