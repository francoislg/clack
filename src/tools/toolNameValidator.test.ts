import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
import { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { setLoadedPlugins } from "../plugins/state.js";
import type { PluginLoadResult, RegisteredTool } from "../plugins/sdk.js";
import { CLACK_CORE_TOOL_NAMES, validateRequiredToolNames } from "./toolNameValidator.js";

/**
 * Scan the clack core tool directories for every `tool("<name>", ...)` registration and
 * return the unique set of tool names. Source of truth: the code itself.
 */
function discoverRegisteredCoreToolNames(): Set<string> {
  // Walk the whole tool tree instead of a hardcoded subdir list — any new subdir introduced
  // under src/tools/ will be picked up automatically. Worker tools (git_push, ensure_pr, etc.)
  // are registered in buildWorkerTools and are NOT part of the clack query surface, so they
  // are intentionally excluded from CLACK_CORE_TOOL_NAMES.
  const names = new Set<string>();
  const toolCallPattern = /return tool\(\s*"([a-z_][a-z0-9_]*)"/g;

  for (const file of walk(TEST_DIR)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    if (file.includes(join(TEST_DIR, "worker") + (process.platform === "win32" ? "\\" : "/")))
      continue;
    const src = readFileSync(file, "utf8");
    for (const match of src.matchAll(toolCallPattern)) {
      names.add(match[1]);
    }
  }
  return names;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function stubRegisteredTool(name: string): RegisteredTool {
  return {
    name,
    minRole: "member",
    pushTo: () => {},
  };
}

function stubPlugin(name: string, toolNames: string[]): PluginLoadResult {
  return {
    name,
    instructions: [],
    tools: toolNames.map((t) => stubRegisteredTool(t)),
    mcpServers: [],
    toolMappings: new Map(),
    mcpServer: createSdkMcpServer({ name, version: "1.0.0", tools: [] }),
    actionHandlers: [],
    viewHandlers: [],
    errors: [],
  };
}

describe("validateRequiredToolNames", () => {
  beforeEach(() => {
    setLoadedPlugins({ results: [] });
  });

  afterEach(() => {
    setLoadedPlugins({ results: [] });
  });

  it("accepts known clack core tools", () => {
    const result = validateRequiredToolNames([
      "mcp__clack__fetch_channel_messages",
      "mcp__clack__list_repositories",
    ]);
    assert.equal(result.valid, true);
    assert.deepEqual(result.unrecognized, []);
  });

  it("rejects bare tool names that lack the mcp prefix", () => {
    const result = validateRequiredToolNames(["fetch_channel_messages"]);
    assert.equal(result.valid, false);
    assert.deepEqual(result.unrecognized, ["fetch_channel_messages"]);
    assert.match(result.reasons[0], /fully-qualified MCP tool name/);
  });

  it("rejects misspelled clack core tools with a spelling hint", () => {
    const result = validateRequiredToolNames(["mcp__clack__fetch_channel_messgaes"]);
    assert.equal(result.valid, false);
    assert.equal(result.unrecognized.length, 1);
    assert.match(result.reasons[0], /fetch_channel_messgaes/);
    assert.match(result.reasons[0], /clack core tool/);
  });

  it("accepts plugin tools when the plugin is loaded and exports them", () => {
    setLoadedPlugins({ results: [stubPlugin("trivia", ["submit_answers", "save_question"])] });
    const result = validateRequiredToolNames([
      "mcp__trivia__submit_answers",
      "mcp__trivia__save_question",
    ]);
    assert.equal(result.valid, true);
  });

  it("parses plugin and tool names that contain underscores", () => {
    setLoadedPlugins({ results: [stubPlugin("my_plugin", ["my_long_tool_name"])] });
    const result = validateRequiredToolNames(["mcp__my_plugin__my_long_tool_name"]);
    assert.equal(result.valid, true);
  });

  it("rejects tools from plugins that are not loaded", () => {
    setLoadedPlugins({ results: [] });
    const result = validateRequiredToolNames(["mcp__weather__forecast"]);
    assert.equal(result.valid, false);
    assert.match(result.reasons[0], /plugin "weather" which is not currently loaded/);
  });

  it("rejects tool names that the named plugin does not export", () => {
    setLoadedPlugins({ results: [stubPlugin("trivia", ["submit_answers"])] });
    const result = validateRequiredToolNames(["mcp__trivia__no_such_tool"]);
    assert.equal(result.valid, false);
    assert.match(result.reasons[0], /plugin "trivia" does not export/);
    assert.match(result.reasons[0], /Available tools: submit_answers/);
  });

  it("collects multiple unrecognized entries with per-entry reasons", () => {
    const result = validateRequiredToolNames([
      "mcp__clack__list_repositories",
      "typo_no_prefix",
      "mcp__clack__not_a_tool",
    ]);
    assert.equal(result.valid, false);
    assert.equal(result.unrecognized.length, 2);
    assert.deepEqual(result.unrecognized, ["typo_no_prefix", "mcp__clack__not_a_tool"]);
  });

  it("treats an empty input array as valid", () => {
    const result = validateRequiredToolNames([]);
    assert.equal(result.valid, true);
    assert.deepEqual(result.unrecognized, []);
  });

  it("CLACK_CORE_TOOL_NAMES includes at least the well-known tools", () => {
    // Smoke test: if someone accidentally empties the list or removes a critical entry, this
    // test fails before the gate silently rejects every valid scheduled job.
    assert.ok(CLACK_CORE_TOOL_NAMES.includes("fetch_channel_messages"));
    assert.ok(CLACK_CORE_TOOL_NAMES.includes("submit_response"));
    assert.ok(CLACK_CORE_TOOL_NAMES.includes("list_repositories"));
  });

  it("CLACK_CORE_TOOL_NAMES matches every tool() registered under src/tools/{query,actions,presentation,admin}", () => {
    // Drift guard: scan the source for `return tool("<name>", ...)` calls and compare to
    // CLACK_CORE_TOOL_NAMES. If a new core tool is added without updating the list, this
    // fails with a clear diff — stopping the scheduled-message validator from rejecting a
    // valid tool name at save-time.
    const registered = discoverRegisteredCoreToolNames();
    const declared = new Set(CLACK_CORE_TOOL_NAMES);

    const missing = [...registered].filter((n) => !declared.has(n)).sort();
    const extra = [...declared].filter((n) => !registered.has(n)).sort();

    assert.deepEqual(
      missing,
      [],
      `CLACK_CORE_TOOL_NAMES is missing these registered tools: ${missing.join(", ")}`,
    );
    assert.deepEqual(
      extra,
      [],
      `CLACK_CORE_TOOL_NAMES has entries not registered in any factory: ${extra.join(", ")}`,
    );
  });
});
