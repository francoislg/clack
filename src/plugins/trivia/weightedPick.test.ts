import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { weightedPick } from "./weightedPick.js";

/** Deterministic RNG that cycles through a fixed sequence (mod length). */
function seqRng(values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i % values.length];
    i++;
    return v;
  };
}

describe("weightedPick", () => {
  it("returns the only positive-weight key in a single-positive map", () => {
    const result = weightedPick({ a: 5, b: 0 }, () => 0.5);
    assert.equal(result, "a");
  });

  it("returns null when all weights are zero", () => {
    assert.equal(
      weightedPick({ a: 0, b: 0 }, () => 0.5),
      null,
    );
  });

  it("returns null when the map is empty", () => {
    const empty: Record<string, number> = {};
    assert.equal(
      weightedPick(empty, () => 0.5),
      null,
    );
  });

  it("respects weight ratios over many rolls", () => {
    // boolean:2 vs choice:1 → 2/3 boolean, 1/3 choice
    const N = 6000;
    let boolCount = 0;
    let choiceCount = 0;
    const rng = Math.random;
    for (let i = 0; i < N; i++) {
      const r = weightedPick({ boolean: 2, choice: 1 }, rng);
      if (r === "boolean") boolCount++;
      else if (r === "choice") choiceCount++;
    }
    const boolRatio = boolCount / N;
    const choiceRatio = choiceCount / N;
    // 2/3 ≈ 0.667, 1/3 ≈ 0.333; tolerance ±0.04 at N=6000
    assert.ok(Math.abs(boolRatio - 2 / 3) < 0.04, `boolean ratio off: ${boolRatio}`);
    assert.ok(Math.abs(choiceRatio - 1 / 3) < 0.04, `choice ratio off: ${choiceRatio}`);
  });

  it("uniform over equal weights", () => {
    const N = 6000;
    const counts: Record<string, number> = { a: 0, b: 0, c: 0, d: 0 };
    for (let i = 0; i < N; i++) {
      const k = weightedPick({ a: 1, b: 1, c: 1, d: 1 });
      if (k) counts[k]++;
    }
    for (const k of Object.keys(counts)) {
      const r = counts[k] / N;
      assert.ok(Math.abs(r - 0.25) < 0.03, `key ${k} ratio off: ${r}`);
    }
  });

  it("skips zero-weight keys (never picks them)", () => {
    const N = 1000;
    let zeroPicked = 0;
    for (let i = 0; i < N; i++) {
      const r = weightedPick({ a: 0, b: 1 });
      if (r === "a") zeroPicked++;
    }
    assert.equal(zeroPicked, 0);
  });

  it("deterministic at fixed roll values", () => {
    // weights: a=2, b=1, c=1 (total 4). Cumulative: a=[0,2), b=[2,3), c=[3,4)
    // rng outputs roll * total: roll=0.1 → 0.4 → a; roll=0.6 → 2.4 → b; roll=0.85 → 3.4 → c
    const rng = seqRng([0.1, 0.6, 0.85]);
    assert.equal(weightedPick({ a: 2, b: 1, c: 1 }, rng), "a");
    assert.equal(weightedPick({ a: 2, b: 1, c: 1 }, rng), "b");
    assert.equal(weightedPick({ a: 2, b: 1, c: 1 }, rng), "c");
  });
});
