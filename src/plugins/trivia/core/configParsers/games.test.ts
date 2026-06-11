import { describe, it } from "vitest";
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

  describe("revealResponses", () => {
    it("accepts the just-winners mode and stores it on the game", () => {
      const { games, issues } = parseTriviaGames([
        { ...validBase, revealResponses: "just-winners" },
      ]);
      assert.equal(issues.length, 0);
      assert.equal(games?.[0].revealResponses, "just-winners");
    });

    it("still accepts the legacy just-correctness / no / yes values", () => {
      for (const mode of ["no", "just-correctness", "yes"] as const) {
        const { games, issues } = parseTriviaGames([{ ...validBase, revealResponses: mode }]);
        assert.equal(issues.length, 0);
        assert.equal(games?.[0].revealResponses, mode);
      }
    });

    it("drops the field with an issue when the value is unknown", () => {
      const { games, issues } = parseTriviaGames([{ ...validBase, revealResponses: "winners" }]);
      assert.equal(games?.length, 1);
      assert.equal(games?.[0].revealResponses, undefined);
      assert.equal(issues[0].field, "trivia.games[0].revealResponses");
      assert.match(issues[0].error, /just-winners/);
    });
  });

  describe("instructions", () => {
    it("accepts a trimmed non-empty string", () => {
      const { games, issues } = parseTriviaGames([{ ...validBase, instructions: "  Be dry.  " }]);
      assert.equal(issues.length, 0);
      assert.equal(games?.[0].instructions, "Be dry.");
    });

    it("drops the field when whitespace-only and surfaces an issue", () => {
      const { games, issues } = parseTriviaGames([{ ...validBase, instructions: "   " }]);
      assert.equal(games?.length, 1);
      assert.equal(games?.[0].instructions, undefined);
      assert.equal(issues[0].field, "trivia.games[0].instructions");
      assert.match(issues[0].error, /non-empty after trim/);
    });

    it("drops the field when not a string and retains the rest of the entry", () => {
      const { games, issues } = parseTriviaGames([
        { ...validBase, theme: "Halloween", instructions: 42 },
      ]);
      assert.equal(games?.length, 1);
      assert.equal(games?.[0].instructions, undefined);
      assert.equal(games?.[0].theme, "Halloween");
      assert.equal(issues[0].field, "trivia.games[0].instructions");
    });
  });

  describe("additionalInstructions", () => {
    it("accepts a trimmed non-empty string", () => {
      const { games, issues } = parseTriviaGames([
        { ...validBase, additionalInstructions: "  Avoid politics.  " },
      ]);
      assert.equal(issues.length, 0);
      assert.equal(games?.[0].additionalInstructions, "Avoid politics.");
    });

    it("drops the field when whitespace-only and surfaces an issue", () => {
      const { games, issues } = parseTriviaGames([{ ...validBase, additionalInstructions: "" }]);
      assert.equal(games?.[0].additionalInstructions, undefined);
      assert.equal(issues[0].field, "trivia.games[0].additionalInstructions");
    });

    it("drops the field when not a string and retains the rest of the entry", () => {
      const { games, issues } = parseTriviaGames([
        { ...validBase, theme: "Halloween", additionalInstructions: ["nope"] },
      ]);
      assert.equal(games?.length, 1);
      assert.equal(games?.[0].additionalInstructions, undefined);
      assert.equal(games?.[0].theme, "Halloween");
      assert.equal(issues[0].field, "trivia.games[0].additionalInstructions");
    });

    it("both new fields are independent — setting only one leaves the other absent", () => {
      const { games, issues } = parseTriviaGames([{ ...validBase, instructions: "Be dry." }]);
      assert.equal(issues.length, 0);
      assert.equal(games?.[0].instructions, "Be dry.");
      assert.equal(games?.[0].additionalInstructions, undefined);
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

describe("parseTriviaGames — prepCron", () => {
  it("accepts a valid prepCron alongside questionCron and revealCron", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, prepCron: "30 8 * * 1-5" }]);
    assert.equal(issues.length, 0);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].prepCron, "30 8 * * 1-5");
    assert.equal(games?.[0].questionCron, "0 9 * * 1-5");
    assert.equal(games?.[0].revealCron, "0 15 * * 1-5");
  });

  it("absence of prepCron is silently accepted (no issues, field undefined)", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase }]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].prepCron, undefined);
  });

  it("drops the field with a logged issue when prepCron is malformed", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, prepCron: "not a cron" }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].prepCron, undefined);
    assert.equal(games?.[0].name, "main");
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].prepCron");
    assert.match(issues[0].error, /invalid/);
  });

  it("drops the field when prepCron is the wrong type", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, prepCron: 42 }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].prepCron, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].prepCron");
    assert.match(issues[0].error, /must be a string/);
  });

  it("drops the field when prepCron is an empty string", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, prepCron: "" }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].prepCron, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].prepCron");
    assert.match(issues[0].error, /non-empty/);
  });

  it("validates prepCron against the game's timezone", () => {
    // A timezone-sensitive cron should still parse; the validator uses the game's tz.
    const { games, issues } = parseTriviaGames([
      { ...validBase, timezone: "America/Montreal", prepCron: "0 8 * * 1-5" },
    ]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].prepCron, "0 8 * * 1-5");
  });

  it("an invalid timezone still rejects the whole entry (existing behavior)", () => {
    const { games, issues } = parseTriviaGames([
      { ...validBase, timezone: "", prepCron: "0 8 * * *" },
    ]);
    assert.equal(games?.length, 0);
    // The timezone check rejects the whole entry before prepCron is evaluated.
    assert.ok(issues.some((i) => i.field === "trivia.games[0].timezone"));
  });
});

describe("parseTriviaGames — lockCron", () => {
  it("accepts a valid lockCron alongside the other crons", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, lockCron: "0 19 * * 1-5" }]);
    assert.equal(issues.length, 0);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].lockCron, "0 19 * * 1-5");
  });

  it("absence of lockCron is silently accepted (no issues, field undefined)", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase }]);
    assert.equal(issues.length, 0);
    assert.equal(games?.[0].lockCron, undefined);
  });

  it("drops the field with a logged issue when lockCron is malformed", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, lockCron: "not a cron" }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].lockCron, undefined);
    assert.equal(games?.[0].name, "main");
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].lockCron");
    assert.match(issues[0].error, /invalid/);
  });

  it("drops the field when lockCron is the wrong type", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, lockCron: 42 }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].lockCron, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].lockCron");
    assert.match(issues[0].error, /must be a string/);
  });

  it("drops the field when lockCron is an empty string", () => {
    const { games, issues } = parseTriviaGames([{ ...validBase, lockCron: "" }]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].lockCron, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].lockCron");
    assert.match(issues[0].error, /non-empty/);
  });

  it("a malformed lockCron does not affect a valid prepCron on the same entry", () => {
    const { games, issues } = parseTriviaGames([
      { ...validBase, prepCron: "30 8 * * 1-5", lockCron: "not a cron" },
    ]);
    assert.equal(games?.length, 1);
    assert.equal(games?.[0].prepCron, "30 8 * * 1-5");
    assert.equal(games?.[0].lockCron, undefined);
    assert.equal(issues.length, 1);
    assert.equal(issues[0].field, "trivia.games[0].lockCron");
  });
});
