import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildGameSpecs } from "./buildGameSpecs.js";
import type { TriviaGame } from "../../../config.js";

const baseGame: TriviaGame = {
  name: "ops",
  channel: "C1",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

describe("buildGameSpecs", () => {
  it("returns an empty list when no games supplied", () => {
    const specs = buildGameSpecs([]);
    assert.deepEqual(specs, []);
  });

  it("produces two specs per game with stable specKeys", () => {
    const specs = buildGameSpecs([baseGame]);
    assert.equal(specs.length, 2);
    assert.equal(specs[0].specKey, "ops:question");
    assert.equal(specs[1].specKey, "ops:reveal");
  });

  it("question spec carries question cron + channel + timezone", () => {
    const [question] = buildGameSpecs([baseGame]);
    assert.equal(question.cronExpression, "0 9 * * 1-5");
    assert.equal(question.channel, "C1");
    assert.equal(question.timezone, "America/Montreal");
  });

  it("reveal spec carries reveal cron", () => {
    const [, reveal] = buildGameSpecs([baseGame]);
    assert.equal(reveal.cronExpression, "0 15 * * 1-5");
  });

  it("question spec has the expected requiredTools", () => {
    const [question] = buildGameSpecs([baseGame]);
    const expected = [
      "mcp__trivia__get_ideas",
      "mcp__trivia__find_previous_questions",
      "mcp__trivia__save_question",
      "mcp__trivia__post_questions",
    ];
    assert.deepEqual(question.requiredTools, expected);
  });

  it("reveal spec requiredTools is the single-tool list", () => {
    const [, reveal] = buildGameSpecs([baseGame]);
    assert.deepEqual(reveal.requiredTools, ["mcp__trivia__process_reveal_answers"]);
  });

  it("question spec sets submitResponseMode to 'skipped'", () => {
    const [question] = buildGameSpecs([baseGame]);
    assert.equal(question.submitResponseMode, "skipped");
  });

  it("reveal spec does NOT set submitResponseMode (reveal renders a real message)", () => {
    const [, reveal] = buildGameSpecs([baseGame]);
    assert.equal(reveal.submitResponseMode, undefined);
  });

  it("reveal spec NEVER includes the absorbed tools or conditional season tools", () => {
    const [, reveal] = buildGameSpecs([baseGame]);
    assert.ok(reveal.requiredTools);
    assert.ok(!reveal.requiredTools.includes("mcp__clack__fetch_channel_messages"));
    assert.ok(!reveal.requiredTools.includes("mcp__trivia__find_previous_questions"));
    assert.ok(!reveal.requiredTools.includes("mcp__trivia__get_question_history"));
    assert.ok(!reveal.requiredTools.includes("mcp__trivia__submit_answers"));
    assert.ok(!reveal.requiredTools.includes("mcp__trivia__retrieve_scores"));
    assert.ok(!reveal.requiredTools.includes("mcp__trivia__check_season_status"));
    assert.ok(!reveal.requiredTools.includes("mcp__trivia__upsert_season"));
    assert.ok(!reveal.requiredTools.includes("mcp__trivia__delete_season"));
    assert.ok(!reveal.requiredTools.includes("mcp__trivia__post_questions"));
  });

  it("question prompt is non-empty and contains the boolean+choice path text", () => {
    const [question] = buildGameSpecs([baseGame]);
    assert.ok(question.prompt.length > 100);
    assert.match(question.prompt, /BOOLEAN PATH/);
    assert.match(question.prompt, /CHOICE PATH/);
  });

  it("reveal prompt is a renderer brief referencing process_reveal_answers", () => {
    const [, reveal] = buildGameSpecs([baseGame]);
    assert.match(reveal.prompt, /process_reveal_answers/);
    // Does NOT enumerate categorization/cheater steps — those moved into the tool.
    assert.doesNotMatch(reveal.prompt, /Call submit_answers/);
    assert.doesNotMatch(reveal.prompt, /Call retrieve_scores/);
  });

  it("output is independent of seasons state (pure function of TriviaGame[])", () => {
    // buildGameSpecs must NOT peek into any per-game seasons.json — its inputs are
    // only `games` and the optional `offDays`. Format-driven branching happens at run
    // time via the get_ideas payload, not at cron-spec build time. This test pins the
    // contract so adding seasons-aware logic later requires an intentional change here.
    const a = buildGameSpecs([baseGame]);
    const b = buildGameSpecs([baseGame]);
    assert.deepEqual(a, b);
    // Same call signature → identical output, regardless of any external state changes.
    assert.equal(a[0].prompt, b[0].prompt);
    assert.deepEqual(a[0].requiredTools, b[0].requiredTools);
  });

  it("three games produce six specs in matching order", () => {
    const games: TriviaGame[] = [
      { ...baseGame, name: "a", channel: "C1" },
      { ...baseGame, name: "b", channel: "C2" },
      { ...baseGame, name: "c", channel: "C3" },
    ];
    const specs = buildGameSpecs(games);
    assert.equal(specs.length, 6);
    assert.deepEqual(
      specs.map((s) => s.specKey),
      ["a:question", "a:reveal", "b:question", "b:reveal", "c:question", "c:reveal"],
    );
  });

  describe("offDays propagation", () => {
    it("propagates offDays into every emitted spec's skipDates", () => {
      const offDays = [
        { date: "12-25", label: "Christmas" },
        { date: "01-01", label: "New Year's Day" },
      ];
      const games: TriviaGame[] = [
        { ...baseGame, name: "a", channel: "C1" },
        { ...baseGame, name: "b", channel: "C2" },
      ];
      const specs = buildGameSpecs(games, offDays);
      assert.equal(specs.length, 4);
      for (const spec of specs) {
        assert.deepEqual(spec.skipDates, offDays);
      }
    });

    it("emits no skipDates field when offDays is undefined", () => {
      const [question, reveal] = buildGameSpecs([baseGame]);
      assert.equal(question.skipDates, undefined);
      assert.equal(reveal.skipDates, undefined);
    });

    it("emits no skipDates field when offDays is an empty array", () => {
      const [question, reveal] = buildGameSpecs([baseGame], []);
      assert.equal(question.skipDates, undefined);
      assert.equal(reveal.skipDates, undefined);
    });
  });
});
