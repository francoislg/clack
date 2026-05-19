import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildGameSpecs } from "./buildGameSpecs.js";
import type { TriviaGame } from "../../config.js";

const baseGame: TriviaGame = {
  name: "ops",
  channel: "C1",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

describe("buildGameSpecs", () => {
  it("returns an empty list when no games supplied", () => {
    const specs = buildGameSpecs([], false);
    assert.deepEqual(specs, []);
  });

  it("produces two specs per game with stable specKeys", () => {
    const specs = buildGameSpecs([baseGame], false);
    assert.equal(specs.length, 2);
    assert.equal(specs[0].specKey, "ops:question");
    assert.equal(specs[1].specKey, "ops:reveal");
  });

  it("question spec carries question cron + channel + timezone", () => {
    const [question] = buildGameSpecs([baseGame], false);
    assert.equal(question.cronExpression, "0 9 * * 1-5");
    assert.equal(question.channel, "C1");
    assert.equal(question.timezone, "America/Montreal");
  });

  it("reveal spec carries reveal cron", () => {
    const [, reveal] = buildGameSpecs([baseGame], false);
    assert.equal(reveal.cronExpression, "0 15 * * 1-5");
  });

  it("question spec has the expected base requiredTools regardless of seasons", () => {
    const [withSeasons] = buildGameSpecs([baseGame], true);
    const [withoutSeasons] = buildGameSpecs([baseGame], false);
    const expected = [
      "mcp__trivia__get_ideas",
      "mcp__trivia__find_previous_questions",
      "mcp__trivia__save_question",
    ];
    assert.deepEqual(withSeasons.requiredTools, expected);
    assert.deepEqual(withoutSeasons.requiredTools, expected);
  });

  it("reveal spec omits check_season_status when seasons disabled", () => {
    const [, reveal] = buildGameSpecs([baseGame], false);
    assert.ok(reveal.requiredTools);
    assert.ok(!reveal.requiredTools.includes("mcp__trivia__check_season_status"));
  });

  it("reveal spec includes check_season_status when seasons enabled", () => {
    const [, reveal] = buildGameSpecs([baseGame], true);
    assert.ok(reveal.requiredTools);
    assert.ok(reveal.requiredTools.includes("mcp__trivia__check_season_status"));
  });

  it("reveal spec NEVER includes upsert_season or delete_season (conditional tools)", () => {
    const [, reveal] = buildGameSpecs([baseGame], true);
    assert.ok(reveal.requiredTools);
    assert.ok(!reveal.requiredTools.includes("mcp__trivia__upsert_season"));
    assert.ok(!reveal.requiredTools.includes("mcp__trivia__delete_season"));
  });

  it("question prompt is non-empty and contains the boolean+choice path text", () => {
    const [question] = buildGameSpecs([baseGame], false);
    assert.ok(question.prompt.length > 100);
    assert.match(question.prompt, /BOOLEAN PATH/);
    assert.match(question.prompt, /CHOICE PATH/);
  });

  it("reveal prompt is seasons-aware", () => {
    const [, off] = buildGameSpecs([baseGame], false);
    const [, on] = buildGameSpecs([baseGame], true);
    // The seasons-on variant injects extra steps for season status / leaderboard rendering.
    assert.notEqual(off.prompt, on.prompt);
    assert.match(on.prompt, /check_season_status/);
    assert.doesNotMatch(off.prompt, /check_season_status/);
  });

  it("three games produce six specs in matching order", () => {
    const games: TriviaGame[] = [
      { ...baseGame, name: "a", channel: "C1" },
      { ...baseGame, name: "b", channel: "C2" },
      { ...baseGame, name: "c", channel: "C3" },
    ];
    const specs = buildGameSpecs(games, false);
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
      const specs = buildGameSpecs(games, false, offDays);
      assert.equal(specs.length, 4);
      for (const spec of specs) {
        assert.deepEqual(spec.skipDates, offDays);
      }
    });

    it("emits no skipDates field when offDays is undefined", () => {
      const [question, reveal] = buildGameSpecs([baseGame], false);
      assert.equal(question.skipDates, undefined);
      assert.equal(reveal.skipDates, undefined);
    });

    it("emits no skipDates field when offDays is an empty array", () => {
      const [question, reveal] = buildGameSpecs([baseGame], false, []);
      assert.equal(question.skipDates, undefined);
      assert.equal(reveal.skipDates, undefined);
    });
  });
});
