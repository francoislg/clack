import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { KnownBlock } from "@slack/types";
import type { z } from "zod";
import {
  createPostQuestionsTool,
  type PostQuestionsSlackDeps,
} from "../questions/postQuestions.js";
import { createSettleQuestionTool } from "./settleQuestion.js";
import { createComputeAnswersTool, type RevealSlackDeps } from "./computeAnswers.js";
import { createRefreshQuestionCardsTool } from "./refreshQuestionCards.js";
import {
  createFakeSdk,
  createInMemoryDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
} from "../../testHelpers.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";
import type { TriviaDataLayer, TriviaQuestion } from "../../core/types.js";
import type { BlockSchema } from "../../../../slack/blockSchema.js";

/**
 * Integration test for the "replay a bad question" process — exercises the REAL
 * settle_question → refresh_question_cards(filtered) → post_questions(append) →
 * compute_answers → refresh_question_cards(full) chain over ONE shared in-memory
 * data layer. Unit-level behavior of each tool lives in its own *.test.ts; this
 * file asserts only the cross-tool wiring of the documented replay sequence.
 */

const SESSION = { sessionId: "test" };
const SAMPLE_BLOCKS: Array<z.infer<typeof BlockSchema>> = [
  { type: "section", text: { type: "mrkdwn", text: "Q?" } },
];

function postSlackDeps(): { deps: PostQuestionsSlackDeps } {
  let i = 0;
  const deps: PostQuestionsSlackDeps = {
    isAvailable: () => null,
    async postBlocks(args) {
      i++;
      const suffix = String(i).padStart(3, "0");
      return {
        ts: `1700000${suffix}.000000`,
        permalink: `https://x.slack.com/archives/${args.channel}/p1700000${suffix}000000`,
      };
    },
  };
  return { deps };
}

interface CardUpdate {
  ts: string;
  blockIds: string[];
}

function revealSlackDeps(): { deps: RevealSlackDeps; updates: CardUpdate[] } {
  const updates: CardUpdate[] = [];
  const deps: RevealSlackDeps = {
    isAvailable: () => null,
    fetchBotUserId: async () => "UBOT",
    fetchMessageReactions: async () => [],
    fetchUserDisplayName: async () => null,
    updateMessage: async (_channel: string, ts: string, blocks: KnownBlock[]) => {
      updates.push({ ts, blockIds: blocks.map((b) => b.block_id ?? "") });
    },
  };
  return { deps, updates };
}

function seedBoolean(
  data: TriviaDataLayer,
  id: string,
  isTrue: boolean,
  createdAt: number,
): Promise<void> {
  const q: TriviaQuestion = {
    id,
    category: "C",
    statement: `${id}?`,
    answersFormat: "boolean",
    questionType: "fact",
    isTrue,
    emojis: ["⚡"],
    createdAt,
  };
  return data.forGame(FIXTURE_GAME_NAME).saveQuestion(q);
}

async function batchIdOf(data: TriviaDataLayer, id: string): Promise<string> {
  const q = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions()).find((x) => x.id === id);
  assert.ok(q?.batchId, `expected ${id} to carry a batchId after posting`);
  return q.batchId;
}

