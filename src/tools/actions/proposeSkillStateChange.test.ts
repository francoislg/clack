import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import {
  createProposeSkillDisableTool,
  type ProposeSkillDisableDeps,
} from "./proposeSkillDisable.js";
import {
  createProposeSkillRestoreTool,
  type ProposeSkillRestoreDeps,
} from "./proposeSkillRestore.js";
import { parseToolResult, toolResultText } from "../testHelpers.js";
import { createIntentStore } from "../server.js";
import type { QueryToolContext } from "../types.js";
import type { Config } from "../../config.js";
import type { UserSkill } from "../../userSkills.js";

const makeSkill = (overrides?: Partial<UserSkill>): UserSkill => ({
  slug: "foo",
  description: "d",
  body: "b",
  ownerUserId: "U_OWNER",
  createdAt: "x",
  updatedAt: "x",
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

// --- disable -----------------------------------------------------------------

function callDisable(ctx: QueryToolContext, deps: ProposeSkillDisableDeps, args: { name: string }) {
  const intentStore = createIntentStore();
  const tool = createProposeSkillDisableTool(ctx, intentStore, deps);
  return tool
    .handler(args, { signal: new AbortController().signal, requestId: "r" })
    .then((result) => ({ result, intentStore }));
}

describe("propose_skill_disable", () => {
  it("owner can stage disable", async () => {
    const deps: ProposeSkillDisableDeps = { readUserSkill: vi.fn(() => makeSkill()) };
    const { result, intentStore } = await callDisable(makeCtx("member", "U_OWNER"), deps, {
      name: "foo",
    });
    const json = parseToolResult(result as { content: readonly { type: string }[] });
    const intent = intentStore.resolve(json.ref);
    assert.equal(intent?.type, "skill_disable");
  });

  it("admin can disable any", async () => {
    const deps: ProposeSkillDisableDeps = { readUserSkill: vi.fn(() => makeSkill()) };
    const { result } = await callDisable(makeCtx("admin", "U_ADMIN"), deps, {
      name: "foo",
    });
    const json = parseToolResult(result as { content: readonly { type: string }[] });
    assert.ok(json.ref);
  });

  it("non-owner rejected", async () => {
    const deps: ProposeSkillDisableDeps = { readUserSkill: vi.fn(() => makeSkill()) };
    const { result } = await callDisable(makeCtx("member", "U_OTHER"), deps, {
      name: "foo",
    });
    assert.match(toolResultText(result), /do not have permission/);
  });

  it("rejects unknown slug", async () => {
    const deps: ProposeSkillDisableDeps = { readUserSkill: vi.fn(() => null) };
    const { result } = await callDisable(makeCtx("admin"), deps, { name: "ghost" });
    assert.match(toolResultText(result), /not found/);
  });

  it("rejects already-disabled", async () => {
    const deps: ProposeSkillDisableDeps = {
      readUserSkill: vi.fn(() => makeSkill({ disabledAt: "x" })),
    };
    const { result } = await callDisable(makeCtx("admin"), deps, { name: "foo" });
    assert.match(toolResultText(result), /already disabled/);
  });

  it("rejects when feature disabled", async () => {
    const ctx = makeCtx("admin");
    const ctxOff: QueryToolContext = { ...ctx, config: {} as Config };
    const deps: ProposeSkillDisableDeps = { readUserSkill: vi.fn(() => makeSkill()) };
    const { result } = await callDisable(ctxOff, deps, { name: "foo" });
    assert.match(toolResultText(result), /not enabled/);
  });
});

// --- restore -----------------------------------------------------------------

function callRestore(ctx: QueryToolContext, deps: ProposeSkillRestoreDeps, args: { name: string }) {
  const intentStore = createIntentStore();
  const tool = createProposeSkillRestoreTool(ctx, intentStore, deps);
  return tool
    .handler(args, { signal: new AbortController().signal, requestId: "r" })
    .then((result) => ({ result, intentStore }));
}

describe("propose_skill_restore", () => {
  it("owner can stage restore on their disabled skill", async () => {
    const deps: ProposeSkillRestoreDeps = {
      readUserSkill: vi.fn(() => makeSkill({ disabledAt: "x" })),
    };
    const { result, intentStore } = await callRestore(makeCtx("member", "U_OWNER"), deps, {
      name: "foo",
    });
    const json = parseToolResult(result as { content: readonly { type: string }[] });
    const intent = intentStore.resolve(json.ref);
    assert.equal(intent?.type, "skill_restore");
  });

  it("rejects when skill is not disabled", async () => {
    const deps: ProposeSkillRestoreDeps = { readUserSkill: vi.fn(() => makeSkill()) };
    const { result } = await callRestore(makeCtx("admin"), deps, { name: "foo" });
    assert.match(toolResultText(result), /not disabled/);
  });

  it("rejects unknown slug", async () => {
    const deps: ProposeSkillRestoreDeps = { readUserSkill: vi.fn(() => null) };
    const { result } = await callRestore(makeCtx("admin"), deps, { name: "ghost" });
    assert.match(toolResultText(result), /not found/);
  });

  it("non-owner rejected", async () => {
    const deps: ProposeSkillRestoreDeps = {
      readUserSkill: vi.fn(() => makeSkill({ disabledAt: "x" })),
    };
    const { result } = await callRestore(makeCtx("member", "U_OTHER"), deps, {
      name: "foo",
    });
    assert.match(toolResultText(result), /do not have permission/);
  });
});
