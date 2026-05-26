/**
 * End-to-end smoke test for the relocation pipeline. Drives migration 022 →
 * bridge load → mutation tools → reload-from-disk against a real on-disk
 * temp directory. Catches anything that a unit-test alone wouldn't:
 *
 * - The migration's writes are JSON-parseable + idempotent on a second pass
 * - The bridge's SDK readFile/writeFile actually round-trip through disk
 * - upsert_game / delete_game / set_workspace_config writes survive a process
 *   restart (modeled here as a fresh bridge init against the same files)
 */

import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  watch as fsWatch,
  writeFileSync,
  type FSWatcher,
} from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { relocateTriviaConfig } from "../../../migrations/022-trivia-config-to-plugin.js";
import {
  _resetTriviaConfigBridge,
  defaultGetGames,
  initTriviaConfigBridge,
  loadTriviaConfig,
  saveTriviaConfig,
} from "./configBridge.js";
import { createUpsertGameTool } from "../tools/games/upsertGame.js";
import { createDeleteGameTool } from "../tools/games/deleteGame.js";
import { createSetWorkspaceConfigTool } from "../tools/games/setWorkspaceConfig.js";
import { parseToolResult } from "../../../tools/testHelpers.js";
import type { ClackSdk } from "../../sdk.js";

const SESSION = { sessionId: "test" };

function makeSdkOverRealDir(pluginDataDir: string): ClackSdk {
  return {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    capabilities: { crons: true },
    error: () => {},
    addInstruction: () => {},
    addTopicInstruction: () => {},
    registerTool: () => {},
    mcpServer: { fullName: "test", registerTool: () => {}, addTopicInstruction: () => {} },
    registerMcpServer: () => ({
      fullName: "test",
      registerTool: () => {},
      addTopicInstruction: () => {},
    }),
    readFile: async (path) => {
      const full = join(pluginDataDir, path);
      if (!existsSync(full)) return null;
      return readFileSync(full, "utf-8");
    },
    writeFile: async (path, content) => {
      const full = join(pluginDataDir, path);
      const dir = resolve(full, "..");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(full, content, "utf-8");
    },
    watchFile: (path): FSWatcher => {
      // Watch the real file in the temp dir. The bridge passes a relative
      // path; the SDK resolves it under the plugin's data dir.
      const full = join(pluginDataDir, path);
      if (!existsSync(full)) writeFileSync(full, "{}", "utf-8");
      return fsWatch(full);
    },
    reconcileCronJobs: async () => {},
    dmOwner: async () => ({ ok: true as const }),
    getSlackClient: () => null,
    registerAction: () => {},
    registerView: () => {},
    actionId: (key: string) => `plugin:test:${key}`,
    viewCallbackId: (key: string) => `plugin:test:${key}`,
    askClaude: async () => ({
      text: "",
      stopReason: "end_turn",
      usage: { inputTokens: 0, outputTokens: 0 },
    }),
    requestSoftRestart: () => {},
    registerDictionary: () => {},
    t: (key: string) => key,
  };
}

interface OnDiskPluginConfigShape {
  answersFormat?: { boolean?: number; choice?: number; freeform?: number };
  questionType?: { fact?: number; topical?: number };
  seasons?: { enabled: boolean; prompt: string };
  games?: {
    name: string;
    channel?: string;
    answersFormat?: { boolean?: number; choice?: number; freeform?: number };
  }[];
}

function readPluginConfig(pluginDataDir: string): OnDiskPluginConfigShape {
  const raw = readFileSync(join(pluginDataDir, "config.json"), "utf-8");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("plugin config file is not an object");
  }
  return parsed as OnDiskPluginConfigShape;
}

