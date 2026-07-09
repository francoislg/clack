/**
 * End-to-end gating test for the trivia plugin's `trivia:management` integration.
 *
 * Boots the trivia plugin through the real SDK factory, harvests the load result,
 * registers it with the global plugin state, then runs `buildClackTools` against
 * sessions with various `attachedIntegrations` shapes — asserting that the seven
 * management tools are hidden/revealed correctly while runtime + read-only tools
 * stay always-available.
 *
 * Also exercises the registry-merge pipeline: with no `data/config.json` entry for
 * `trivia:management`, the plugin's `registerMcpServer` call is what makes
 * `resolveEffectiveRegistry()` produce a catalog entry.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { createClackSdk } from "../sdk.js";
import { setLoadedPlugins } from "../state.js";
import { buildClackTools } from "../../tools/server.js";
import { resolveEffectiveRegistry } from "../../mcp.js";
import { triviaPlugin } from "./index.js";
import type { QueryToolContext } from "../../tools/types.js";
import type { Config } from "../../config.js";
import type { SessionContext } from "../../sessions.js";
import type { RolesConfig } from "../../roles.js";

const EMPTY_ROLES: RolesConfig = { owner: null, admins: [], devs: [] };

// Management tools live on the on-demand `trivia:management` server: each tool's full
// MCP name is `mcp__trivia_management__<tool>`. The plugin registers this server via
// `sdk.registerMcpServer("management", ...)` and binds tools through the returned handle.
const MANAGEMENT_TOOLS = [
  "mcp__trivia_management__upsert_game",
  "mcp__trivia_management__delete_game",
  "mcp__trivia_management__set_workspace_config",
  "mcp__trivia_management__upsert_season",
  "mcp__trivia_management__delete_season",
  "mcp__trivia_management__add_categories",
  "mcp__trivia_management__remove_categories",
] as const;

const RUNTIME_TOOLS = [
  "mcp__trivia__get_ideas",
  "mcp__trivia__save_question",
  "mcp__trivia__post_questions",
  "mcp__trivia__get_question_history",
  "mcp__trivia__compute_answers",
  "mcp__trivia__refresh_question_cards",
  "mcp__trivia__start_new_season",
  "mcp__trivia__check_season_status",
  "mcp__trivia__save_cheating",
] as const;

const READ_ONLY_TOOLS = [
  "mcp__trivia__list_games",
  "mcp__trivia__list_seasons",
  "mcp__trivia__find_previous_questions",
  "mcp__trivia__retrieve_scores",
] as const;

async function bootTrivia(): Promise<() => void> {
  const dataDir = mkdtempSync(join(tmpdir(), "clack-trivia-gating-"));
  // Seed a minimal config.json that enables seasons so the seasons-conditional tool
  // registrations fire and we can assert on the full seven-tool gating surface.
  const pluginDir = join(dataDir, "trivia");
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(
    join(pluginDir, "config.json"),
    JSON.stringify({ games: [], seasons: { enabled: true, prompt: "test" } }),
  );
  const { sdk, harvest } = createClackSdk("trivia", dataDir, {
    getSlackClient: () => null,
    loadRoles: async () => EMPTY_ROLES,
    openDmChannel: async () => null,
    clackQuery: () => emptyClackQuery(),
    findByPluginOwner: async () => [],
    createJob: async () => {
      throw new Error("unexpected createJob in gating test (no specs should reconcile)");
    },
    updateJob: async () => {
      throw new Error("unexpected updateJob in gating test");
    },
    deleteJob: async () => {
      throw new Error("unexpected deleteJob in gating test");
    },
  });
  await triviaPlugin(sdk);
  const loaded = harvest();
  setLoadedPlugins({ results: [loaded] });
  // Close any FS watchers the plugin started — otherwise they keep the event loop alive
  // and node --test never exits.
  return () => {
    for (const w of loaded.watchers ?? []) w.close();
  };
}

async function* emptyClackQuery(): AsyncGenerator<never, void, void> {}

function makeAdminCtx(attachedIntegrations: string[]): QueryToolContext {
  const session: SessionContext = {
    sessionId: "sess-trivia-gating",
    channelId: "C1",
    messageTs: "1",
    threadTs: "1",
    userId: "U1",
    trigger: { type: "mentions", userId: "U1", messageTs: "1", messageText: "hi" },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
    triggerType: "mentions",
    attachedIntegrations,
  };
  return {
    mode: "query",
    userId: "U1",
    role: "admin",
    session,
    config: {} as Config,
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
  };
}

describe("trivia plugin — trivia:management gating end-to-end", () => {
  let teardown: () => void = () => {};

  beforeEach(async () => {
    setLoadedPlugins({ results: [] });
    teardown = await bootTrivia();
  });

  afterEach(() => {
    teardown();
    setLoadedPlugins({ results: [] });
  });

  it("hides all seven management tools when trivia:management is not attached", () => {
    const result = buildClackTools(makeAdminCtx([]));
    for (const name of MANAGEMENT_TOOLS) {
      assert.equal(
        result.toolNames.includes(name),
        false,
        `${name} should be hidden without attach_integration("trivia:management")`,
      );
    }
  });

  it("reveals all seven management tools after attach_integration('trivia:management')", () => {
    const result = buildClackTools(makeAdminCtx(["trivia:management"]));
    for (const name of MANAGEMENT_TOOLS) {
      assert.equal(
        result.toolNames.includes(name),
        true,
        `${name} should be visible after attaching the integration`,
      );
    }
  });

  it("keeps runtime + read-only tools always-available regardless of attach state", () => {
    for (const attached of [[], ["trivia:management"]]) {
      const result = buildClackTools(makeAdminCtx(attached));
      for (const name of [...RUNTIME_TOOLS, ...READ_ONLY_TOOLS]) {
        assert.equal(
          result.toolNames.includes(name),
          true,
          `${name} should be present with attachedIntegrations=${JSON.stringify(attached)}`,
        );
      }
    }
  });

  it("plugin self-disables when sdk.capabilities.crons is false", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "clack-trivia-nocron-"));
    const { sdk, harvest } = createClackSdk("trivia", dataDir, {
      getSlackClient: () => null,
      loadRoles: async () => EMPTY_ROLES,
      openDmChannel: async () => null,
      clackQuery: () => emptyClackQuery(),
      capabilities: { crons: false },
      // Reconcile/create/update/delete should never be touched — trivia returns early.
      findByPluginOwner: async () => {
        throw new Error("reconcile should not run when crons are disabled");
      },
      createJob: async () => {
        throw new Error("createJob should not run when crons are disabled");
      },
      updateJob: async () => {
        throw new Error("updateJob should not run when crons are disabled");
      },
      deleteJob: async () => {
        throw new Error("deleteJob should not run when crons are disabled");
      },
    });
    await triviaPlugin(sdk);
    const loaded = harvest();
    try {
      assert.equal(loaded.errors.length, 1);
      assert.match(loaded.errors[0], /Trivia requires the cron scheduler/);
      assert.match(loaded.errors[0], /config\.cron\.enabled/);
      assert.equal(loaded.tools.length, 0);
      assert.equal(loaded.instructions.length, 0);
      assert.equal(loaded.mcpServers.length, 0);
    } finally {
      for (const w of loaded.watchers ?? []) w.close();
    }
  });

  it("plugin's registerMcpServer call surfaces in the merged MCP registry", () => {
    const { registry } = resolveEffectiveRegistry({
      configRegistry: {},
      mcpServerNames: [],
      githubAutoInjected: false,
      pluginIntegrations: [
        // Mirrors what `getLoadedPluginIntegrations()` would return after bootTrivia().
        // We construct it directly here to keep the test pure (no global-state coupling).
        ...flattenLoadedIntegrations(),
      ],
    });
    assert.ok(registry["trivia:management"], "trivia:management should be in the registry");
    assert.equal(registry["trivia:management"].alwaysLoad, false);
    assert.match(registry["trivia:management"].description, /upsert_game/);
    assert.match(registry["trivia:management"].description, /remove_categories/);
  });
});

import { getLoadedPlugins } from "../state.js";

function flattenLoadedIntegrations(): Array<{
  name: string;
  description: string;
  alwaysLoad: boolean;
  pluginName: string;
}> {
  return getLoadedPlugins().results.flatMap((p) =>
    p.mcpServers.map((s) => ({
      name: s.fullName,
      description: s.description,
      alwaysLoad: s.autoload,
      pluginName: p.name,
    })),
  );
}
