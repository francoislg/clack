import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { resolveRevealResponses } from "./revealResponsesResolver.js";

describe("resolveRevealResponses", () => {
  it('returns "yes" when nothing overrides', () => {
    assert.equal(resolveRevealResponses({}), "yes");
  });

  it("workspace config wins when game / season / slot are absent", () => {
    assert.equal(resolveRevealResponses({ config: { revealResponses: "no" } }), "no");
  });

  it("game wins over workspace", () => {
    assert.equal(
      resolveRevealResponses({
        game: { revealResponses: "just-correctness" },
        config: { revealResponses: "yes" },
      }),
      "just-correctness",
    );
  });

  it("season wins over game", () => {
    assert.equal(
      resolveRevealResponses({
        season: { revealResponses: "no" },
        game: { revealResponses: "just-correctness" },
        config: { revealResponses: "yes" },
      }),
      "no",
    );
  });

  it("slot wins over season", () => {
    assert.equal(
      resolveRevealResponses({
        slot: { revealResponses: "yes" },
        season: { revealResponses: "no" },
        game: { revealResponses: "no" },
        config: { revealResponses: "no" },
      }),
      "yes",
    );
  });

  it("falls through past tiers with undefined fields", () => {
    assert.equal(
      resolveRevealResponses({
        slot: {},
        season: {},
        game: {},
        config: { revealResponses: "just-correctness" },
      }),
      "just-correctness",
    );
  });

  it("uses default when every tier has undefined", () => {
    assert.equal(resolveRevealResponses({ slot: {}, season: {}, game: {}, config: {} }), "yes");
  });
});
