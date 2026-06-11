import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createSdkDataLayer } from "./dataLayer.js";
import {
  _resetTriviaConfigBridge,
  _setTriviaConfigForTests,
  _setTriviaConfigSdkForTests,
} from "./configBridge.js";
import { fakeSdkUsers } from "../testHelpers.js";
import type { ClackSdk } from "../../sdk.js";
import type { TriviaConfig } from "./configTypes.js";

function makeMemorySdk(files: Map<string, string>): ClackSdk {
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
    readFile: async (path) => files.get(path) ?? null,
    writeFile: async (path, content) => {
      files.set(path, content);
    },
    watchFile: () => {
      throw new Error("watchFile not used in dataLayer tests");
    },
    reconcileCronJobs: async () => {},
    findOwnedCronJobs: async () => [],
    dmOwner: async () => ({ ok: true as const }),
    getSlackClient: () => null,
    sendMessage: async () => ({ ok: true as const, ts: "1", channel: "C" }),
    engageThread: async () => {},
    startThreadConversation: async () => {},
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
    users: fakeSdkUsers(),
  };
}

function primeConfig(config: TriviaConfig | null): Map<string, string> {
  const files = new Map<string, string>();
  _resetTriviaConfigBridge();
  _setTriviaConfigSdkForTests(makeMemorySdk(files));
  _setTriviaConfigForTests(config);
  return files;
}

describe("dataLayer — fallback season seed", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("seeds a season-YYYY-MM starter (no axis fields) for a config-edited game with no seasons.json", async () => {
    const files = primeConfig({ games: [], seasons: { enabled: true, prompt: "p" } });
    const data = createSdkDataLayer(makeMemorySdk(files));

    const state = await data.forGame("staging").loadSeasonsState();

    assert.ok(state !== null);
    assert.equal(state.seasons.length, 1);
    const entry = state.seasons[0];
    assert.match(entry.slug, /^season-\d{4}-\d{2}$/);
    assert.ok(entry.startedAt < entry.expectedEndAt);
    assert.equal(entry.categories, undefined);
    assert.equal(entry.format, undefined);
    assert.equal(entry.answersFormat, undefined);
    assert.equal(entry.theme, undefined);
    assert.ok(files.has("games/staging/seasons.json"));
  });

  it("returns null and writes nothing when seasons are disabled", async () => {
    const files = primeConfig({ games: [] });
    const data = createSdkDataLayer(makeMemorySdk(files));

    assert.equal(await data.forGame("staging").loadSeasonsState(), null);
    assert.equal(files.has("games/staging/seasons.json"), false);
  });

  it("does not re-seed when a seasons.json already exists", async () => {
    const files = primeConfig({ games: [], seasons: { enabled: true, prompt: "p" } });
    const sdk = makeMemorySdk(files);
    files.set(
      "games/staging/seasons.json",
      JSON.stringify({ seasons: [{ slug: "kickoff-2026", startedAt: 1, expectedEndAt: 2 }] }),
    );
    const data = createSdkDataLayer(sdk);

    const state = await data.forGame("staging").loadSeasonsState();

    assert.deepEqual(state, {
      seasons: [{ slug: "kickoff-2026", startedAt: 1, expectedEndAt: 2 }],
    });
  });
});
