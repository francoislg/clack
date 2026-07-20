/**
 * Integration test for the one question unit scope cannot answer: does a plugin's
 * `registerMcpServer` call, flowing through the REAL SDK factory and plugin
 * harvest, surface as a catalog entry in `resolveEffectiveRegistry()` with no
 * `data/config.json` entry backing it?
 *
 * Everything else this file used to assert — which tools land on which server,
 * role gates, the seasons gate, the crons-capability self-disable — lives at unit
 * scope in `wiring.test.ts` against the canonical fake sdk.
 */
import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { createClackSdk } from "../../plugins-sdk/testHelpers.js";
import { setLoadedPlugins, getLoadedPlugins } from "../../plugins-core/state.js";
import { resolveEffectiveRegistry } from "../../mcp.js";
import { triviaPlugin } from "./index.js";
import type { RolesConfig } from "../../roles.js";

const EMPTY_ROLES: RolesConfig = { owner: null, admins: [], devs: [] };

async function bootTrivia(): Promise<() => void> {
  const dataDir = mkdtempSync(join(tmpdir(), "clack-trivia-gating-"));
  // Seed a minimal config.json that enables seasons so the seasons-conditional tool
  // registrations fire and the description advertises the full tool surface.
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

describe("trivia plugin — registry-merge pipeline end-to-end", () => {
  let teardown: () => void = () => {};

  beforeEach(async () => {
    setLoadedPlugins({ results: [] });
    teardown = await bootTrivia();
  });

  afterEach(() => {
    teardown();
    setLoadedPlugins({ results: [] });
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
