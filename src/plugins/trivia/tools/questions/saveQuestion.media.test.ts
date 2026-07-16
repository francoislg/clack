import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createSaveQuestionTool } from "./saveQuestion.js";
import { parseToolResult } from "../../../../tools/testHelpers.js";

const SESSION = { sessionId: "test" };

const VALID_MEDIA = {
  kind: "image" as const,
  url: "https://upload.wikimedia.org/x/thumb.jpg",
  altText: "A photograph of the Eiffel Tower",
  subjectId: "wikidata:Q243",
  title: "Eiffel Tower",
  license: "CC-BY-SA 4.0",
  attribution: "via Wikimedia Commons",
};

// Common all-optional-fields-present base; per-test we override the discriminator fields.
const BASE = {
  game: FIXTURE_GAME_NAME,
  category: "Landmarks",
  statement: "Which landmark is shown in the image?",
  questionType: "fact" as const,
  sourceUrl: undefined,
  eventDate: undefined,
  context: undefined,
  isTrue: undefined,
  choices: undefined,
  correctIndex: undefined,
  expectedAnswer: undefined,
  acceptableAnswers: undefined,
  gradingNotes: undefined,
  freeformAnswerShape: undefined,
  suggestedDifficulty: undefined,
  difficulty: undefined,
  points: undefined,
  slot: undefined,
  hint: undefined,
  media: undefined,
  emojis: ["🗼"],
  choiceEmojis: undefined,
};

describe("save_question — promptMedium / media", () => {
  let data: FakeTriviaDataLayer;
  beforeEach(async () => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;
    await data.saveCategories(["Landmarks"]);
  });

  it("image + choice saves with media", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        {
          ...BASE,
          answersFormat: "choice",
          promptMedium: "image",
          media: VALID_MEDIA,
          choices: ["Eiffel Tower", "Big Ben", "Tokyo Tower", "Space Needle"],
          correctIndex: 0,
        },
        SESSION,
      ),
    );
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.promptMedium, "image");
    assert.deepEqual(parsed.question.media, VALID_MEDIA);
  });

  it("image + boolean saves with media", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        {
          ...BASE,
          answersFormat: "boolean",
          promptMedium: "image",
          media: VALID_MEDIA,
          isTrue: true,
        },
        SESSION,
      ),
    );
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.media.subjectId, "wikidata:Q243");
  });

  it("image + freeform saves with media", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        {
          ...BASE,
          answersFormat: "freeform",
          promptMedium: "image",
          media: VALID_MEDIA,
          expectedAnswer: "Eiffel Tower",
          freeformAnswerShape: "name",
        },
        SESSION,
      ),
    );
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.promptMedium, "image");
  });

  it("text medium stamps promptMedium and omits media", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        { ...BASE, answersFormat: "boolean", promptMedium: "text", isTrue: true },
        SESSION,
      ),
    );
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.promptMedium, "text");
    assert.equal(parsed.question.media, undefined);
  });

  it("absent promptMedium defaults to text on the record", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        { ...BASE, answersFormat: "boolean", promptMedium: undefined, isTrue: true },
        SESSION,
      ),
    );
    assert.equal(parsed.question.promptMedium, "text");
  });

  it("rejects image medium without media", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        { ...BASE, answersFormat: "boolean", promptMedium: "image", isTrue: true },
        SESSION,
      ),
    );
    assert.match(parsed.error, /requires a `media` object/);
  });

  it("rejects media on text medium", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        {
          ...BASE,
          answersFormat: "boolean",
          promptMedium: "text",
          media: VALID_MEDIA,
          isTrue: true,
        },
        SESSION,
      ),
    );
    assert.match(parsed.error, /only permitted when promptMedium is "image"/);
  });

  it("rejects non-HTTPS media url", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        {
          ...BASE,
          answersFormat: "boolean",
          promptMedium: "image",
          media: { ...VALID_MEDIA, url: "http://insecure.example/x.jpg" },
          isTrue: true,
        },
        SESSION,
      ),
    );
    assert.match(parsed.error, /must be an HTTPS URL/);
  });

  it("rejects empty required media subfield", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        {
          ...BASE,
          answersFormat: "boolean",
          promptMedium: "image",
          media: { ...VALID_MEDIA, title: "   " },
          isTrue: true,
        },
        SESSION,
      ),
    );
    assert.match(parsed.error, /media\.title must be a non-empty string/);
  });

  it("rejects altText over 2000 chars", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        {
          ...BASE,
          answersFormat: "boolean",
          promptMedium: "image",
          media: { ...VALID_MEDIA, altText: "x".repeat(2001) },
          isTrue: true,
        },
        SESSION,
      ),
    );
    assert.match(parsed.error, /≤2000 characters/);
  });

  it("strips Slack control sequences from altText", async () => {
    const tool = createSaveQuestionTool(data, () => null, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        {
          ...BASE,
          answersFormat: "boolean",
          promptMedium: "image",
          media: { ...VALID_MEDIA, altText: "Photo <@U123> of a tower" },
          isTrue: true,
        },
        SESSION,
      ),
    );
    assert.equal(parsed.saved, true);
    assert.equal(parsed.question.media.altText, "Photo  of a tower");
  });
});
