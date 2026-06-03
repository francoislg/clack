import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { rollContextPriority } from "./contexts.js";

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
    // Each entry should appear first about 1/3 of the time (~1000); allow ±200 for noise
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
