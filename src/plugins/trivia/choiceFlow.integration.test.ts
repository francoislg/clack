import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer, FIXTURE_GAME_NAME, fixtureGetGames } from "./testHelpers.js";
import { createGetIdeasTool } from "./tools/questions/getIdeas.js";
import { createSaveQuestionTool } from "./tools/questions/saveQuestion.js";
import { createSubmitAnswersTool } from "./tools/answers/submitAnswers.js";
import { createFindPreviousQuestionsTool } from "./tools/questions/findPreviousQuestions.js";
import { createGetQuestionHistoryTool } from "./tools/questions/getQuestionHistory.js";
import {
  createPostQuestionsTool,
  type PostQuestionsSlackDeps,
} from "./tools/questions/postQuestions.js";
import { parseToolResult } from "../../tools/testHelpers.js";
import type { Config } from "../../config.js";
import type { TriviaDataLayer } from "./core/types.js";
import type { ClackSdk } from "../sdk.js";

function fakeSdk(): Pick<ClackSdk, "getSlackClient"> {
  return { getSlackClient: () => null };
}

function postQuestionsDeps(): PostQuestionsSlackDeps {
  let counter = 0;
  return {
    isAvailable() {
      return null;
    },
    async postBlocks(args) {
      counter++;
      const ts = `170000000${counter}.000000`;
      return {
        ts,
        permalink: `https://test.slack.com/archives/${args.channel}/p170000000${counter}000000`,
      };
    },
    async addReactions() {
      // best-effort, no-op for tests
    },
  };
}

const SESSION = { sessionId: "test" };

function makeConfig(trivia?: Config["trivia"]): Config {
  return {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "secret",
      fetchAndStoreUsername: false,
      sendErrorsAsDM: false,
    },
    reactions: { trigger: "robot_face" },
    directMessages: { enabled: false },
    mentions: { enabled: false },
    repositories: [],
    git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
    sessions: { cleanupIntervalMinutes: 60 },
    claudeCode: { model: "sonnet" },
    trivia,
  };
}

