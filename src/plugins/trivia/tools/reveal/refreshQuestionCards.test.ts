import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { KnownBlock } from "@slack/types";
import { createRefreshQuestionCardsTool } from "./refreshQuestionCards.js";
import type { RevealSlackDeps } from "./computeAnswers.js";
import {
  createFakeSdk,
  createInMemoryDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
} from "../../testHelpers.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaQuestion } from "../../core/types.js";

/**
 * Tests for `refresh_question_cards` — the deterministic projector that edits
 * revealed question cards from file state. Card-editing behavior lives here;
 * `computeAnswers.test.ts` asserts that `compute_answers` no longer edits.
 */

const SESSION = { sessionId: "test" };

function makeQuestion(overrides: Partial<TriviaQuestion>): TriviaQuestion {
  return {
    id: "q",
    category: "C",
    statement: "stmt",
    answersFormat: "boolean",
    questionType: "fact",
    isTrue: true,
    emojis: ["🎯"],
    createdAt: 0,
    postedAt: 1000,
    // Default fixture represents a SCORED question (compute_answers stamps this before
    // a revealed-card repaint) so the projector paints the revealed footer. Live/locked
    // and keyless cases override it to `undefined`.
    processedAt: 2000,
    messageLink: "https://x.slack.com/archives/C100000000/p1700000000000000",
    revealResponses: "yes",
    ...overrides,
  };
}

interface UpdateCall {
  channel: string;
  ts: string;
  blockIds: string[];
  blocks: KnownBlock[];
}

function capturingSlackDeps(opts: { throwOnUpdate?: boolean } = {}): {
  deps: RevealSlackDeps;
  updates: UpdateCall[];
} {
  const updates: UpdateCall[] = [];
  const deps: RevealSlackDeps = {
    isAvailable: () => null,
    fetchBotUserId: async () => "UBOT",
    fetchMessageReactions: async () => [],
    fetchUserDisplayName: async () => null,
    updateMessage: async (channel, ts, blocks) => {
      if (opts.throwOnUpdate) throw new Error("rate limited");
      updates.push({ channel, ts, blockIds: blocks.map((b) => b.block_id ?? ""), blocks });
    },
  };
  return { deps, updates };
}

function postedBooleanBlocks(questionId: string) {
  return [
    {
      type: "section" as const,
      block_id: `card:${questionId}`,
      text: { type: "mrkdwn" as const, text: "S" },
    },
    {
      type: "actions" as const,
      block_id: `vote-actions:${questionId}`,
      elements: [
        {
          type: "button" as const,
          action_id: `plugin:test:vote:${questionId}:true`,
          text: { type: "plain_text" as const, text: "👍 TRUE" },
        },
      ],
    },
  ];
}

function makeTool(data: ReturnType<typeof createInMemoryDataLayer>, deps: RevealSlackDeps) {
  return createRefreshQuestionCardsTool(data, createFakeSdk(), fixtureGetGames, deps);
}

