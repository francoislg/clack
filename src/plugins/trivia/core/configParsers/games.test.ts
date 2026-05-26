import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseTriviaGames } from "./games.js";

const validBase = {
  name: "main",
  channel: "C123",
  questionCron: "0 9 * * 1-5",
  revealCron: "0 15 * * 1-5",
  timezone: "America/Montreal",
};

describe("parseTriviaGames — per-game format / categories / theme", () => {
  describe("format", () => {
    it("accepts a valid format and stores it on the game", () => {
      const { games, issues } = parseTriviaGames([
        {
          ...validBase,
          format: { questions: [{ label: "Warmup" }, { label: "Choice" }] },
        },
      ]);
      assert.equal(issues.length, 0);
      assert.equal(games?.length, 1);
      assert.deepEqual(games?.[0].format, {
        questions: [{ label: "Warmup" }, { label: "Choice" }],
      });
    });

    it("drops the field when format.questions is empty", () => {
      const { games, issues } = parseTriviaGames([{ ...validBase, format: { questions: [] } }]);
      assert.equal(games?.length, 1);
      assert.equal(games?.[0].format, undefined);
      assert.equal(issues.length, 1);
      assert.equal(issues[0].field, "trivia.games[0].format");
      assert.match(issues[0].error, /non-empty array/);
    });

    it("drops the field when format is not an object", () => {
      const { games, issues } = parseTriviaGames([{ ...validBase, format: "nope" }]);
      assert.equal(games?.length, 1);
      assert.equal(games?.[0].format, undefined);
      assert.equal(issues[0].field, "trivia.games[0].format");
    });
  });

  describe("categories", () => {
    it("accepts a deduped, trimmed list", () => {
      const { games, issues } = parseTriviaGames([
        { ...validBase, categories: ["History", " Sports ", "History", " "] },
      ]);
      assert.equal(issues.length, 0);
      assert.deepEqual(games?.[0].categories, ["History", "Sports"]);
    });

    it("drops the field when categories is empty", () => {
      const { games, issues } = parseTriviaGames([{ ...validBase, categories: [] }]);
      assert.equal(games?.length, 1);
      assert.equal(games?.[0].categories, undefined);
      assert.equal(issues[0].field, "trivia.games[0].categories");
    });

    it("drops the field when every entry is blank", () => {
      const { games, issues } = parseTriviaGames([{ ...validBase, categories: [" ", ""] }]);
      assert.equal(games?.length, 1);
      assert.equal(games?.[0].categories, undefined);
      assert.match(issues[0].error, /at least one non-empty/);
    });

    it("drops the field when categories is not an array", () => {
      const { games, issues } = parseTriviaGames([{ ...validBase, categories: "History" }]);
      assert.equal(games?.length, 1);
      assert.equal(games?.[0].categories, undefined);
      assert.equal(issues[0].field, "trivia.games[0].categories");
    });
  });

  describe("theme", () => {
    it("accepts a trimmed non-empty string", () => {
      const { games, issues } = parseTriviaGames([
        { ...validBase, theme: "  Channel Lore Trivia  " },
      ]);
      assert.equal(issues.length, 0);
      assert.equal(games?.[0].theme, "Channel Lore Trivia");
    });

    it("drops the field when theme is whitespace-only", () => {
      const { games, issues } = parseTriviaGames([{ ...validBase, theme: "   " }]);
      assert.equal(games?.length, 1);
      assert.equal(games?.[0].theme, undefined);
      assert.match(issues[0].error, /non-empty after trim/);
    });

    it("drops the field when theme is not a string", () => {
      const { games, issues } = parseTriviaGames([{ ...validBase, theme: 123 }]);
      assert.equal(games?.length, 1);
      assert.equal(games?.[0].theme, undefined);
      assert.equal(issues[0].field, "trivia.games[0].theme");
    });
  });

  it("invalid optional fields do not drop the whole entry", () => {
    const { games, issues } = parseTriviaGames([
      {
        ...validBase,
        format: { questions: [] },
        categories: [],
        theme: "  ",
      },
    ]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].name, "main");
    assert.equal(games?.[0].format, undefined);
    assert.equal(games?.[0].categories, undefined);
    assert.equal(games?.[0].theme, undefined);
    assert.equal(issues.length, 3);
  });
});
