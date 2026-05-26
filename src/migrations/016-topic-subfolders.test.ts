import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { migration } from "./016-topic-subfolders.js";
import type { StaticFileResult } from "./types.js";

const CONFIG_PATH = "data/config.json";
const MCP_PATH = "data/mcp.json";

type FileMap = { [path: string]: string | null };
type OutputMap = { [path: string]: StaticFileResult };

function runStatic(files: FileMap): OutputMap {
  const full: FileMap = {};
  for (const path of migration.files) {
    full[path] = files[path] ?? null;
  }
  return migration.static!(full);
}

function asString(result: StaticFileResult | undefined): string | undefined {
  if (typeof result === "string") return result;
  return undefined;
}

describe("migration 016: seed config.mcpServers", () => {
  it("metadata is correct", () => {
    assert.equal(migration.version, 16);
    assert.equal(migration.priority, "blocking");
    assert.deepEqual(migration.files.sort(), [CONFIG_PATH, MCP_PATH].sort());
  });

  it("seeds config.mcpServers from mcp.json keys when config lacks any registry", () => {
    const mcpJson = JSON.stringify({
      mcpServers: {
        sentry: { command: "npx", args: [] },
        metabase: { command: "npx", args: [] },
      },
    });
    const configJson = JSON.stringify({ repositories: [] });

    const out = runStatic({
      [CONFIG_PATH]: configJson,
      [MCP_PATH]: mcpJson,
    });

    const written = asString(out[CONFIG_PATH]);
    assert.ok(written);
    const parsed = JSON.parse(written);
    assert.equal(parsed.mcpServers.sentry.alwaysLoad, false);
    assert.ok(parsed.mcpServers.sentry.description.startsWith("TODO"));
    assert.equal(parsed.mcpServers.metabase.alwaysLoad, false);
    assert.ok(parsed.mcpServers.metabase.description.startsWith("TODO"));
  });

  it("preserves operator-set registry entries and only seeds missing ones", () => {
    const mcpJson = JSON.stringify({
      mcpServers: {
        sentry: {},
        metabase: {},
      },
    });
    const configJson = JSON.stringify({
      repositories: [],
      mcpServers: {
        sentry: { alwaysLoad: true, description: "Custom sentry description" },
      },
    });

    const out = runStatic({
      [CONFIG_PATH]: configJson,
      [MCP_PATH]: mcpJson,
    });

    const written = asString(out[CONFIG_PATH]);
    assert.ok(written);
    const parsed = JSON.parse(written);
    assert.equal(parsed.mcpServers.sentry.alwaysLoad, true);
    assert.equal(parsed.mcpServers.sentry.description, "Custom sentry description");
    assert.equal(parsed.mcpServers.metabase.alwaysLoad, false);
    assert.ok(parsed.mcpServers.metabase.description.startsWith("TODO"));
  });

  it("does not rewrite config.json when registry is already complete", () => {
    const mcpJson = JSON.stringify({
      mcpServers: { sentry: {} },
    });
    const configJson = JSON.stringify({
      repositories: [],
      mcpServers: {
        sentry: { alwaysLoad: false, description: "Sentry errors" },
      },
    });

    const out = runStatic({
      [CONFIG_PATH]: configJson,
      [MCP_PATH]: mcpJson,
    });

    assert.equal(out[CONFIG_PATH], undefined);
  });

  it("no-op when mcp.json is absent (nothing to seed from)", () => {
    const configJson = JSON.stringify({ repositories: [] });

    const out = runStatic({
      [CONFIG_PATH]: configJson,
    });

    assert.equal(out[CONFIG_PATH], undefined);
  });

  it("no-op when mcp.json has no mcpServers section", () => {
    const configJson = JSON.stringify({ repositories: [] });

    const out = runStatic({
      [CONFIG_PATH]: configJson,
      [MCP_PATH]: JSON.stringify({}),
    });

    assert.equal(out[CONFIG_PATH], undefined);
  });

  it("skips registry seeding when config.json is malformed", () => {
    const out = runStatic({
      [CONFIG_PATH]: "not json",
    });
    assert.equal(out[CONFIG_PATH], undefined);
  });

  it("skips registry seeding when config.json is missing", () => {
    const out = runStatic({});
    assert.equal(out[CONFIG_PATH], undefined);
  });

  it("tolerates malformed mcp.json by seeding nothing", () => {
    const configJson = JSON.stringify({ repositories: [] });

    const out = runStatic({
      [CONFIG_PATH]: configJson,
      [MCP_PATH]: "not json",
    });

    assert.equal(out[CONFIG_PATH], undefined);
  });

  it("drops invalid operator entries (bad alwaysLoad/description) while seeding the rest", () => {
    const mcpJson = JSON.stringify({
      mcpServers: { sentry: {}, metabase: {} },
    });
    const configJson = JSON.stringify({
      repositories: [],
      mcpServers: {
        sentry: { alwaysLoad: "yes", description: "bad" },
        metabase: { alwaysLoad: false, description: "Good metabase" },
      },
    });

    const out = runStatic({
      [CONFIG_PATH]: configJson,
      [MCP_PATH]: mcpJson,
    });

    const written = asString(out[CONFIG_PATH]);
    assert.ok(written);
    const parsed = JSON.parse(written);
    // metabase preserved; sentry's invalid entry dropped and reseeded with TODO
    assert.equal(parsed.mcpServers.metabase.description, "Good metabase");
    assert.ok(parsed.mcpServers.sentry.description.startsWith("TODO"));
    assert.equal(parsed.mcpServers.sentry.alwaysLoad, false);
  });
});