describe("refresh_question_cards — deterministic card projection", () => {
  it("edits the named question's card once", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "q1", postedBlocks: postedBooleanBlocks("q1") }));
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 1,
    });

    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION),
    );

    assert.equal(updates.length, 1);
    assert.equal(updates[0].channel, "C100000000");
    assert.ok(!updates[0].blockIds.includes("vote-actions:q1"));
    assert.ok(updates[0].blockIds.includes("reveal-results:q1"));
    assert.ok(updates[0].blockIds.includes("reveal-post-game-actions:q1"));
    assert.deepEqual(res.edited, ["q1"]);
  });

  it("records an error and skips a question whose projection failed", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        answersFormat: "choice",
        isTrue: undefined,
        choices: ["A", "B"],
        correctIndex: -1,
        postedBlocks: postedBooleanBlocks("q1"),
      }),
    );

    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION),
    );

    assert.equal(updates.length, 0);
    assert.ok(res.errors?.some((e: { questionId: string }) => e.questionId === "q1"));
  });

  it("swallows a card's chat.update failure without aborting — call still returns", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "q1", postedBlocks: postedBooleanBlocks("q1") }));

    const { deps } = capturingSlackDeps({ throwOnUpdate: true });
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION),
    );

    // editRevealIntoCard swallows the chat.update failure (logged, not surfaced in
    // `errors`); the card counts as projected and the tool returns normally.
    assert.deepEqual(res.edited, ["q1"]);
    assert.equal(res.errors, undefined);
  });

  it("is idempotent — re-running re-projects the same card", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "q1", postedBlocks: postedBooleanBlocks("q1") }));

    const { deps, updates } = capturingSlackDeps();
    const tool = makeTool(data, deps);
    await tool.handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION);
    await tool.handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION);

    assert.equal(updates.length, 2);
    assert.deepEqual(updates[0].blockIds, updates[1].blockIds);
  });

  it("edits every named card and reports them in postedAt order", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", postedAt: 1_000, postedBlocks: postedBooleanBlocks("q1") }),
    );
    await scoped.saveQuestion(
      makeQuestion({ id: "q2", postedAt: 1_001, postedBlocks: postedBooleanBlocks("q2") }),
    );

    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler(
        { game: FIXTURE_GAME_NAME, questionIds: ["q2", "q1"] },
        SESSION,
      ),
    );

    assert.equal(updates.length, 2);
    assert.deepEqual(res.edited, ["q1", "q2"]);
  });

  it("de-duplicates repeated ids — each card edited once", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({ id: "q1", postedAt: 1_000, postedBlocks: postedBooleanBlocks("q1") }),
    );
    await scoped.saveQuestion(
      makeQuestion({ id: "q2", postedAt: 1_001, postedBlocks: postedBooleanBlocks("q2") }),
    );

    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler(
        { game: FIXTURE_GAME_NAME, questionIds: ["q1", "q1", "q2"] },
        SESSION,
      ),
    );

    assert.equal(updates.length, 2);
    assert.deepEqual(res.edited, ["q1", "q2"]);
  });

  it("re-projects an already-judged freeform question from scored rows", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "f1",
        answersFormat: "freeform",
        isTrue: undefined,
        expectedAnswer: "Paris",
        postedBlocks: postedBooleanBlocks("f1"),
      }),
    );
    // Already-scored freeform rows (correct !== undefined) — projectReveal must
    // build voters from these without re-judging.
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "f1",
      answerText: "Paris",
      correct: true,
      timestamp: 1,
    });
    await scoped.saveAnswer({
      userId: "U2",
      questionId: "f1",
      answerText: "London",
      correct: false,
      timestamp: 2,
    });

    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, questionIds: ["f1"] }, SESSION),
    );

    assert.equal(updates.length, 1);
    assert.ok(updates[0].blockIds.includes("reveal-results:f1"));
    assert.deepEqual(res.edited, ["f1"]);
  });

  it("repaints only the named invalidated card, leaving live siblings untouched", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // A still-live batch: q_bad just got invalidated; q_live is still taking votes.
    await scoped.saveQuestion(
      makeQuestion({
        id: "q_bad",
        postedAt: 1_000,
        invalidated: true,
        invalidatedReason: "ambiguous answer",
        postedBlocks: postedBooleanBlocks("q_bad"),
      }),
    );
    await scoped.saveQuestion(
      makeQuestion({ id: "q_live", postedAt: 1_001, postedBlocks: postedBooleanBlocks("q_live") }),
    );

    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler(
        { game: FIXTURE_GAME_NAME, questionIds: ["q_bad"] },
        SESSION,
      ),
    );

    assert.equal(updates.length, 1);
    assert.deepEqual(res.edited, ["q_bad"]);
    // The invalidated card keeps its body, drops its vote buttons, and renders the reason.
    assert.ok(updates[0].blockIds.includes("card:q_bad"));
    assert.ok(!updates[0].blockIds.includes("vote-actions:q_bad"));
    const rendered = JSON.stringify(updates[0].blocks);
    assert.ok(rendered.includes("Invalidated") && rendered.includes("ambiguous answer"));
    // The live sibling is never touched.
    assert.ok(!updates.some((u) => u.blockIds.includes("vote-actions:q_live")));
  });

  it("repaints the known ids and reports unknown ones in notFound", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q_bad",
        invalidated: true,
        invalidatedReason: "dupe",
        postedBlocks: postedBooleanBlocks("q_bad"),
      }),
    );

    const { deps, updates } = capturingSlackDeps();
    // A partial match (one real id + one unknown) repaints the real one and reports
    // the unknown in `notFound` — only an ALL-miss errors.
    const res = parseToolResult(
      await makeTool(data, deps).handler(
        { game: FIXTURE_GAME_NAME, questionIds: ["q_bad", "ghost"] },
        SESSION,
      ),
    );

    assert.deepEqual(res.edited, ["q_bad"]);
    assert.deepEqual(res.notFound, ["ghost"]);
    assert.equal(updates.length, 1);
  });

  it("errors when no requested id matches a question", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "q1", postedBlocks: postedBooleanBlocks("q1") }));

    const { deps } = capturingSlackDeps();
    const out = await makeTool(data, deps).handler(
      { game: FIXTURE_GAME_NAME, questionIds: ["nope"] },
      SESSION,
    );
    assert.ok(out.isError);
    // The error names the rejected id so the caller can see what didn't match.
    assert.ok(JSON.stringify(out).includes("nope"));
  });

  it("errors on an empty questionIds array", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "q1", postedBlocks: postedBooleanBlocks("q1") }));

    const { deps, updates } = capturingSlackDeps();
    const out = await makeTool(data, deps).handler(
      { game: FIXTURE_GAME_NAME, questionIds: [] },
      SESSION,
    );
    assert.ok(out.isError);
    assert.equal(updates.length, 0);
  });

  it("appends stored revealBlocks between the footer and the See-your-answer button", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        postedBlocks: postedBooleanBlocks("q1"),
        revealBlocks: [
          { type: "section", block_id: "narrative:q1", text: { type: "mrkdwn", text: "the why" } },
        ],
      }),
    );

    const { deps, updates } = capturingSlackDeps();
    await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION);

    const ids = updates[0].blockIds;
    const footer = ids.indexOf("reveal-results:q1");
    const narrative = ids.indexOf("narrative:q1");
    const postGame = ids.indexOf("reveal-post-game-actions:q1");
    assert.ok(footer >= 0 && narrative >= 0 && postGame >= 0);
    assert.ok(footer < narrative, "footer before narrative");
    assert.ok(narrative < postGame, "narrative before post-game buttons");
  });

  it("is facts-only when the record has no revealBlocks", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "q1", postedBlocks: postedBooleanBlocks("q1") }));

    const { deps, updates } = capturingSlackDeps();
    await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION);

    const ids = updates[0].blockIds;
    assert.ok(ids.includes("reveal-results:q1"));
    assert.ok(!ids.some((id) => id.startsWith("narrative:")));
  });

  it("re-projection after re-authoring reconciles to the new narrative", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        postedBlocks: postedBooleanBlocks("q1"),
        revealBlocks: [
          { type: "section", block_id: "narrative-v1:q1", text: { type: "mrkdwn", text: "v1" } },
        ],
      }),
    );
    const { deps, updates } = capturingSlackDeps();
    const tool = makeTool(data, deps);
    await tool.handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION);

    // Re-author the narrative (as set_reveal_narrative would), then re-project.
    await scoped.updateQuestion("q1", {
      revealBlocks: [
        { type: "section", block_id: "narrative-v2:q1", text: { type: "mrkdwn", text: "v2" } },
      ],
    });
    await tool.handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION);

    const second = updates[1].blockIds;
    assert.ok(second.includes("narrative-v2:q1"), "shows v2 after re-authoring");
    assert.ok(!second.includes("narrative-v1:q1"), "v1 is gone (rebuilt, not accumulated)");
  });

  it("orders footer → narrative → see-answer → tell-me-more when tellMeMore is also enabled", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        postedBlocks: postedBooleanBlocks("q1"),
        revealBlocks: [
          { type: "section", block_id: "narrative:q1", text: { type: "mrkdwn", text: "the why" } },
        ],
      }),
    );

    const { deps, updates } = capturingSlackDeps();
    const tool = createRefreshQuestionCardsTool(
      data,
      createFakeSdk(),
      fixtureGetGames,
      deps,
      () => ({
        tellMeMore: { enabled: true },
      }),
    );
    await tool.handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION);

    const ids = updates[0].blockIds;
    const footer = ids.indexOf("reveal-results:q1");
    const narrative = ids.indexOf("narrative:q1");
    const postGame = ids.indexOf("reveal-post-game-actions:q1");
    assert.ok(
      [footer, narrative, postGame].every((i) => i >= 0),
      "all blocks present",
    );
    assert.ok(footer < narrative, "footer before narrative");
    assert.ok(narrative < postGame, "narrative before post-game buttons");

    // see-answer and tell-me-more share the post-game row; order is element order.
    const group = updates[0].blocks.find((b) => b.block_id === "reveal-post-game-actions:q1");
    assert.ok(group?.type === "actions");
    assert.deepEqual(
      group.elements.map((el) => (el.type === "button" ? el.action_id : null)),
      ["plugin:test:reveal-see-answer:q1", "plugin:test:tell-me-more:q1"],
    );
  });
});

