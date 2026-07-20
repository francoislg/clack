import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createSetRevealNarrativeTool } from "./setRevealNarrative.js";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { TriviaQuestion } from "../../core/types.js";
import type { TriviaIncludeRevealInQuestions } from "../../core/configTypes.js";

const SESSION = { sessionId: "test" };

function getGamesWith(mode: TriviaIncludeRevealInQuestions | undefined) {
  return () =>
    fixtureGetGames().map((g) =>
      g.name === FIXTURE_GAME_NAME && mode !== undefined
        ? { ...g, includeRevealInQuestions: mode }
        : g,
    );
}

function makeQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "q1",
    category: "C",
    statement: "stmt",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["🎯"],
    createdAt: 0,
    ...overrides,
  };
}

const block = (text: string) => ({
  type: "section" as const,
  text: { type: "mrkdwn" as const, text },
});

function tool(data: FakeTriviaDataLayer, mode: TriviaIncludeRevealInQuestions | undefined) {
  return createSetRevealNarrativeTool(data, getGamesWith(mode), () => ({}));
}

describe("set_reveal_narrative", () => {
  it("persists revealBlocks when the axis resolves yes (no Slack write)", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "q1" }));

    const res = parseToolResult(
      await tool(data, "yes").handler(
        { game: FIXTURE_GAME_NAME, questionId: "q1", revealBlocks: [block("why it's true")] },
        SESSION,
      ),
    );
    assert.equal(res.updated, true);
    const stored = (await scoped.loadQuestions()).find((q) => q.id === "q1");
    const blocks = stored?.revealBlocks;
    assert.ok(blocks);
    assert.equal(blocks.length, 1);
    assert.equal((blocks[0] as { text: { text: string } }).text.text, "why it's true");
  });

  it("overwrites rather than appends on re-call", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "q1" }));

    const t = tool(data, "yes");
    await t.handler(
      { game: FIXTURE_GAME_NAME, questionId: "q1", revealBlocks: [block("v1")] },
      SESSION,
    );
    await t.handler(
      { game: FIXTURE_GAME_NAME, questionId: "q1", revealBlocks: [block("v2a"), block("v2b")] },
      SESSION,
    );

    const stored = (await scoped.loadQuestions()).find((q) => q.id === "q1");
    const blocks = stored?.revealBlocks;
    assert.ok(blocks);
    assert.equal(blocks.length, 2);
    assert.equal((blocks[0] as { text: { text: string } }).text.text, "v2a");
  });

  it("rejects and writes nothing when the axis resolves no", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "q1" }));

    const out = await tool(data, "no").handler(
      { game: FIXTURE_GAME_NAME, questionId: "q1", revealBlocks: [block("nope")] },
      SESSION,
    );
    assert.equal(out.isError, true);
    const stored = (await scoped.loadQuestions()).find((q) => q.id === "q1");
    assert.equal(stored?.revealBlocks, undefined);
  });

  it("rejects when the axis is unset (default no)", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    await data.forGame(FIXTURE_GAME_NAME).saveQuestion(makeQuestion({ id: "q1" }));

    const out = await tool(data, undefined).handler(
      { game: FIXTURE_GAME_NAME, questionId: "q1", revealBlocks: [block("nope")] },
      SESSION,
    );
    assert.equal(out.isError, true);
  });

  it("errors when the question does not exist", async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer: data } = createTriviaDataLayer(sdk);
    const out = await tool(data, "yes").handler(
      { game: FIXTURE_GAME_NAME, questionId: "missing", revealBlocks: [block("x")] },
      SESSION,
    );
    assert.equal(out.isError, true);
  });
});
