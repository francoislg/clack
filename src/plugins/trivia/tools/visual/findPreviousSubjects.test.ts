import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import {
  createTriviaDataLayer,
  FIXTURE_GAME_NAME,
  fixtureGetGames,
  type FakeTriviaDataLayer,
} from "../../testHelpers.js";
import { createFakeSdk, primeTriviaConfig } from "../../testHelpers.fakeSdk.js";
import { createFindPreviousSubjectsTool } from "./findPreviousSubjects.js";
import { parseToolResult } from "../../../../plugins-sdk/testHelpers.js";
import type { TriviaQuestion } from "../../core/types.js";

const SESSION = { sessionId: "test" };

function imageQuestion(overrides: Partial<TriviaQuestion> & { subjectId: string }): TriviaQuestion {
  const { subjectId, ...rest } = overrides;
  return {
    id: rest.id ?? `q-${subjectId}`,
    category: "Landmarks",
    statement: "Which landmark is shown?",
    answersFormat: "choice",
    questionType: "fact",
    promptMedium: "image",
    media: {
      kind: "image",
      url: "https://x/y.jpg",
      altText: "alt",
      subjectId,
      title: `Title ${subjectId}`,
    },
    emojis: ["🗼"],
    createdAt: rest.createdAt ?? 1000,
    ...rest,
  };
}

describe("find_previous_subjects", () => {
  let data: FakeTriviaDataLayer;
  beforeEach(() => {
    const { sdk } = createFakeSdk();
    primeTriviaConfig(sdk);
    const { dataLayer } = createTriviaDataLayer(sdk);
    data = dataLayer;
  });

  it("returns a match on exact subjectId", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(imageQuestion({ subjectId: "wikidata:Q243" }));
    const tool = createFindPreviousSubjectsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, subjectId: "wikidata:Q243", season: undefined },
        SESSION,
      ),
    );
    assert.equal(parsed.count, 1);
    assert.equal(parsed.matches[0].media.subjectId, "wikidata:Q243");
    assert.equal(parsed.matches[0].media.title, "Title wikidata:Q243");
  });

  it("misses on a different subjectId (no cross-namespace match)", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(imageQuestion({ subjectId: "tmdb:m-550" }));
    const tool = createFindPreviousSubjectsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, subjectId: "wikidata:Q172241", season: undefined },
        SESSION,
      ),
    );
    assert.equal(parsed.count, 0);
  });

  it("ignores legacy/text rows without media", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion({
      id: "legacy",
      category: "X",
      statement: "legacy text question",
      answersFormat: "boolean",
      isTrue: true,
      emojis: ["❓"],
      createdAt: 1,
    });
    const tool = createFindPreviousSubjectsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, subjectId: "wikidata:Q243", season: undefined },
        SESSION,
      ),
    );
    assert.equal(parsed.count, 0);
  });

  it("season scoping filters by explicit slug", async () => {
    const scoped = data.forGame(FIXTURE_GAME_NAME);
    await scoped.saveQuestion(
      imageQuestion({ id: "a", subjectId: "wikidata:Q243", season: "spring" }),
    );
    await scoped.saveQuestion(
      imageQuestion({ id: "b", subjectId: "wikidata:Q243", season: "summer" }),
    );
    await scoped.saveSeasonsState({
      seasons: [
        { slug: "spring", startedAt: 1, expectedEndAt: 9_999_999_999_999, categories: ["X"] },
      ],
    });
    const tool = createFindPreviousSubjectsTool(data, fixtureGetGames);
    const all = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, subjectId: "wikidata:Q243", season: "all" },
        SESSION,
      ),
    );
    assert.equal(all.count, 2);
    const spring = parseToolResult(
      await tool.handler(
        { game: FIXTURE_GAME_NAME, subjectId: "wikidata:Q243", season: "spring" },
        SESSION,
      ),
    );
    assert.equal(spring.count, 1);
    assert.equal(spring.matches[0].id, "a");
  });

  it("rejects an empty subjectId", async () => {
    const tool = createFindPreviousSubjectsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: FIXTURE_GAME_NAME, subjectId: "   ", season: undefined }, SESSION),
    );
    assert.match(parsed.error, /non-empty/);
  });

  it("rejects an unknown game", async () => {
    const tool = createFindPreviousSubjectsTool(data, fixtureGetGames);
    const parsed = parseToolResult(
      await tool.handler({ game: "nope", subjectId: "wikidata:Q243", season: undefined }, SESSION),
    );
    assert.ok(parsed.error);
  });
});