describe("refresh_question_cards — state-complete projection", () => {
  it("paints a reopened unlocked pending prediction as LIVE (buttons, no footer)", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // Keyless (reopened prediction), unprocessed, unlocked.
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        isTrue: undefined,
        processedAt: undefined,
        postedBlocks: postedBooleanBlocks("q1"),
      }),
    );
    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION),
    );

    assert.deepEqual(res.edited, ["q1"]);
    const ids = updates[0].blockIds;
    assert.ok(ids.includes("vote-actions:q1"), "vote buttons restored");
    assert.ok(!ids.some((id) => id.startsWith("reveal-results:")), "no results footer");
    assert.ok(!ids.some((id) => id.startsWith("locked-notice:")), "not locked");
  });

  it("never paints the footer on a keyed-but-unprocessed question (no leak)", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // Keyed (isTrue set) but not yet scored, unlocked.
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        isTrue: true,
        processedAt: undefined,
        postedBlocks: postedBooleanBlocks("q1"),
      }),
    );
    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION),
    );

    assert.deepEqual(res.edited, ["q1"]);
    const ids = updates[0].blockIds;
    assert.ok(!ids.some((id) => id.startsWith("reveal-results:")), "answer stays secret");
    assert.ok(ids.includes("vote-actions:q1"), "still live");
  });

  it("paints a reopened LOCKED pending prediction as locked (notice, no buttons, no footer)", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        isTrue: undefined,
        processedAt: undefined,
        answerLocked: true,
        postedBlocks: postedBooleanBlocks("q1"),
      }),
    );
    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION),
    );

    assert.deepEqual(res.edited, ["q1"]);
    const ids = updates[0].blockIds;
    assert.ok(ids.includes("locked-notice:q1"), "locked notice shown");
    assert.ok(!ids.includes("vote-actions:q1"), "buttons removed");
    assert.ok(!ids.some((id) => id.startsWith("reveal-results:")), "no footer");
  });

  it("paints a reopened-after-reveal question (keyless + processedAt) as live, not revealed", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    // Was revealed-as-invalidated then reopened: keyless again, processedAt retained.
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        isTrue: undefined,
        processedAt: 2000,
        postedBlocks: postedBooleanBlocks("q1"),
      }),
    );
    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION),
    );

    assert.deepEqual(res.edited, ["q1"]);
    const ids = updates[0].blockIds;
    assert.ok(!ids.some((id) => id.startsWith("reveal-results:")), "no footer while keyless");
    assert.ok(ids.includes("vote-actions:q1"), "live card");
  });

  it("skips a staged/legacy row with no postedBlocks", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      makeQuestion({
        id: "q1",
        isTrue: undefined,
        processedAt: undefined,
        postedBlocks: undefined,
      }),
    );
    const { deps, updates } = capturingSlackDeps();
    const res = parseToolResult(
      await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION),
    );

    assert.equal(updates.length, 0);
    assert.deepEqual(res.edited, []);
  });
});

