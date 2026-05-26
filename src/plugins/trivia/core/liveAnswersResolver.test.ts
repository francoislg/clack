import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { resolveLiveAnswersVisible } from "./liveAnswersResolver.js";

describe("resolveLiveAnswersVisible", () => {
  it("returns true when nothing overrides", () => {
    assert.equal(resolveLiveAnswersVisible({}), true);
  });

  it("workspace config wins when game / season / slot are absent", () => {
    assert.equal(resolveLiveAnswersVisible({ config: { liveAnswersVisible: false } }), false);
  });

  it("game wins over workspace", () => {
    assert.equal(
      resolveLiveAnswersVisible({
        game: { liveAnswersVisible: false },
        config: { liveAnswersVisible: true },
      }),
      false,
    );
  });

  it("season wins over game", () => {
    assert.equal(
      resolveLiveAnswersVisible({
        season: { liveAnswersVisible: true },
        game: { liveAnswersVisible: false },
        config: { liveAnswersVisible: false },
      }),
      true,
    );
  });

  it("slot wins over season", () => {
    assert.equal(
      resolveLiveAnswersVisible({
        slot: { liveAnswersVisible: false },
        season: { liveAnswersVisible: true },
        game: { liveAnswersVisible: true },
        config: { liveAnswersVisible: true },
      }),
      false,
    );
  });

  it("respects explicit false at workspace tier", () => {
    assert.equal(resolveLiveAnswersVisible({ config: { liveAnswersVisible: false } }), false);
  });

  it("falls through past tiers with undefined fields", () => {
    assert.equal(
      resolveLiveAnswersVisible({
        slot: {},
        season: {},
        game: {},
        config: { liveAnswersVisible: false },
      }),
      false,
    );
  });

  it("uses default when every tier has undefined", () => {
    assert.equal(resolveLiveAnswersVisible({ slot: {}, season: {}, game: {}, config: {} }), true);
  });
});
