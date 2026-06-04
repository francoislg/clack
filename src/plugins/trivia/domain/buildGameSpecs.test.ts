import { describe, it, beforeEach, afterEach, vi } from "vitest";
import assert from "node:assert/strict";
import { buildGameSpecs } from "./buildGameSpecs.js";
import { setTriviaLogger, _resetTriviaLogger } from "../core/pluginLogger.js";
import type { TriviaGame } from "../core/configTypes.js";

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

  it("each spec carries a descriptive name for displays", () => {
    const [question, reveal] = buildGameSpecs([baseGame]);
    assert.equal(question.name, "Trivia: ops — question");
    assert.equal(reveal.name, "Trivia: ops — reveal");
  });

  it("question spec has the expected requiredTools", () => {
    const [question] = buildGameSpecs([baseGame]);
    const expected = [
      "mcp__trivia__get_ideas",
      "mcp__trivia__find_previous_questions",
      "mcp__trivia__find_previous_subjects",
      "mcp__trivia__save_question",
      "mcp__trivia__post_questions",
    ];
    assert.deepEqual(question.requiredTools, expected);
  });

  it("reveal spec requiredTools is the compute + project + rollover list", () => {
    const [, reveal] = buildGameSpecs([baseGame]);
    assert.deepEqual(reveal.requiredTools, [
      "mcp__trivia__compute_answers",
      "mcp__trivia__update_answers_block",
      "mcp__trivia__start_new_season",
    ]);
  });

  it("question spec sets submitResponseMode to 'skipped'", () => {
    const [question] = buildGameSpecs([baseGame]);
    assert.equal(question.submitResponseMode, "skipped");
  });

  it("reveal spec does NOT set submitResponseMode (reveal renders a real message)", () => {
    const [, reveal] = buildGameSpecs([baseGame]);
    assert.equal(reveal.submitResponseMode, undefined);
  });

  it("both specs attach the trivia topic for persona / tone loading", () => {
    const [question, reveal] = buildGameSpecs([baseGame]);
    assert.deepEqual(question.attachedTopics, ["trivia"]);
    assert.deepEqual(reveal.attachedTopics, ["trivia"]);
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

  it("reveal prompt is a renderer brief sequencing compute → project → render", () => {
    const [, reveal] = buildGameSpecs([baseGame]);
    assert.match(reveal.prompt, /compute_answers/);
    assert.match(reveal.prompt, /update_answers_block/);
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

  describe("prepCron — opt-in pre-staging schedule", () => {
    it("game without prepCron emits 2 specs (legacy behavior)", () => {
      const specs = buildGameSpecs([baseGame]);
      assert.equal(specs.length, 2);
      assert.deepEqual(
        specs.map((s) => s.specKey),
        ["ops:question", "ops:reveal"],
      );
    });

    it("game without prepCron retains the legacy SEND prompt on the question spec", () => {
      const [question] = buildGameSpecs([baseGame]);
      // Legacy prompt does NOT contain the STAGED POOL CHECK section.
      assert.doesNotMatch(question.prompt, /STAGED POOL CHECK/);
    });

    it("game with prepCron emits 3 specs (prep, question, reveal in that order)", () => {
      const specs = buildGameSpecs([{ ...baseGame, prepCron: "30 8 * * 1-5" }]);
      assert.equal(specs.length, 3);
      assert.deepEqual(
        specs.map((s) => s.specKey),
        ["ops:prep", "ops:question", "ops:reveal"],
      );
    });

    it("prep spec is channelless (no channel field)", () => {
      const [prep] = buildGameSpecs([{ ...baseGame, prepCron: "30 8 * * 1-5" }]);
      assert.equal(prep.specKey, "ops:prep");
      assert.equal(prep.channel, undefined);
    });

    it("prep spec carries the prepCron expression + game timezone", () => {
      const [prep] = buildGameSpecs([{ ...baseGame, prepCron: "30 8 * * 1-5" }]);
      assert.equal(prep.cronExpression, "30 8 * * 1-5");
      assert.equal(prep.timezone, "America/Montreal");
    });

    it("prep spec's requiredTools is the gen-only list — NOTABLY excludes post_questions", () => {
      const [prep] = buildGameSpecs([{ ...baseGame, prepCron: "30 8 * * 1-5" }]);
      const expected = [
        "mcp__trivia__get_ideas",
        "mcp__trivia__find_previous_questions",
        "mcp__trivia__find_previous_subjects",
        "mcp__trivia__save_question",
      ];
      assert.deepEqual(prep.requiredTools, expected);
      assert.ok(prep.requiredTools);
      assert.ok(!prep.requiredTools.includes("mcp__trivia__post_questions"));
    });

    it("prep spec uses the PREP_QUESTIONS_INSTRUCTIONS prompt and substitutes {game}", () => {
      const [prep] = buildGameSpecs([{ ...baseGame, prepCron: "30 8 * * 1-5" }]);
      assert.match(prep.prompt, /will NOT post any Slack message/i);
      assert.match(prep.prompt, /STAGED POOL CHECK/);
      // {game} substitution happened — the prompt no longer contains a literal "{game}"
      // placeholder and the bare game name appears.
      assert.ok(prep.prompt.includes('game: "ops"') || prep.prompt.includes('"ops"'));
    });

    it("prep spec is set to skipped submitResponseMode", () => {
      const [prep] = buildGameSpecs([{ ...baseGame, prepCron: "30 8 * * 1-5" }]);
      assert.equal(prep.submitResponseMode, "skipped");
    });

    it("prep spec attaches the trivia topic", () => {
      const [prep] = buildGameSpecs([{ ...baseGame, prepCron: "30 8 * * 1-5" }]);
      assert.deepEqual(prep.attachedTopics, ["trivia"]);
    });

    it("question spec switches to POST_QUESTIONS_INSTRUCTIONS when prepCron is set", () => {
      const specs = buildGameSpecs([{ ...baseGame, prepCron: "30 8 * * 1-5" }]);
      const question = specs.find((s) => s.specKey === "ops:question");
      assert.ok(question);
      assert.match(question.prompt, /STAGED POOL CHECK/);
      assert.match(question.prompt, /FILLED/);
      assert.match(question.prompt, /MISSING/);
    });

    it("question spec keeps the legacy SEND prompt when prepCron is absent", () => {
      const [question] = buildGameSpecs([baseGame]);
      // SEND_QUESTIONS_INSTRUCTIONS does NOT mention the staged-pool concepts.
      assert.doesNotMatch(question.prompt, /STAGED POOL CHECK/);
      assert.doesNotMatch(question.prompt, /FILLED/);
    });

    it("skipDates propagates to all 3 specs when prepCron is set", () => {
      const offDays = [{ date: "12-25", label: "Christmas" }];
      const specs = buildGameSpecs([{ ...baseGame, prepCron: "30 8 * * 1-5" }], offDays);
      assert.equal(specs.length, 3);
      for (const spec of specs) {
        assert.deepEqual(spec.skipDates, offDays);
      }
    });

    it("each prep spec carries a descriptive name for displays", () => {
      const [prep] = buildGameSpecs([{ ...baseGame, prepCron: "30 8 * * 1-5" }]);
      assert.equal(prep.name, "Trivia: ops — prep");
    });

    describe("warnIfPrepAfterQuestion", () => {
      const warnSpy = vi.fn();

      beforeEach(() => {
        warnSpy.mockReset();
        setTriviaLogger({
          debug: () => {},
          info: () => {},
          warn: warnSpy,
          error: () => {},
        });
        // Pin "now" to Monday 2026-06-01 06:00 America/Montreal so the cron's
        // next-fire calculation is deterministic regardless of when the test runs.
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-06-01T10:00:00Z")); // 06:00 EDT
      });

      afterEach(() => {
        vi.useRealTimers();
        _resetTriviaLogger();
      });

      it("warns when prepCron fires AFTER questionCron on the next matching date", () => {
        buildGameSpecs([
          {
            ...baseGame,
            questionCron: "0 9 * * 1-5",
            // 6 PM weekdays — clearly AFTER 9 AM weekdays on the same Monday.
            prepCron: "0 18 * * 1-5",
          },
        ]);
        const prepWarnings = warnSpy.mock.calls.filter((call) => /prepCron/.test(String(call[0])));
        assert.equal(prepWarnings.length, 1);
        const message = String(prepWarnings[0][0]);
        assert.match(message, /prepCron.*fires AFTER questionCron/i);
        assert.match(message, /ops/);
      });

      it("does NOT warn when prepCron fires BEFORE questionCron", () => {
        buildGameSpecs([
          {
            ...baseGame,
            prepCron: "30 8 * * 1-5",
            questionCron: "0 9 * * 1-5",
          },
        ]);
        // Filter to only prep-related warnings (the reveal-before-question warning is
        // a separate side effect, irrelevant to this test).
        const prepWarnings = warnSpy.mock.calls.filter((call) => /prepCron/.test(String(call[0])));
        assert.equal(prepWarnings.length, 0);
      });

      it("does NOT warn when prepCron is absent", () => {
        buildGameSpecs([baseGame]);
        const prepWarnings = warnSpy.mock.calls.filter((call) => /prepCron/.test(String(call[0])));
        assert.equal(prepWarnings.length, 0);
      });
    });
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
