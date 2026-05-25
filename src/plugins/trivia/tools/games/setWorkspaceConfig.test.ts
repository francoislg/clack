import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createSetWorkspaceConfigTool } from "./setWorkspaceConfig.js";
import {
  _resetTriviaConfigBridge,
  _setTriviaConfigForTests,
  _setTriviaConfigSdkForTests,
  loadTriviaConfig,
} from "../../core/configBridge.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { ClackSdk } from "../../../sdk.js";
import type { TriviaConfig } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

function makeFakeSdk(): ClackSdk {
  return {
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    addInstruction: () => {},
    addTopicInstruction: () => {},
    registerTool: () => {},
    readFile: async () => null,
    writeFile: async () => {},
    watchFile: () => {
      throw new Error("watchFile not used in set_workspace_config tests");
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
  };
}

function primeBridge(initial: TriviaConfig | null): void {
  _resetTriviaConfigBridge();
  _setTriviaConfigSdkForTests(makeFakeSdk());
  _setTriviaConfigForTests(initial);
}

const emptyArgs = {
  answersFormat: undefined,
  questionType: undefined,
  freeformAnswerShape: undefined,
  contexts: undefined,
  difficulty: undefined,
  choices: undefined,
  offDays: undefined,
  seasons: undefined,
};

describe("set_workspace_config", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("sets workspace answersFormat", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    const result = parseToolResult(
      await tool.handler({ ...emptyArgs, answersFormat: { boolean: 2, choice: 1 } }, SESSION),
    );
    assert.equal(result.action, "updated");
    assert.ok(result.updatedFields.includes("answersFormat"));
    assert.deepEqual(loadTriviaConfig()?.answersFormat, { boolean: 2, choice: 1, freeform: 0 });
  });

  it("clears workspace field with null", async () => {
    primeBridge({ answersFormat: { boolean: 1, choice: 1, freeform: 0 } });
    const tool = createSetWorkspaceConfigTool();
    await tool.handler({ ...emptyArgs, answersFormat: null }, SESSION);
    assert.equal(loadTriviaConfig()?.answersFormat, undefined);
  });

  it("omit-to-keep preserves untouched fields", async () => {
    primeBridge({
      answersFormat: { boolean: 1, choice: 0, freeform: 0 },
      choices: { min: 3, max: 4 },
    });
    const tool = createSetWorkspaceConfigTool();
    await tool.handler({ ...emptyArgs, questionType: { fact: 0, topical: 1 } }, SESSION);
    const cfg = loadTriviaConfig();
    assert.deepEqual(cfg?.answersFormat, { boolean: 1, choice: 0, freeform: 0 });
    assert.deepEqual(cfg?.choices, { min: 3, max: 4 });
    assert.deepEqual(cfg?.questionType, { fact: 0, topical: 1 });
  });

  it("rejects empty update", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    const result = parseToolResult(await tool.handler(emptyArgs, SESSION));
    assert.match(result.error, /no fields to update/);
  });

  it("rejects invalid choices (min > max)", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    const result = parseToolResult(
      await tool.handler({ ...emptyArgs, choices: { min: 4, max: 2 } }, SESSION),
    );
    assert.match(result.error, /min.*> max|must be <= max/);
  });

  it("rejects invalid axis (all-zero weights)", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    const result = parseToolResult(
      await tool.handler(
        { ...emptyArgs, answersFormat: { boolean: 0, choice: 0, freeform: 0 } },
        SESSION,
      ),
    );
    assert.match(result.error, /at least one strictly positive weight/);
  });

  it("toggles seasons feature on", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    await tool.handler(
      { ...emptyArgs, seasons: { enabled: true, prompt: "Monthly themed seasons" } },
      SESSION,
    );
    assert.deepEqual(loadTriviaConfig()?.seasons, {
      enabled: true,
      prompt: "Monthly themed seasons",
    });
  });

  it("rejects enabling seasons with empty prompt", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    const result = parseToolResult(
      await tool.handler({ ...emptyArgs, seasons: { enabled: true, prompt: "   " } }, SESSION),
    );
    assert.match(result.error, /seasons\.prompt is empty/);
  });

  it("updates multiple fields atomically", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    const result = parseToolResult(
      await tool.handler(
        {
          ...emptyArgs,
          answersFormat: { boolean: 1, choice: 1 },
          choices: { min: 3, max: 4 },
        },
        SESSION,
      ),
    );
    assert.equal(result.updatedFields.length, 2);
    assert.ok(result.updatedFields.includes("answersFormat"));
    assert.ok(result.updatedFields.includes("choices"));
  });

  it("rejects malformed offDays entries", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    const result = parseToolResult(
      await tool.handler(
        { ...emptyArgs, offDays: [{ date: "not-a-date", label: "Bad" }] },
        SESSION,
      ),
    );
    assert.match(result.error, /Some offDays entries are invalid/);
  });

  it("accepts valid offDays", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    const result = parseToolResult(
      await tool.handler(
        {
          ...emptyArgs,
          offDays: [
            { date: "12-25", label: "Christmas" },
            { date: "2026-04-03", label: "Good Friday 2026" },
          ],
        },
        SESSION,
      ),
    );
    assert.equal(result.action, "updated");
    assert.equal(loadTriviaConfig()?.offDays?.length, 2);
  });
});