describe("trivia config relocation — end-to-end smoke", () => {
  let tmpDir: string;
  let pluginDataDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "clack-trivia-smoke-"));
    pluginDataDir = join(tmpDir, "data", "plugins", "trivia");
    mkdirSync(pluginDataDir, { recursive: true });
    _resetTriviaConfigBridge();
  });

  afterEach(() => {
    _resetTriviaConfigBridge();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("migration 022 → bridge init → tool writes survive process restart", async () => {
    // 1. Seed pre-relocation state: data/config.json has the legacy trivia block.
    const configPath = join(tmpDir, "data", "config.json");
    mkdirSync(resolve(configPath, ".."), { recursive: true });
    const legacyConfig = {
      slack: { token: "x" },
      trivia: {
        seasons: { enabled: false, prompt: "" },
        answersFormat: { boolean: 2, choice: 1 },
        games: [
          {
            name: "main",
            channel: "C100000000",
            questionCron: "0 9 * * *",
            revealCron: "0 17 * * *",
            timezone: "UTC",
          },
        ],
      },
    };
    writeFileSync(configPath, JSON.stringify(legacyConfig, null, 2));

    // 2. Run migration 022 against the seeded state.
    const pluginConfigPath = join(pluginDataDir, "config.json");
    const result = relocateTriviaConfig({
      "data/config.json": readFileSync(configPath, "utf-8"),
      "data/plugins/trivia/config.json": null,
    });
    assert.ok(result["data/plugins/trivia/config.json"]);
    assert.ok(result["data/config.json"]);
    const pluginWritten = result["data/plugins/trivia/config.json"];
    if (typeof pluginWritten !== "string") throw new Error("expected string");
    writeFileSync(pluginConfigPath, pluginWritten);
    const mainWritten = result["data/config.json"];
    if (typeof mainWritten !== "string") throw new Error("expected string");
    writeFileSync(configPath, mainWritten);

    // 3. Boot the bridge — it should read the relocated plugin file.
    const sdk = makeSdkOverRealDir(pluginDataDir);
    await initTriviaConfigBridge(sdk);
    const initial = loadTriviaConfig();
    assert.ok(initial);
    assert.deepEqual(initial.answersFormat, { boolean: 2, choice: 1, freeform: 0 });
    assert.equal(initial.games?.length, 1);
    assert.equal(initial.games?.[0]?.name, "main");

    // 4. upsert_game adds a new game.
    const upsertGame = createUpsertGameTool(defaultGetGames);
    const upsertResult = parseToolResult(
      await upsertGame.handler(
        {
          name: "engineering",
          channel: "C200000000",
          questionCron: "0 10 * * *",
          revealCron: "0 18 * * *",
          timezone: "America/Montreal",
          enabled: undefined,
          answersFormat: { boolean: 0, choice: 1 },
          questionType: undefined,
          freeformAnswerShape: undefined,
          contexts: undefined,
          difficulty: undefined,
          difficultyRatio: undefined,
          format: undefined,
          categories: undefined,
          theme: undefined,
          liveAnswersVisible: undefined,
          revealResponses: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(upsertResult.action, "created");

    const afterUpsert = readPluginConfig(pluginDataDir);
    assert.equal(afterUpsert.games?.length, 2);
    const engineering = afterUpsert.games?.find((g) => g.name === "engineering");
    assert.ok(engineering);
    assert.equal(engineering.answersFormat?.choice, 1);

    // 5. set_workspace_config flips seasons on.
    const setWorkspaceConfig = createSetWorkspaceConfigTool();
    await setWorkspaceConfig.handler(
      {
        answersFormat: undefined,
        questionType: undefined,
        freeformAnswerShape: undefined,
        contexts: undefined,
        difficulty: undefined,
        difficultyRatio: undefined,
        choices: undefined,
        offDays: undefined,
        seasons: { enabled: true, prompt: "Monthly" },
        liveAnswersVisible: undefined,
        revealResponses: undefined,
      },
      SESSION,
    );
    const afterSeasons = readPluginConfig(pluginDataDir);
    assert.equal(afterSeasons.seasons?.enabled, true);
    assert.equal(afterSeasons.seasons?.prompt, "Monthly");

    // 6. Simulate process restart: reset, re-init, verify persistence.
    _resetTriviaConfigBridge();
    const sdk2 = makeSdkOverRealDir(pluginDataDir);
    await initTriviaConfigBridge(sdk2);
    const reloaded = loadTriviaConfig();
    assert.ok(reloaded);
    assert.equal(reloaded.games?.length, 2);
    assert.equal(reloaded.seasons?.enabled, true);

    // 7. delete_game removes engineering.
    const deleteGame = createDeleteGameTool(defaultGetGames);
    await deleteGame.handler({ name: "engineering" }, SESSION);
    const afterDelete = readPluginConfig(pluginDataDir);
    assert.equal(afterDelete.games?.length, 1);
    assert.equal(afterDelete.games?.[0]?.name, "main");
  });

  it("migration 022 second run is a no-op (idempotency)", () => {
    const configPath = join(tmpDir, "data", "config.json");
    mkdirSync(resolve(configPath, ".."), { recursive: true });
    const postMigrationConfig = { slack: { token: "x" } };
    writeFileSync(configPath, JSON.stringify(postMigrationConfig, null, 2));
    const pluginConfigPath = join(pluginDataDir, "config.json");
    writeFileSync(pluginConfigPath, JSON.stringify({ games: [] }));

    const result = relocateTriviaConfig({
      "data/config.json": readFileSync(configPath, "utf-8"),
      "data/plugins/trivia/config.json": readFileSync(pluginConfigPath, "utf-8"),
    });
    assert.deepEqual(result, {}, "second run should be a no-op");
  });

  it("saveTriviaConfig round-trips through disk", async () => {
    const sdk = makeSdkOverRealDir(pluginDataDir);
    await initTriviaConfigBridge(sdk);
    await saveTriviaConfig({ answersFormat: { boolean: 1, choice: 0, freeform: 0 } });
    await saveTriviaConfig({
      answersFormat: { boolean: 0, choice: 1, freeform: 0 },
      games: [],
    });
    const parsed = readPluginConfig(pluginDataDir);
    assert.equal(parsed.answersFormat?.choice, 1);
    assert.equal(parsed.games?.length, 0);
  });
});
