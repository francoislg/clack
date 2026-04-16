import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryDataLayer } from "./testHelpers.js";
import { createFindPreviousQuestionsTool } from "./findPreviousQuestions.js";
import type { TriviaDataLayer } from "./types.js";

const SESSION = { sessionId: "test" };

function parseResult(result: { content: { text: string }[] }) {
  return JSON.parse(result.content[0].text);
}

describe("find_previous_questions response shape", () => {
  let data: TriviaDataLayer;

  beforeEach(async () => {
    data = createInMemoryDataLayer();
    await data.saveQuestion({
      id: "q1",
      category: "Science",
      statement: "Water boils at 100 degrees Celsius",
      isTrue: true,
      emojis: ["🔬"],
      createdAt: 1,
      postedAt: 1500,
      messageLink: "https://slack.com/archives/C/p1",
    });
    await data.saveQuestion({
      id: "q2",
      category: "Science",
      statement: "The Earth is flat",
      isTrue: false,
      emojis: ["🌍"],
      createdAt: 2,
    });
    await data.saveQuestion({
      id: "q3",
      category: "History",
      statement: "Rome was founded in 753 BC",
      isTrue: true,
      emojis: ["🏛️"],
      createdAt: 3,
    });
  });

  it("omits isTrue from every returned question (category-only search)", async () => {
    const tool = createFindPreviousQuestionsTool(data);
    const result = await tool.handler(
      { category: "Science", text: undefined, limit: undefined },
      SESSION,
    );
    const parsed = parseResult(result);

    assert.equal(parsed.count, 2);
    for (const q of parsed.questions) {
      assert.equal(
        Object.prototype.hasOwnProperty.call(q, "isTrue"),
        false,
        `question ${q.id} must not include isTrue`,
      );
    }
  });

  it("omits isTrue from every returned question (text-only search)", async () => {
    const tool = createFindPreviousQuestionsTool(data);
    const result = await tool.handler(
      { category: undefined, text: "boils", limit: undefined },
      SESSION,
    );
    const parsed = parseResult(result);

    assert.equal(parsed.count, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.questions[0], "isTrue"), false);
  });

  it("omits isTrue from every returned question (both filters)", async () => {
    const tool = createFindPreviousQuestionsTool(data);
    const result = await tool.handler(
      { category: "Science", text: "Earth", limit: undefined },
      SESSION,
    );
    const parsed = parseResult(result);

    assert.equal(parsed.count, 1);
    assert.equal(parsed.questions[0].id, "q2");
    assert.equal(Object.prototype.hasOwnProperty.call(parsed.questions[0], "isTrue"), false);
  });

  it("returns the search-safe field set", async () => {
    const tool = createFindPreviousQuestionsTool(data);
    const result = await tool.handler(
      { category: undefined, text: "boils", limit: undefined },
      SESSION,
    );
    const parsed = parseResult(result);

    const q = parsed.questions[0];
    assert.deepEqual(Object.keys(q).sort(), [
      "category",
      "createdAt",
      "emojis",
      "id",
      "messageLink",
      "postedAt",
      "statement",
    ]);
  });

  it("omits postedAt and messageLink when not stored", async () => {
    const tool = createFindPreviousQuestionsTool(data);
    const result = await tool.handler(
      { category: undefined, text: "Earth", limit: undefined },
      SESSION,
    );
    const parsed = parseResult(result);

    const q = parsed.questions[0];
    assert.equal(Object.prototype.hasOwnProperty.call(q, "postedAt"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "messageLink"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(q, "isTrue"), false);
  });

  it("returns empty array for no matches without leaking answer keys elsewhere", async () => {
    const tool = createFindPreviousQuestionsTool(data);
    const result = await tool.handler(
      { category: "Science", text: "Rome", limit: undefined },
      SESSION,
    );
    const parsed = parseResult(result);

    assert.equal(parsed.count, 0);
    assert.deepEqual(parsed.questions, []);
    assert.equal(Object.prototype.hasOwnProperty.call(parsed, "isTrue"), false);
  });
});
