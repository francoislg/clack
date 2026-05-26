import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createListSkillPackSkillsTool } from "./listSkillPackSkills.js";
import type { QueryToolContext } from "../types.js";
import type { SessionContext } from "../../sessions.js";
import type { Config, SkillPluginRegistry } from "../../config.js";
import { SkillsManager, type PackInfo } from "../../claude/skillsManager.js";

function makePack(name: string, skills: Array<{ name: string; description?: string }>): PackInfo {
  return {
    name,
    path: `/fake/data/skill-plugins/${name}`,
    description: `${name} description`,
    skills: skills.map((s) => ({
      name: s.name,
      description: s.description ?? `${s.name} desc`,
      skillMdPath: `/fake/data/skill-plugins/${name}/skills/${s.name}/SKILL.md`,
    })),
  };
}

function makeSession(): SessionContext {
  return {
    sessionId: "S",
    channelId: "C",
    messageTs: "0",
    threadTs: "0",
    userId: "U",
    trigger: { type: "mentions", userId: "U", messageTs: "0", messageText: "" },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: 0,
    createdAt: 0,
  };
}

function makeConfig(): Config {
  return {
    slack: {
      botToken: "x",
      appToken: "x",
      signingSecret: "x",
      fetchAndStoreUsername: false,
      sendErrorsAsDM: false,
    },
    reactions: { trigger: "x" },
    directMessages: { enabled: false },
    mentions: { enabled: false },
    repositories: [],
    git: { pullIntervalMinutes: 1, shallowClone: true, cloneDepth: 1 },
    sessions: { cleanupIntervalMinutes: 1 },
    claudeCode: {},
  };
}

function makeCtx(skillsManager: SkillsManager | undefined): QueryToolContext {
  return {
    mode: "query",
    userId: "U",
    role: "dev",
    session: makeSession(),
    config: makeConfig(),
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
    skillsManager,
  };
}

function extractText(
  result: Awaited<ReturnType<ReturnType<typeof createListSkillPackSkillsTool>["handler"]>>,
): string {
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) return "";
  const first = content[0];
  if (first.type !== "text") return "";
  return first.text;
}

function isError(
  result: Awaited<ReturnType<ReturnType<typeof createListSkillPackSkillsTool>["handler"]>>,
): boolean {
  return "isError" in result && result.isError === true;
}

function callHandler(
  tool: ReturnType<typeof createListSkillPackSkillsTool>,
  args: { pack: string },
) {
  return tool.handler(args, {
    signal: new AbortController().signal,
    requestId: "r",
  });
}

describe("list_skill_pack_skills tool", () => {
  it("errors when skillsManager is missing from context", async () => {
    const tool = createListSkillPackSkillsTool(makeCtx(undefined));
    const result = await callHandler(tool, { pack: "any" });
    assert.ok(isError(result));
    assert.ok(extractText(result).includes("not available"));
  });

  it("errors with available pack list when pack is unknown", async () => {
    const registry: SkillPluginRegistry = {
      marketingskills: { lazyLoad: true, description: "Marketing" },
    };
    const mgr = new SkillsManager(
      new Map([["marketingskills", makePack("marketingskills", [{ name: "ab-test-setup" }])]]),
      registry,
    );
    const tool = createListSkillPackSkillsTool(makeCtx(mgr));
    const result = await callHandler(tool, { pack: "nonexistent" });
    assert.ok(isError(result));
    const text = extractText(result);
    assert.ok(text.includes("Unknown skill pack"));
    assert.ok(text.includes("marketingskills"));
  });

  it("rejects eager packs with guidance to use native Skill()", async () => {
    const registry: SkillPluginRegistry = {
      devtools: { lazyLoad: false, description: "" },
    };
    const mgr = new SkillsManager(new Map(), registry);
    const tool = createListSkillPackSkillsTool(makeCtx(mgr));
    const result = await callHandler(tool, { pack: "devtools" });
    assert.ok(isError(result));
    const text = extractText(result);
    assert.ok(text.includes("eager-loaded"));
    assert.ok(/Skill\(/.test(text));
  });

  it("returns the alphabetized skill list for a valid lazy pack", async () => {
    const registry: SkillPluginRegistry = {
      marketingskills: { lazyLoad: true, description: "Marketing" },
    };
    const mgr = new SkillsManager(
      new Map([
        [
          "marketingskills",
          makePack("marketingskills", [
            { name: "pricing-strategy", description: "Price a product" },
            { name: "ab-test-setup", description: "Plan an A/B test" },
            { name: "copywriting", description: "Write copy" },
          ]),
        ],
      ]),
      registry,
    );
    const tool = createListSkillPackSkillsTool(makeCtx(mgr));
    const result = await callHandler(tool, { pack: "marketingskills" });
    assert.ok(!isError(result));
    const text = extractText(result);
    assert.ok(text.includes("- ab-test-setup — Plan an A/B test"));
    assert.ok(text.includes("- copywriting — Write copy"));
    assert.ok(text.includes("- pricing-strategy — Price a product"));
    const abIdx = text.indexOf("ab-test-setup");
    const copyIdx = text.indexOf("copywriting");
    const priceIdx = text.indexOf("pricing-strategy");
    assert.ok(abIdx < copyIdx);
    assert.ok(copyIdx < priceIdx);
  });

  it("returns a friendly message when a lazy pack has no skills", async () => {
    const registry: SkillPluginRegistry = {
      empty: { lazyLoad: true, description: "Empty" },
    };
    const mgr = new SkillsManager(new Map([["empty", makePack("empty", [])]]), registry);
    const tool = createListSkillPackSkillsTool(makeCtx(mgr));
    const result = await callHandler(tool, { pack: "empty" });
    assert.ok(!isError(result));
    const text = extractText(result);
    assert.ok(text.includes("no skills available"));
  });

  it("rejects 'user-skills' pack with redirect to inline catalog", async () => {
    const tool = createListSkillPackSkillsTool(makeCtx(new SkillsManager(new Map(), {})));
    const result = await callHandler(tool, { pack: "user-skills" });
    assert.ok(isError(result));
    const text = extractText(result);
    assert.ok(/USER SKILLS/.test(text));
    assert.ok(/load_skill/.test(text));
  });
});