describe("refresh_question_cards — teams mode footer", () => {
  const ROSTER = [{ name: "Red", userIds: ["U1", "U2"] }];

  async function seedRevealed(data: ReturnType<typeof createInMemoryDataLayer>): Promise<void> {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(makeQuestion({ id: "q1", postedBlocks: postedBooleanBlocks("q1") }));
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 1,
    });
    await scoped.saveAnswer({
      userId: "UFREE",
      questionId: "q1",
      answer: false,
      correct: false,
      timestamp: 2,
    });
  }

  function footerText(updates: UpdateCall[]): string {
    const footer = updates[0].blocks.find((b) => b.block_id === "reveal-results:q1");
    assert.ok(footer !== undefined && footer.type === "section");
    return footer.text?.text ?? "";
  }

  it("teams ON: the footer names the team and free agents, never members", async () => {
    const data = createInMemoryDataLayer();
    await seedRevealed(data);
    const getGames = () =>
      fixtureGetGames().map((g) =>
        g.name === FIXTURE_GAME_NAME ? { ...g, teams: ROSTER, teamsEnabled: true } : g,
      );
    const { deps, updates } = capturingSlackDeps();
    const tool = createRefreshQuestionCardsTool(data, createFakeSdk(), getGames, deps);
    await tool.handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION);

    const text = footerText(updates);
    assert.match(text, /Correct:.*Red/);
    assert.doesNotMatch(text, /<@U1>/);
    assert.match(text, /Incorrect:.*<@UFREE>/);
  });

  it("teams OFF: the footer names individuals exactly as before", async () => {
    const data = createInMemoryDataLayer();
    await seedRevealed(data);
    const { deps, updates } = capturingSlackDeps();
    await makeTool(data, deps).handler({ game: FIXTURE_GAME_NAME, questionIds: ["q1"] }, SESSION);

    const text = footerText(updates);
    assert.match(text, /Correct:.*<@U1>/);
    assert.doesNotMatch(text, /Red/);
  });
});