describe("choice-questions end-to-end flow", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveCategories(["Geography", "Astronomy", "History"]);
  });

  it("get_ideas → save_question → post_questions → submit_answers → find/history (choice path)", async () => {
    // 1. get_ideas in pure-choice config → returns suggestedAnswersFormat: "choice" + count + correctIndex
    const cfg = makeConfig({
      answersFormat: { boolean: 0, choice: 1 },
      choices: { min: 4, max: 4 },
    });
    const getIdeas = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    const ideasResult = parseToolResult(
      await getIdeas.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
    );
    assert.equal(ideasResult.suggestedAnswersFormat, "choice");
    assert.equal(ideasResult.suggestedChoiceCount, 4);
    assert.ok(ideasResult.suggestedCorrectIndex >= 0 && ideasResult.suggestedCorrectIndex < 4);

    // 2. save_question with that shape
    const saveQuestion = createSaveQuestionTool(data, () => cfg, fixtureGetGames);
    const saved = parseToolResult(
      await saveQuestion.handler(
        {
          game: FIXTURE_GAME_NAME,
          answersFormat: "choice",
          questionType: "fact",
          sourceUrl: undefined,
          eventDate: undefined,
          context: undefined,
          category: "Geography",
          statement: "Which is the smallest planet?",
          isTrue: undefined,
          choices: ["Mercury", "Venus", "Earth", "Mars"],
          correctIndex: 0,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🪐"],
        },
        SESSION,
      ),
    );
    assert.equal(saved.saved, true);
    const questionId = saved.question.id;

    // 3. post_questions stamps postedAt + messageLink on the question record
    const postQuestions = createPostQuestionsTool(
      data,
      fakeSdk(),
      fixtureGetGames,
      postQuestionsDeps(),
    );
    const postResult = parseToolResult(
      await postQuestions.handler(
        {
          game: FIXTURE_GAME_NAME,
          items: [
            {
              questionId,
              blocks: [{ type: "section", text: { type: "mrkdwn", text: "Q?" } }],
            },
          ],
          appendToPreviousBatch: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(postResult.results.length, 1);
    assert.equal(postResult.results[0].ok, true);

    // Verify the question record is stamped — process_reveal_answers' pending filter
    // (postedAt !== undefined && processedAt === undefined) would now find it.
    const storedAfterPost = (await data.forGame(FIXTURE_GAME_NAME).loadQuestions()).find(
      (q) => q.id === questionId,
    );
    assert.ok(storedAfterPost?.postedAt !== undefined, "post_questions must stamp postedAt");
    assert.ok(
      storedAfterPost?.messageLink && storedAfterPost.messageLink.length > 0,
      "post_questions must stamp messageLink",
    );

    // 4. submit_answers with answerIndex entries — answer collection only, no first-stamp
    const submitAnswers = createSubmitAnswersTool(data, fixtureGetGames);
    const answersResult = parseToolResult(
      await submitAnswers.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId,
          messageLink: "https://slack/x",
          postedAt: 1000,
          answers: [
            { userId: "U1", displayName: "Alice", answer: undefined, answerIndex: 0 }, // correct
            { userId: "U2", displayName: "Bob", answer: undefined, answerIndex: 2 }, // wrong
            { userId: "U3", displayName: "Carol", answer: undefined, answerIndex: 0 }, // correct
          ],
        },
        SESSION,
      ),
    );
    assert.equal(answersResult.results.length, 3);
    assert.equal(answersResult.results[0].correct, true);
    assert.equal(answersResult.results[1].correct, false);
    assert.equal(answersResult.results[2].correct, true);

    // 4. find_previous_questions exposes choices but never correctIndex/isTrue
    const findPrev = createFindPreviousQuestionsTool(data, fixtureGetGames);
    const findResult = parseToolResult(
      await findPrev.handler(
        {
          game: FIXTURE_GAME_NAME,
          category: undefined,
          text: "planet",
          season: undefined,
          recentBatchFromNow: undefined,
          limit: undefined,
        },
        SESSION,
      ),
    );
    assert.equal(findResult.count, 1);
    const found = findResult.questions[0];
    assert.equal(found.answersFormat, "choice");
    assert.deepEqual(found.choices, ["Mercury", "Venus", "Earth", "Mars"]);
    assert.equal(Object.prototype.hasOwnProperty.call(found, "correctIndex"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(found, "isTrue"), false);

    // 5. get_question_history returns the type-discriminated answer key
    const history = createGetQuestionHistoryTool(data, fixtureGetGames);
    const histResult = parseToolResult(
      await history.handler({ game: FIXTURE_GAME_NAME, questionId }, SESSION),
    );
    assert.equal(histResult.answersFormat, "choice");
    assert.equal(histResult.correctIndex, 0);
    assert.deepEqual(histResult.choices, ["Mercury", "Venus", "Earth", "Mars"]);
    assert.equal(histResult.responses.length, 3);
    for (const r of histResult.responses) {
      assert.equal(typeof r.answerIndex, "number");
      assert.equal(Object.prototype.hasOwnProperty.call(r, "answer"), false);
    }
  });

  it("mixed-config flow: many calls produce both boolean and choice questions", async () => {
    const cfg = makeConfig({ answersFormat: { boolean: 1, choice: 1 } });
    const getIdeas = createGetIdeasTool(data, () => cfg, fixtureGetGames);
    let booleans = 0;
    let choices = 0;
    for (let i = 0; i < 200; i++) {
      const r = parseToolResult(
        await getIdeas.handler({ game: FIXTURE_GAME_NAME, slot: undefined }, SESSION),
      );
      if (r.suggestedAnswersFormat === "boolean") booleans++;
      else choices++;
    }
    assert.ok(booleans > 50, `boolean count too low: ${booleans}`);
    assert.ok(choices > 50, `choice count too low: ${choices}`);
  });

  it("equal scoring: one boolean correct + one choice correct → totalCorrect 2", async () => {
    const cfg = makeConfig({ answersFormat: { boolean: 1, choice: 1 } });

    // Save a boolean question
    const saveQuestion = createSaveQuestionTool(data, () => cfg, fixtureGetGames);
    const boolean = parseToolResult(
      await saveQuestion.handler(
        {
          game: FIXTURE_GAME_NAME,
          answersFormat: "boolean",
          questionType: "fact",
          sourceUrl: undefined,
          eventDate: undefined,
          context: undefined,
          category: "Geography",
          statement: "The Earth is round.",
          isTrue: true,
          choices: undefined,
          correctIndex: undefined,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🌍"],
        },
        SESSION,
      ),
    );

    // Save a choice question
    const choice = parseToolResult(
      await saveQuestion.handler(
        {
          game: FIXTURE_GAME_NAME,
          answersFormat: "choice",
          questionType: "fact",
          sourceUrl: undefined,
          eventDate: undefined,
          context: undefined,
          category: "Astronomy",
          statement: "Which is the smallest planet?",
          isTrue: undefined,
          choices: ["Mercury", "Venus", "Earth", "Mars"],
          correctIndex: 0,
          suggestedDifficulty: undefined,
          difficulty: undefined,
          slot: undefined,
          emojis: ["🪐"],
        },
        SESSION,
      ),
    );

    // Submit one correct answer to each
    const submit = createSubmitAnswersTool(data, fixtureGetGames);
    await submit.handler(
      {
        game: FIXTURE_GAME_NAME,
        questionId: boolean.question.id,
        messageLink: "https://slack/b",
        postedAt: 1000,
        answers: [{ userId: "U1", displayName: "Alice", answer: true, answerIndex: undefined }],
      },
      SESSION,
    );
    const result = parseToolResult(
      await submit.handler(
        {
          game: FIXTURE_GAME_NAME,
          questionId: choice.question.id,
          messageLink: "https://slack/c",
          postedAt: 2000,
          answers: [{ userId: "U1", displayName: "Alice", answer: undefined, answerIndex: 0 }],
        },
        SESSION,
      ),
    );
    assert.equal(result.results[0].correct, true);
    assert.equal(result.results[0].totalCorrect, 2);
    assert.equal(result.results[0].totalAnswered, 2);
  });
});