describe("replay a bad question — mid-window invalidate + replace + reveal", () => {
  it("invalidates one live card, replaces it in the same batch, and the reveal ignores the dead one", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const { deps: postDeps } = postSlackDeps();
    const postTool = createPostQuestionsTool(data, createFakeSdk(), fixtureGetGames, postDeps);
    const settleTool = createSettleQuestionTool(data, fixtureGetGames);

    // 1. Post a two-question batch and take some votes (still live, unrevealed).
    await seedBoolean(data, "q1", true, 1);
    await seedBoolean(data, "q_bad", false, 2);
    await postTool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [
          { questionId: "q1", blocks: SAMPLE_BLOCKS },
          { questionId: "q_bad", blocks: SAMPLE_BLOCKS },
        ],
        appendToPreviousBatch: undefined,
        suppress_unfurls: undefined,
      },
      SESSION,
    );
    const batchId = await batchIdOf(data, "q1");

    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 1,
    });
    await scoped.saveAnswer({
      userId: "U2",
      questionId: "q_bad",
      answer: false,
      correct: true,
      timestamp: 2,
    });

    // 2. Invalidate the bad question — verdicts on it are cleared so nobody scores.
    const settleRes = parseToolResult(
      await settleTool.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId: "q_bad",
          invalidate: true,
          invalidatedReason: "ambiguous answer",
          reopen: undefined,
          outcome: undefined,
          override: undefined,
          acceptableAnswers: undefined,
          gradingNotes: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(settleRes.invalidated, true);
    assert.equal(settleRes.cleared, 1);

    // 3. Repaint ONLY the dead card mid-window; the live sibling keeps its buttons.
    const { deps: midDeps, updates: midUpdates } = revealSlackDeps();
    const updateMid = createRefreshQuestionCardsTool(
      data,
      createFakeSdk(),
      fixtureGetGames,
      midDeps,
    );
    await updateMid.handler({ game: FIXTURE_GAME_NAME, questionIds: ["q_bad"] }, SESSION);
    assert.equal(midUpdates.length, 1, "only the invalidated card is repainted");
    // Invalidated repaint: content WAS sent, with no vote buttons and no reveal-results footer.
    assert.ok(midUpdates[0].blockIds.length > 0, "the dead card was repainted with content");
    assert.ok(!midUpdates[0].blockIds.some((id) => id.startsWith("vote-actions:")));
    assert.ok(!midUpdates[0].blockIds.some((id) => id.startsWith("reveal-results:")));

    // 4. Generate a replacement and APPEND it to the same (still-unrevealed) batch.
    await seedBoolean(data, "q_new", true, 3);
    await postTool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [{ questionId: "q_new", blocks: SAMPLE_BLOCKS }],
        appendToPreviousBatch: true,
        suppress_unfurls: undefined,
      },
      SESSION,
    );
    assert.equal(await batchIdOf(data, "q_new"), batchId, "replacement joins the live batch");
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q_new",
      answer: true,
      correct: true,
      timestamp: 4,
    });

    // 5. Reveal the batch — the dead question is skipped, the replacement is scored.
    const { deps: revealDeps } = revealSlackDeps();
    const computeTool = createComputeAnswersTool(
      data,
      createFakeSdk(),
      fixtureGetGames,
      revealDeps,
    );
    const reveal = parseToolResult(
      await computeTool.handler(
        { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined, reprocessBatchId: undefined },
        SESSION,
      ),
    );
    const revealedIds = reveal.reveals.map((r: { questionId: string }) => r.questionId).sort();
    assert.deepEqual(revealedIds, ["q1", "q_new"]);
    assert.deepEqual(
      reveal.invalidatedQuestions?.map((x: { questionId: string }) => x.questionId),
      ["q_bad"],
    );
    // The would-be-correct vote on the dead question earns U2 nothing.
    const u2 = reveal.leaderboard.find((e: { userId: string }) => e.userId === "U2");
    assert.ok(u2 === undefined || u2.score === 0, "invalidated votes do not score");

    // 6. At reveal, repaint the two revealed cards (q_bad was already repainted mid-window).
    const { deps: finalDeps, updates: finalUpdates } = revealSlackDeps();
    const updateFinal = createRefreshQuestionCardsTool(
      data,
      createFakeSdk(),
      fixtureGetGames,
      finalDeps,
    );
    await updateFinal.handler(
      {
        game: FIXTURE_GAME_NAME,
        questionIds: reveal.reveals.map((r: { questionId: string }) => r.questionId),
      },
      SESSION,
    );
    assert.equal(finalUpdates.length, 2);
  });

  it("after the reveal, voiding a scored question strips its points and adds no replacement", async () => {
    const data = createInMemoryDataLayer();
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    const { deps: postDeps } = postSlackDeps();
    const postTool = createPostQuestionsTool(data, createFakeSdk(), fixtureGetGames, postDeps);
    const settleTool = createSettleQuestionTool(data, fixtureGetGames);
    const { deps: revealDeps } = revealSlackDeps();
    const computeTool = createComputeAnswersTool(
      data,
      createFakeSdk(),
      fixtureGetGames,
      revealDeps,
    );

    // Post and score a two-question batch (U1 right on q1, U2 right on q_void).
    await seedBoolean(data, "q1", true, 1);
    await seedBoolean(data, "q_void", true, 2);
    await postTool.handler(
      {
        game: FIXTURE_GAME_NAME,
        items: [
          { questionId: "q1", blocks: SAMPLE_BLOCKS },
          { questionId: "q_void", blocks: SAMPLE_BLOCKS },
        ],
        appendToPreviousBatch: undefined,
        suppress_unfurls: undefined,
      },
      SESSION,
    );
    await scoped.saveAnswer({
      userId: "U1",
      questionId: "q1",
      answer: true,
      correct: true,
      timestamp: 1,
    });
    await scoped.saveAnswer({
      userId: "U2",
      questionId: "q_void",
      answer: true,
      correct: true,
      timestamp: 2,
    });

    const revealed = parseToolResult(
      await computeTool.handler(
        { game: FIXTURE_GAME_NAME, reprocessQuestionIds: undefined, reprocessBatchId: undefined },
        SESSION,
      ),
    );
    const u2Before = revealed.leaderboard.find((e: { userId: string }) => e.userId === "U2");
    assert.equal(u2Before?.totalCorrect, 1, "U2 scored the question before it was voided");

    // Admin voids q_void AFTER the reveal, then re-scores. No replacement is posted.
    await settleTool.handler(
      {
        game: FIXTURE_GAME_NAME,
        questionId: "q_void",
        invalidate: true,
        invalidatedReason: "wrong on review",
        reopen: undefined,
        outcome: undefined,
        override: undefined,
        acceptableAnswers: undefined,
        gradingNotes: undefined,
      },
      SESSION,
    );
    const rescored = parseToolResult(
      await computeTool.handler(
        { game: FIXTURE_GAME_NAME, reprocessQuestionIds: ["q_void"], reprocessBatchId: undefined },
        SESSION,
      ),
    );

    assert.deepEqual(
      rescored.invalidatedQuestions?.map((x: { questionId: string }) => x.questionId),
      ["q_void"],
    );
    const u2After = rescored.leaderboard.find((e: { userId: string }) => e.userId === "U2");
    assert.ok(u2After === undefined || u2After.totalCorrect === 0, "U2's point was stripped");
    const u1After = rescored.leaderboard.find((e: { userId: string }) => e.userId === "U1");
    assert.equal(u1After?.totalCorrect, 1, "U1's unrelated score is untouched");
    // Void only — the round shrinks, no new question is added.
    assert.equal((await scoped.loadQuestions()).length, 2);

    const { deps: repaintDeps, updates: repaintUpdates } = revealSlackDeps();
    const updateVoid = createRefreshQuestionCardsTool(
      data,
      createFakeSdk(),
      fixtureGetGames,
      repaintDeps,
    );
    // Case B repaints only the voided card; the sibling's results are unaffected by the void.
    await updateVoid.handler({ game: FIXTURE_GAME_NAME, questionIds: ["q_void"] }, SESSION);
    assert.equal(repaintUpdates.length, 1);
  });
});
