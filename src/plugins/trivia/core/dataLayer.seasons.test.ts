import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createSdkDataLayer } from "./dataLayer.js";
import { _resetTriviaConfigBridge } from "./configBridge.js";
import { createFakeSdk, primeTriviaConfig } from "../testHelpers.fakeSdk.js";

function seed(files: Map<string, string>, seasons: unknown[]): void {
  files.set("games/staging/seasons.json", JSON.stringify({ seasons }));
}

describe("dataLayer — permissive seasons.json reader", () => {
  beforeEach(() => {
    _resetTriviaConfigBridge();
  });

  it("parses a pre-phase seasons.json with no phases and logs no warning", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [], seasons: { enabled: true, prompt: "p" } });
    seed(testHelpers.files, [{ slug: "kickoff-2026", startedAt: 1, expectedEndAt: 2 }]);
    const data = createSdkDataLayer(sdk);

    const state = await data.forGame("staging").loadSeasonsState();

    assert.deepEqual(state, {
      seasons: [{ slug: "kickoff-2026", startedAt: 1, expectedEndAt: 2 }],
    });
    assert.equal(sdk.logger.warn.mock.calls.length, 0);
  });

  it("preserves unknown/legacy top-level fields on a season (passthrough round-trip)", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [], seasons: { enabled: true, prompt: "p" } });
    const legacy = {
      slug: "s1",
      startedAt: 1,
      expectedEndAt: 2,
      mysteryField: { deep: [1, 2] },
    };
    seed(testHelpers.files, [legacy]);
    const data = createSdkDataLayer(sdk);

    const state = await data.forGame("staging").loadSeasonsState();

    assert.deepEqual(state, { seasons: [legacy] });
    assert.equal(sdk.logger.warn.mock.calls.length, 0);
  });

  it("drops a phases that is a string but keeps the season", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [], seasons: { enabled: true, prompt: "p" } });
    seed(testHelpers.files, [{ slug: "s1", startedAt: 1, expectedEndAt: 2, phases: "oops" }]);
    const data = createSdkDataLayer(sdk);

    const state = await data.forGame("staging").loadSeasonsState();

    assert.equal(state?.seasons.length, 1);
    assert.deepEqual(state?.seasons[0], { slug: "s1", startedAt: 1, expectedEndAt: 2 });
    assert.equal("phases" in (state?.seasons[0] ?? {}), false);
    assert.ok(sdk.logger.warn.mock.calls.length >= 1);
  });

  it("drops an invariant-violating phases whole but keeps the season", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [], seasons: { enabled: true, prompt: "p" } });
    seed(testHelpers.files, [
      { slug: "s1", startedAt: 1, expectedEndAt: 2, phases: [{ slug: "p1" }, { slug: "p2" }] },
    ]);
    const data = createSdkDataLayer(sdk);

    const state = await data.forGame("staging").loadSeasonsState();

    assert.equal(state?.seasons.length, 1);
    assert.deepEqual(state?.seasons[0], { slug: "s1", startedAt: 1, expectedEndAt: 2 });
    assert.ok(sdk.logger.warn.mock.calls.length >= 1);
  });

  it("yields empty season state and logs a warning for a literally-malformed seasons.json", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [], seasons: { enabled: true, prompt: "p" } });
    testHelpers.files.set("games/staging/seasons.json", "{ not valid json");
    const data = createSdkDataLayer(sdk);

    const state = await data.forGame("staging").loadSeasonsState();

    assert.deepEqual(state, { seasons: [] });
    assert.ok(sdk.logger.warn.mock.calls.length >= 1);
  });

  it("drops one malformed season without affecting its siblings", async () => {
    const { sdk, testHelpers } = createFakeSdk();
    primeTriviaConfig(sdk, { games: [], seasons: { enabled: true, prompt: "p" } });
    const good = { slug: "good", startedAt: 1, expectedEndAt: 2 };
    seed(testHelpers.files, [good, { slug: "bad", startedAt: "nope", expectedEndAt: 2 }]);
    const data = createSdkDataLayer(sdk);

    const state = await data.forGame("staging").loadSeasonsState();

    assert.deepEqual(state, { seasons: [good] });
    assert.ok(sdk.logger.warn.mock.calls.length >= 1);
  });
});
