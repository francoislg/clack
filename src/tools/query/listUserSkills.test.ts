import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createListUserSkillsTool, type ListUserSkillsDeps } from "./listUserSkills.js";
import { toolResultText } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import type { Config } from "../../config.js";
import type { UserSkill } from "../../userSkills.js";

const makeSkill = (overrides?: Partial<UserSkill>): UserSkill => ({
  slug: "x",
  description: "d",
  body: "b",
  ownerUserId: "U",
  createdAt: "t",
  updatedAt: "t",
  ...overrides,
});

function makeCtx(userSkillsEnabled = true): QueryToolContext {
  return {
    mode: "query",
    userId: "U",
    role: "member",
    session: { sessionId: "S" } as QueryToolContext["session"],
    config: {
      userSkills: userSkillsEnabled ? { enabled: true } : undefined,
    } as Config,
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
  };
}

async function call(
  ctx: QueryToolContext,
  deps: ListUserSkillsDeps,
  args: { owner?: string } = {},
) {
  const tool = createListUserSkillsTool(ctx, deps);
  return tool.handler(
    { owner: args.owner },
    { signal: new AbortController().signal, requestId: "r" },
  );
}

describe("list_user_skills", () => {
  it("lists all enabled and disabled skills", async () => {
    const deps: ListUserSkillsDeps = {
      discoverUserSkills: () => [
        makeSkill({ slug: "alpha", ownerUserId: "U_ALICE" }),
        makeSkill({ slug: "beta", ownerUserId: "U_BOB", disabledAt: "x" }),
      ],
    };
    const result = await call(makeCtx(), deps);
    const text = toolResultText(result);
    assert.match(text, /alpha/);
    assert.match(text, /beta/);
    assert.match(text, /\(disabled\)/);
    assert.match(text, /<@U_ALICE>/);
  });

  it("filters by owner", async () => {
    const deps: ListUserSkillsDeps = {
      discoverUserSkills: () => [
        makeSkill({ slug: "alpha", ownerUserId: "U_ALICE" }),
        makeSkill({ slug: "beta", ownerUserId: "U_BOB" }),
      ],
    };
    const result = await call(makeCtx(), deps, { owner: "U_ALICE" });
    const text = toolResultText(result);
    assert.match(text, /alpha/);
    assert.equal(/beta/.test(text), false);
  });

  it("returns empty message when no skills", async () => {
    const result = await call(makeCtx(), { discoverUserSkills: () => [] });
    assert.match(toolResultText(result), /No user skills found/);
  });

  it("returns owner-specific empty message", async () => {
    const result = await call(makeCtx(), { discoverUserSkills: () => [] }, { owner: "U_GHOST" });
    assert.match(toolResultText(result), /U_GHOST/);
  });

  it("results are alphabetized by slug", async () => {
    const deps: ListUserSkillsDeps = {
      discoverUserSkills: () => [
        makeSkill({ slug: "zebra", ownerUserId: "U" }),
        makeSkill({ slug: "apple", ownerUserId: "U" }),
      ],
    };
    const result = await call(makeCtx(), deps);
    const text = toolResultText(result);
    assert.ok(text.indexOf("apple") < text.indexOf("zebra"));
  });

  it("rejects when feature disabled", async () => {
    const result = await call(makeCtx(false), { discoverUserSkills: () => [] });
    assert.match(toolResultText(result), /not enabled/);
  });
});
