import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createSetWorkspaceConfigTool } from "./setWorkspaceConfig.js";
import {
  _resetTriviaConfigBridge,
  _setTriviaConfigForTests,
  _setTriviaConfigSdkForTests,
  loadTriviaConfig,
} from "../../core/configBridge.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import { createFakeSdk } from "../../testHelpers.js";
import type { TriviaConfig } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

function primeBridge(initial: TriviaConfig | null): void {
  _resetTriviaConfigBridge();
  _setTriviaConfigSdkForTests(createFakeSdk());
  _setTriviaConfigForTests(initial);
}

const emptyArgs = {
  answersFormat: undefined,
  questionType: undefined,
  freeformAnswerShape: undefined,
  contexts: undefined,
  difficulty: undefined,
  difficultyRatio: undefined,
  choices: undefined,
  offDays: undefined,
  seasons: undefined,
  liveAnswersVisible: undefined,
  revealResponses: undefined,
  instructions: undefined,
  additionalInstructions: undefined,
  hint: undefined,
  allTimeRow: undefined,
  tagPlayers: undefined,
  includeRevealInQuestions: undefined,
  finalRevealSummary: undefined,
  judgeLeniency: undefined,
  tellMeMore: undefined,
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

  it("sets and clears workspace tellMeMore", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    const set = parseToolResult(
      await tool.handler({ ...emptyArgs, tellMeMore: { enabled: true } }, SESSION),
    );
    assert.ok(set.updatedFields.includes("tellMeMore"));
    assert.deepEqual(loadTriviaConfig()?.tellMeMore, { enabled: true });

    await tool.handler({ ...emptyArgs, tellMeMore: null }, SESSION);
    assert.equal(loadTriviaConfig()?.tellMeMore, undefined);
  });

  it("sets and clears workspace includeRevealInQuestions", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    const set = parseToolResult(
      await tool.handler({ ...emptyArgs, includeRevealInQuestions: "yes" }, SESSION),
    );
    assert.ok(set.updatedFields.includes("includeRevealInQuestions"));
    assert.equal(loadTriviaConfig()?.includeRevealInQuestions, "yes");

    await tool.handler({ ...emptyArgs, includeRevealInQuestions: null }, SESSION);
    assert.equal(loadTriviaConfig()?.includeRevealInQuestions, undefined);
  });

  it("sets and clears workspace tagPlayers", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    const set = parseToolResult(await tool.handler({ ...emptyArgs, tagPlayers: false }, SESSION));
    assert.ok(set.updatedFields.includes("tagPlayers"));
    assert.equal(loadTriviaConfig()?.tagPlayers, false);

    await tool.handler({ ...emptyArgs, tagPlayers: null }, SESSION);
    assert.equal(loadTriviaConfig()?.tagPlayers, undefined);
  });

  it("sets and clears workspace finalRevealSummary", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    const set = parseToolResult(
      await tool.handler({ ...emptyArgs, finalRevealSummary: "in-thread" }, SESSION),
    );
    assert.ok(set.updatedFields.includes("finalRevealSummary"));
    assert.equal(loadTriviaConfig()?.finalRevealSummary, "in-thread");

    await tool.handler({ ...emptyArgs, finalRevealSummary: null }, SESSION);
    assert.equal(loadTriviaConfig()?.finalRevealSummary, undefined);
  });

  it("sets and clears workspace judgeLeniency", async () => {
    primeBridge({});
    const tool = createSetWorkspaceConfigTool();
    const set = parseToolResult(
      await tool.handler({ ...emptyArgs, judgeLeniency: "lenient" }, SESSION),
    );
    assert.ok(set.updatedFields.includes("judgeLeniency"));
    assert.equal(loadTriviaConfig()?.judgeLeniency, "lenient");

    await tool.handler({ ...emptyArgs, judgeLeniency: null }, SESSION);
    assert.equal(loadTriviaConfig()?.judgeLeniency, undefined);
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
    assert.deepEqual(cfg?.questionType, { fact: 0, topical: 1, prediction: 0 });
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

  describe("instructions and additionalInstructions", () => {
    it("sets both workspace-tier fields", async () => {
      primeBridge({});
      const tool = createSetWorkspaceConfigTool();
      await tool.handler(
        {
          ...emptyArgs,
          instructions: "Be funny.",
          additionalInstructions: "Avoid politics.",
        },
        SESSION,
      );
      const cfg = loadTriviaConfig();
      assert.equal(cfg?.instructions, "Be funny.");
      assert.equal(cfg?.additionalInstructions, "Avoid politics.");
    });

    it("null clears the named field, preserves the other", async () => {
      primeBridge({ instructions: "Be funny.", additionalInstructions: "Avoid politics." });
      const tool = createSetWorkspaceConfigTool();
      await tool.handler({ ...emptyArgs, instructions: null }, SESSION);
      const cfg = loadTriviaConfig();
      assert.equal(cfg?.instructions, undefined);
      assert.equal(cfg?.additionalInstructions, "Avoid politics.");
    });

    it("omit-to-keep — only the passed field changes", async () => {
      primeBridge({ instructions: "Be funny." });
      const tool = createSetWorkspaceConfigTool();
      await tool.handler({ ...emptyArgs, additionalInstructions: "Avoid politics." }, SESSION);
      const cfg = loadTriviaConfig();
      assert.equal(cfg?.instructions, "Be funny.");
      assert.equal(cfg?.additionalInstructions, "Avoid politics.");
    });

    it("rejects empty / whitespace-only strings", async () => {
      primeBridge({});
      const tool = createSetWorkspaceConfigTool();
      const result = parseToolResult(
        await tool.handler({ ...emptyArgs, instructions: "   " }, SESSION),
      );
      assert.match(result.error, /instructions.*non-empty/);
    });

    it("trims input on the way in", async () => {
      primeBridge({});
      const tool = createSetWorkspaceConfigTool();
      await tool.handler({ ...emptyArgs, instructions: "  Be dry.  " }, SESSION);
      assert.equal(loadTriviaConfig()?.instructions, "Be dry.");
    });
  });
});
