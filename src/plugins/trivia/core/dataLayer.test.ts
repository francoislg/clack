import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createSdkDataLayer } from "./dataLayer.js";
import { _resetTriviaConfigBridge } from "./configBridge.js";
import { createFakeSdk, primeTriviaConfig } from "../testHelpers.fakeSdk.js";

describe("dataLayer — fallback season seed", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("seeds a season-YYYY-MM starter (no axis fields) for a config-edited game with no seasons.json", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [], seasons: { enabled: true, prompt: "p" } });
    const data = createSdkDataLayer(sdk);

    const state = await data.forGame("staging").loadSeasonsState();

    assert.ok(state !== null);
    assert.equal(state.seasons.length, 1);
    const entry = state.seasons[0];
    assert.match(entry.slug, /^season-\d{4}-\d{2}$/);
    assert.ok(entry.startedAt < entry.expectedEndAt);
    assert.equal(entry.categories, undefined);
    assert.equal(entry.format, undefined);
    assert.equal(entry.answersFormat, undefined);
    assert.equal(entry.theme, undefined);
    assert.ok(testHelpers.files.has("games/staging/seasons.json"));
  });

  it("returns null and writes nothing when seasons are disabled", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    primeTriviaConfig(sdk);

    const data = createSdkDataLayer(sdk);

    assert.equal(await data.forGame("staging").loadSeasonsState(), null);
    assert.equal(testHelpers.files.has("games/staging/seasons.json"), false);
  });

  it("does not re-seed when a seasons.json already exists", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [], seasons: { enabled: true, prompt: "p" } });
    testHelpers.files.set(
      "games/staging/seasons.json",
      JSON.stringify({ seasons: [{ slug: "kickoff-2026", startedAt: 1, expectedEndAt: 2 }] }),
    );
    const data = createSdkDataLayer(sdk);

    const state = await data.forGame("staging").loadSeasonsState();

    assert.deepEqual(state, {
      seasons: [{ slug: "kickoff-2026", startedAt: 1, expectedEndAt: 2 }],
    });
  });

  it("loads legacy entries and teams-stamped entries side by side, unchanged", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [], seasons: { enabled: true, prompt: "p" } });
    const stamped = {
      slug: "season-2026-06",
      startedAt: 1,
      expectedEndAt: 2,
      endedAt: 2,
      teamsStamp: {
        teams: [{ name: "Red", userIds: ["U1"] }],
        teamsScoring: "one-right-is-right",
      },
    };
    const legacy = { slug: "season-2026-05", startedAt: 0, expectedEndAt: 1, endedAt: 1 };
    testHelpers.files.set(
      "games/staging/seasons.json",
      JSON.stringify({ seasons: [legacy, stamped] }),
    );
    const data = createSdkDataLayer(sdk);

    const state = await data.forGame("staging").loadSeasonsState();

    assert.equal(state?.seasons[0].teamsStamp, undefined);
    assert.deepEqual(state, { seasons: [legacy, stamped] });
  });
});

describe("dataLayer — graceful JSON reads", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("falls back to empty on malformed JSON", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    testHelpers.files.set("games/g/questions.json", "{ not json");
    const data = createSdkDataLayer(sdk);
    assert.deepEqual(await data.forGame("g").loadQuestions(), []);
  });

  it("falls back to empty when the shape is wrong (missing load-bearing field)", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    testHelpers.files.set("games/g/answers.json", JSON.stringify([{ userId: "U1" }])); // no questionId
    const data = createSdkDataLayer(sdk);
    assert.deepEqual(await data.forGame("g").loadAnswers(), []);
  });

  it("returns records untouched when the load-bearing fields are present, preserving extra fields", async () => {
    const stored = [{ id: "q1", statement: "S", answersFormat: "boolean", futureField: 7 }];
    const { sdk, testHelpers } = createFakeSdk();
    testHelpers.files.set("games/g/questions.json", JSON.stringify(stored));
    const data = createSdkDataLayer(sdk);
    assert.deepEqual(await data.forGame("g").loadQuestions(), stored);
  });

  it("falls back to empty when categories.json is not an array of strings", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    testHelpers.files.set("categories.json", JSON.stringify({ bad: true }));
    const data = createSdkDataLayer(sdk);
    assert.deepEqual(await data.loadCategories(), []);
  });
});
