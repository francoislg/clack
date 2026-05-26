import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createProposeSkillCreateTool, type ProposeSkillCreateDeps } from "./proposeSkillCreate.js";
import { parseToolResult, toolResultText } from "../testHelpers.js";
import { createIntentStore } from "../server.js";
import type { QueryToolContext } from "../types.js";
import type { Config } from "../../config.js";

function makeCtx(opts?: {
  userSkillsEnabled?: boolean;
  role?: QueryToolContext["role"];
}): QueryToolContext {
  return {
    mode: "query",
    userId: "U_ALICE",
    role: opts?.role ?? "member",
    session: { sessionId: "S", channelId: "C" } as QueryToolContext["session"],
    config: {
      userSkills: opts?.userSkillsEnabled ? { enabled: true } : undefined,
    } as Config,
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
  };
}

function makeDeps(overrides?: Partial<ProposeSkillCreateDeps>): ProposeSkillCreateDeps {
  return {
    validateSlug: vi.fn(() => ({ ok: true as const })),
    validateDescription: vi.fn(() => ({ ok: true as const })),
    userSkillExists: vi.fn(() => false),
    ...overrides,
  };
}

async function call(
  ctx: QueryToolContext,
  deps: ProposeSkillCreateDeps,
  args: { name: string; description: string; body: string },
) {
  const intentStore = createIntentStore();
  const tool = createProposeSkillCreateTool(ctx, intentStore, deps);
  const result = await tool.handler(args, {
    signal: new AbortController().signal,
    requestId: "r",
  });
  return { result, intentStore };
}

describe("propose_skill_create", () => {
  it("stages a skill_create intent and returns a ref", async () => {
    const { result, intentStore } = await call(makeCtx({ userSkillsEnabled: true }), makeDeps(), {
      name: "copy-improver",
      description: "When the user wants X",
      body: "body",
    });
    const json = parseToolResult(result as { content: readonly { type: string }[] });
    assert.ok(json.ref);
    assert.equal(json.slug, "copy-improver");
    assert.equal(json.applied, false);
    const intent = intentStore.resolve(json.ref);
    assert.equal(intent?.type, "skill_create");
    if (intent?.type === "skill_create") {
      assert.equal(intent.slug, "copy-improver");
      assert.equal(intent.ownerUserId, "U_ALICE");
      assert.equal(intent.description, "When the user wants X");
    }
  });

  it("rejects when feature is disabled", async () => {
    const { result } = await call(makeCtx({ userSkillsEnabled: false }), makeDeps(), {
      name: "x",
      description: "y",
      body: "z",
    });
    assert.match(toolResultText(result), /not enabled/);
  });

  it("rejects invalid slug", async () => {
    const deps = makeDeps({
      validateSlug: () => ({ ok: false, reason: "bad" }),
    });
    const { result } = await call(makeCtx({ userSkillsEnabled: true }), deps, {
      name: "Bad",
      description: "y",
      body: "z",
    });
    assert.match(toolResultText(result), /Invalid skill name: bad/);
  });

  it("rejects invalid description", async () => {
    const deps = makeDeps({
      validateDescription: () => ({ ok: false, reason: "too short" }),
    });
    const { result } = await call(makeCtx({ userSkillsEnabled: true }), deps, {
      name: "ok",
      description: "",
      body: "z",
    });
    assert.match(toolResultText(result), /Invalid description: too short/);
  });

  it("rejects existing slug", async () => {
    const deps = makeDeps({ userSkillExists: () => true });
    const { result } = await call(makeCtx({ userSkillsEnabled: true }), deps, {
      name: "existing",
      description: "y",
      body: "z",
    });
    assert.match(toolResultText(result), /already exists/);
  });

  it("trims description before staging", async () => {
    const { result, intentStore } = await call(makeCtx({ userSkillsEnabled: true }), makeDeps(), {
      name: "ok",
      description: "  trimmed  ",
      body: "z",
    });
    const json = parseToolResult(result as { content: readonly { type: string }[] });
    const intent = intentStore.resolve(json.ref);
    if (intent?.type === "skill_create") {
      assert.equal(intent.description, "trimmed");
    }
  });
});
