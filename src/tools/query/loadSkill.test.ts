import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createLoadSkillTool, type LoadSkillDeps } from "./loadSkill.js";
import type { QueryToolContext } from "../types.js";
import type { SessionContext } from "../../sessions.js";
import type { Config, SkillPluginRegistry } from "../../config.js";
import {
  SkillsManager,
  type PackInfo,
  type SkillsManagerDeps,
} from "../../claude/skillsManager.js";

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

function makeSession(overrides: Partial<SessionContext> = {}): SessionContext {
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
    ...overrides,
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

function makeCtx(
  skillsManager: SkillsManager | undefined,
  sessionOverrides: Partial<SessionContext> = {},
): QueryToolContext {
  return {
    mode: "query",
    userId: "U",
    role: "dev",
    session: makeSession(sessionOverrides),
    config: makeConfig(),
    changesWorkflowEnabled: false,
    allowScheduledMessages: false,
    skillsManager,
  };
}

function extractText(
  result: Awaited<ReturnType<ReturnType<typeof createLoadSkillTool>["handler"]>>,
): string {
  const content = result.content;
  if (!Array.isArray(content) || content.length === 0) return "";
  const first = content[0];
  if (first.type !== "text") return "";
  return first.text;
}

function isError(
  result: Awaited<ReturnType<ReturnType<typeof createLoadSkillTool>["handler"]>>,
): boolean {
  return "isError" in result && result.isError === true;
}

function callHandler(
  tool: ReturnType<typeof createLoadSkillTool>,
  args: { pack: string; skill: string },
) {
  return tool.handler(args, {
    signal: new AbortController().signal,
    requestId: "r",
  });
}

type UpdateSessionMock = ReturnType<typeof mock.fn<LoadSkillDeps["updateSession"]>>;

interface TestDeps extends LoadSkillDeps {
  updateSession: UpdateSessionMock;
}

function makeDeps(): TestDeps {
  const updateSession = mock.fn<LoadSkillDeps["updateSession"]>(async () => null);
  return { updateSession };
}

function makeManager(
  packs: Array<{
    name: string;
    skills: Array<{ name: string; description?: string }>;
  }>,
  registry: SkillPluginRegistry,
  initialLoaded: Array<{ pack: string; skill: string }> = [],
  managerDeps?: SkillsManagerDeps,
): SkillsManager {
  const lazyPacks = new Map<string, PackInfo>();
  for (const p of packs) {
    lazyPacks.set(p.name, makePack(p.name, p.skills));
  }
  return new SkillsManager(lazyPacks, registry, initialLoaded, managerDeps);
}

const MARKETING_REGISTRY: SkillPluginRegistry = {
  marketingskills: { lazyLoad: true, description: "Marketing" },
};

describe("load_skill tool", () => {
  it("errors when skillsManager is missing from context", async () => {
    const tool = createLoadSkillTool(makeCtx(undefined), makeDeps());
    const result = await callHandler(tool, { pack: "x", skill: "y" });
    assert.ok(isError(result));
    assert.ok(extractText(result).includes("not available"));
  });

  it("rejects eager packs with guidance to use native Skill()", async () => {
    const mgr = makeManager([], {
      devtools: { lazyLoad: false, description: "" },
    });
    const tool = createLoadSkillTool(makeCtx(mgr), makeDeps());
    const result = await callHandler(tool, {
      pack: "devtools",
      skill: "whatever",
    });
    assert.ok(isError(result));
    assert.ok(/Skill\(/.test(extractText(result)));
  });

  it("rejects unknown packs with available pack list", async () => {
    const mgr = makeManager(
      [{ name: "marketingskills", skills: [{ name: "ab-test-setup" }] }],
      MARKETING_REGISTRY,
    );
    const tool = createLoadSkillTool(makeCtx(mgr), makeDeps());
    const result = await callHandler(tool, { pack: "ghost", skill: "x" });
    assert.ok(isError(result));
    const text = extractText(result);
    assert.ok(text.includes("Unknown skill pack"));
    assert.ok(text.includes("marketingskills"));
  });

  it("rejects unknown skills with pointer to list_skill_pack_skills", async () => {
    const mgr = makeManager(
      [{ name: "marketingskills", skills: [{ name: "ab-test-setup" }] }],
      MARKETING_REGISTRY,
    );
    const tool = createLoadSkillTool(makeCtx(mgr), makeDeps());
    const result = await callHandler(tool, {
      pack: "marketingskills",
      skill: "ghost",
    });
    assert.ok(isError(result));
    const text = extractText(result);
    assert.ok(text.includes("not found"));
    assert.ok(text.includes("list_skill_pack_skills"));
  });

  it("returns the body and persists loadedSkills on first load", async () => {
    const readFile = mock.fn((_path: string) => "---\nname: ab-test-setup\n---\n\nBody here");
    const managerDeps: SkillsManagerDeps = { readFile };
    const mgr = makeManager(
      [{ name: "marketingskills", skills: [{ name: "ab-test-setup" }] }],
      MARKETING_REGISTRY,
      [],
      managerDeps,
    );
    const deps = makeDeps();
    const tool = createLoadSkillTool(makeCtx(mgr), deps);
    const result = await callHandler(tool, {
      pack: "marketingskills",
      skill: "ab-test-setup",
    });

    assert.ok(!isError(result));
    const text = extractText(result);
    assert.ok(text.startsWith("Loaded skill 'ab-test-setup' from pack 'marketingskills'."));
    assert.ok(text.includes("Body here"));
    assert.equal(readFile.mock.callCount(), 1);

    // Persistence call: last arg should contain loadedSkills with the pair
    const calls = deps.updateSession.mock.calls;
    assert.equal(calls.length, 1);
    const updateArgs = calls[0].arguments[1] as {
      loadedSkills?: Array<{ pack: string; skill: string }>;
    };
    assert.ok(updateArgs.loadedSkills);
    assert.deepEqual(updateArgs.loadedSkills, [
      { pack: "marketingskills", skill: "ab-test-setup" },
    ]);
  });

  it("short-circuits on repeat load in the same session", async () => {
    const readFile = mock.fn((_path: string) => "body");
    const mgr = makeManager(
      [{ name: "marketingskills", skills: [{ name: "ab-test-setup" }] }],
      MARKETING_REGISTRY,
      [{ pack: "marketingskills", skill: "ab-test-setup" }],
      { readFile },
    );
    const deps = makeDeps();
    const tool = createLoadSkillTool(makeCtx(mgr), deps);
    const result = await callHandler(tool, {
      pack: "marketingskills",
      skill: "ab-test-setup",
    });

    assert.ok(!isError(result));
    const text = extractText(result);
    assert.ok(text.includes("Skill already loaded this session"));
    // No file read on short-circuit
    assert.equal(readFile.mock.callCount(), 0);
    // No persistence call on short-circuit
    assert.equal(deps.updateSession.mock.callCount(), 0);
  });

  it("short-circuits after resume when loadedSkills survives session persistence", async () => {
    // Simulates: prior turn loaded the skill; session persists loadedSkills;
    // resumed turn builds a new SkillsManager seeded from persisted session.
    const readFile = mock.fn((_path: string) => "body");
    const mgr = makeManager(
      [{ name: "marketingskills", skills: [{ name: "ab-test-setup" }] }],
      MARKETING_REGISTRY,
      [{ pack: "marketingskills", skill: "ab-test-setup" }],
      { readFile },
    );
    const ctx = makeCtx(mgr, {
      loadedSkills: [{ pack: "marketingskills", skill: "ab-test-setup" }],
    });
    const tool = createLoadSkillTool(ctx, makeDeps());
    const result = await callHandler(tool, {
      pack: "marketingskills",
      skill: "ab-test-setup",
    });

    assert.ok(!isError(result));
    assert.ok(extractText(result).includes("already loaded"));
    assert.equal(readFile.mock.callCount(), 0);
  });

  it("returns a graceful error when file read fails", async () => {
    const readFile = mock.fn((_path: string) => {
      throw new Error("ENOENT: file missing");
    });
    const mgr = makeManager(
      [{ name: "marketingskills", skills: [{ name: "ab-test-setup" }] }],
      MARKETING_REGISTRY,
      [],
      { readFile },
    );
    const deps = makeDeps();
    const tool = createLoadSkillTool(makeCtx(mgr), deps);
    const result = await callHandler(tool, {
      pack: "marketingskills",
      skill: "ab-test-setup",
    });

    assert.ok(isError(result));
    const text = extractText(result);
    assert.ok(text.includes("Failed to read skill body"));
    assert.ok(text.includes("ENOENT"));
    // No persistence call when the read fails
    assert.equal(deps.updateSession.mock.callCount(), 0);
  });
});
