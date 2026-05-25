import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { TriviaConfig, TriviaGame } from "../core/configTypes.js";
import { resolveContexts, rollContextPriority } from "./contexts.js";
import type { SeasonEntry } from "../core/types.js";

function makeGame(overrides: Partial<TriviaGame> = {}): TriviaGame {
  return {
    name: "main",
    channel: "C1",
    questionCron: "0 9 * * *",
    revealCron: "0 17 * * *",
    timezone: "UTC",
    enabled: true,
    ...overrides,
  };
}

function makeConfig(trivia?: TriviaConfig): TriviaConfig {
  return trivia ?? {};
}

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

describe("resolveContexts", () => {
  const baseSeason: SeasonEntry = {
    slug: "active",
    startedAt: NOW - HOUR,
    expectedEndAt: NOW + HOUR,
    categories: ["X"],
  };

  it("returns null when no source provides contexts", () => {
    assert.equal(resolveContexts(null, null, null, null), null);
    assert.equal(resolveContexts(null, null, null, makeConfig()), null);
    assert.equal(resolveContexts(baseSeason, null, null, makeConfig()), null);
  });

  it("returns config.trivia.contexts when set and no season override", () => {
    const cfg = makeConfig({ contexts: [{ name: "Quebec" }] });
    assert.deepEqual(resolveContexts(null, null, null, cfg), [{ name: "Quebec" }]);
  });

  it("season contexts override config", () => {
    const season: SeasonEntry = { ...baseSeason, contexts: [{ name: "academic" }] };
    const cfg = makeConfig({ contexts: [{ name: "Quebec" }] });
    assert.deepEqual(resolveContexts(season, null, null, cfg), [{ name: "academic" }]);
  });

  it("slot contexts override season contexts", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      contexts: [{ name: "Quebec" }],
      format: { questions: [{ contexts: [{ name: "pop culture" }] }] },
    };
    assert.deepEqual(resolveContexts(season, 0, null, makeConfig()), [{ name: "pop culture" }]);
  });

  it("slot without contexts falls back to season's contexts", () => {
    const season: SeasonEntry = {
      ...baseSeason,
      contexts: [{ name: "Quebec" }],
      format: { questions: [{}] },
    };
    assert.deepEqual(resolveContexts(season, 0, null, makeConfig()), [{ name: "Quebec" }]);
  });

  it("game contexts override workspace contexts", () => {
    const game = makeGame({ contexts: [{ name: "Quebec" }] });
    const cfg = makeConfig({ contexts: [{ name: "International" }] });
    assert.deepEqual(resolveContexts(null, null, game, cfg), [{ name: "Quebec" }]);
  });

  it("season contexts override game contexts", () => {
    const season: SeasonEntry = { ...baseSeason, contexts: [{ name: "academic" }] };
    const game = makeGame({ contexts: [{ name: "Quebec" }] });
    assert.deepEqual(resolveContexts(season, null, game, makeConfig()), [{ name: "academic" }]);
  });

  it("game without contexts falls through to workspace", () => {
    const game = makeGame(); // no contexts
    const cfg = makeConfig({ contexts: [{ name: "International" }] });
    assert.deepEqual(resolveContexts(null, null, game, cfg), [{ name: "International" }]);
  });

  it("game contexts wins when only workspace is also set (no season/slot)", () => {
    const game = makeGame({ contexts: [{ name: "Quebec" }, { name: "Montreal" }] });
    const cfg = makeConfig({ contexts: [{ name: "International" }] });
    assert.deepEqual(resolveContexts(null, null, game, cfg), [
      { name: "Quebec" },
      { name: "Montreal" },
    ]);
  });
});

describe("rollContextPriority", () => {
  it("empty list yields empty array", () => {
    assert.deepEqual(rollContextPriority([]), []);
  });

  it("single entry yields a single-element array", () => {
    assert.deepEqual(rollContextPriority([{ name: "Quebec" }]), ["Quebec"]);
  });

  it("output is always a permutation of input names", () => {
    const input = [{ name: "A" }, { name: "B" }, { name: "" }, { name: "C" }];
    for (let i = 0; i < 50; i++) {
      const out = rollContextPriority(input);
      assert.equal(out.length, 4);
      assert.deepEqual([...out].sort(), ["", "A", "B", "C"]);
    }
  });

  it("high-weight entry appears at index 0 most of the time", () => {
    // 5:1 ratio → ~83% chance of "Quebec" first
    const input = [
      { name: "Quebec", weight: 5 },
      { name: "International", weight: 1 },
    ];
    let quebecFirst = 0;
    const iterations = 2000;
    for (let i = 0; i < iterations; i++) {
      const out = rollContextPriority(input);
      if (out[0] === "Quebec") quebecFirst++;
    }
    const ratio = quebecFirst / iterations;
    // Expected ~0.833; allow ±0.05 for sampling noise
    assert.ok(
      ratio > 0.75 && ratio < 0.9,
      `expected Quebec-first ratio around 0.83, got ${ratio.toFixed(3)}`,
    );
  });

  it("missing weight defaults to 1 (uniform when all unspecified)", () => {
    const input = [{ name: "A" }, { name: "B" }, { name: "C" }];
    const firstCounts: Record<string, number> = { A: 0, B: 0, C: 0 };
    const iterations = 3000;
    for (let i = 0; i < iterations; i++) {
      const out = rollContextPriority(input);
      firstCounts[out[0]]++;
    }
    // Each entry should appear first about 1/3 of the time (~1000); allow ±150 for noise
    for (const name of ["A", "B", "C"]) {
      assert.ok(
        Math.abs(firstCounts[name] - 1000) < 200,
        `expected ~1000 first-appearances for ${name}, got ${firstCounts[name]}`,
      );
    }
  });

  it("empty-string name is treated as a normal entry", () => {
    const input = [{ name: "" }, { name: "Quebec" }];
    let emptyFirst = 0;
    for (let i = 0; i < 1000; i++) {
      const out = rollContextPriority(input);
      if (out[0] === "") emptyFirst++;
    }
    // 50/50 split — allow generous tolerance
    assert.ok(emptyFirst > 350 && emptyFirst < 650, `expected ~500 empty-first, got ${emptyFirst}`);
  });
});
