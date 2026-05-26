import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { createProposeSkillUpdateTool, type ProposeSkillUpdateDeps } from "./proposeSkillUpdate.js";
import { parseToolResult, toolResultText } from "../testHelpers.js";
import { createIntentStore } from "../server.js";
import type { QueryToolContext } from "../types.js";
import type { Config } from "../../config.js";
import type { UserSkill } from "../../userSkills.js";

const makeSkill = (overrides?: Partial<UserSkill>): UserSkill => ({
  slug: "foo",
  description: "desc",
  body: "body",
  ownerUserId: "U_OWNER",
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  ...overrides,
});

function makeCtx(role: QueryToolContext["role"], userId = "U_OWNER"): QueryToolContext {
  return {
    mode: "query",
    userId,
    role,
    session: { sessionId: "S" } as QueryToolContext["session"],
    config: { userSkills: { enabled: true } } as Config,
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
  };
}

function makeDeps(overrides?: Partial<ProposeSkillUpdateDeps>): ProposeSkillUpdateDeps {
  return {
    validateDescription: vi.fn(() => ({ ok: true as const })),
    readUserSkill: vi.fn(() => makeSkill()),
    ...overrides,
  };
}

async function call(
  ctx: QueryToolContext,
  deps: ProposeSkillUpdateDeps,
  args: { name: string; description?: string; body?: string },
) {
  const intentStore = createIntentStore();
  const tool = createProposeSkillUpdateTool(ctx, intentStore, deps);
  const result = await tool.handler(
    { name: args.name, description: args.description, body: args.body },
    {
      signal: new AbortController().signal,
      requestId: "r",
    },
  );
  return { result, intentStore };
}

describe("propose_skill_update", () => {
  it("owner can stage an update", async () => {
    const { result, intentStore } = await call(makeCtx("member", "U_OWNER"), makeDeps(), {
      name: "foo",
      body: "new",
    });
    const json = parseToolResult(result as { content: readonly { type: string }[] });
    const intent = intentStore.resolve(json.ref);
    assert.equal(intent?.type, "skill_update");
  });

  it("admin can update someone else's skill", async () => {
    const { result } = await call(makeCtx("admin", "U_ADMIN"), makeDeps(), {
      name: "foo",
      body: "new",
    });
    const json = parseToolResult(result as { content: readonly { type: string }[] });
    assert.ok(json.ref);
  });

  it("non-owner non-admin rejected", async () => {
    const { result } = await call(makeCtx("member", "U_OTHER"), makeDeps(), {
      name: "foo",
      body: "new",
    });
    assert.match(toolResultText(result), /do not have permission/);
  });

  it("rejects when no fields provided", async () => {
    const { result } = await call(makeCtx("member", "U_OWNER"), makeDeps(), { name: "foo" });
    assert.match(toolResultText(result), /at least one/);
  });

  it("rejects unknown slug", async () => {
    const deps = makeDeps({ readUserSkill: () => null });
    const { result } = await call(makeCtx("member", "U_OWNER"), deps, {
      name: "ghost",
      body: "x",
    });
    assert.match(toolResultText(result), /not found/);
  });

  it("rejects update of disabled skill", async () => {
    const deps = makeDeps({
      readUserSkill: () => makeSkill({ disabledAt: "2026-01-02" }),
    });
    const { result } = await call(makeCtx("member", "U_OWNER"), deps, {
      name: "foo",
      body: "x",
    });
    assert.match(toolResultText(result), /disabled/);
  });

  it("rejects invalid description", async () => {
    const deps = makeDeps({
      validateDescription: () => ({ ok: false, reason: "bad" }),
    });
    const { result } = await call(makeCtx("member", "U_OWNER"), deps, {
      name: "foo",
      description: "x",
    });
    assert.match(toolResultText(result), /Invalid description/);
  });

  it("rejects when feature disabled", async () => {
    const ctx = makeCtx("admin");
    const ctxOff: QueryToolContext = { ...ctx, config: {} as Config };
    const { result } = await call(ctxOff, makeDeps(), { name: "foo", body: "x" });
    assert.match(toolResultText(result), /not enabled/);
  });
});
