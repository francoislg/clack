import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { parseToolResult } from "../testHelpers.js";
import { createRandomRollTool, type RandomRollDeps } from "./randomRoll.js";

function callTool(args: { min: number; max: number; count?: number }, deps?: RandomRollDeps) {
  const toolDef = createRandomRollTool(deps);
  return toolDef.handler({ count: undefined, ...args }, { sessionId: "test" });
}

describe("randomRoll tool", () => {
  it("returns a single roll by default", async () => {
    const rollOne = vi.fn<RandomRollDeps["rollOne"]>(() => 4);
    const result = await callTool({ min: 1, max: 6 }, { rollOne });

    const parsed = parseToolResult(result);
    assert.deepEqual(parsed, { rolls: [4] });
    assert.equal(rollOne.mock.calls.length, 1);
    assert.deepEqual(rollOne.mock.calls[0], [1, 6]);
  });

  it("returns `count` rolls when provided", async () => {
    let i = 0;
    const sequence = [1, 2, 3, 4, 5];
    const rollOne = vi.fn<RandomRollDeps["rollOne"]>(() => sequence[i++]);
    const result = await callTool({ min: 1, max: 6, count: 5 }, { rollOne });

    const parsed = parseToolResult(result);
    assert.deepEqual(parsed, { rolls: [1, 2, 3, 4, 5] });
  });

  it("accepts a single-value range (min === max)", async () => {
    const rollOne = vi.fn<RandomRollDeps["rollOne"]>(() => 7);
    const result = await callTool({ min: 7, max: 7, count: 3 }, { rollOne });

    const parsed = parseToolResult(result);
    assert.deepEqual(parsed, { rolls: [7, 7, 7] });
  });

  it("accepts negative ranges", async () => {
    const rollOne = vi.fn<RandomRollDeps["rollOne"]>(() => -3);
    const result = await callTool({ min: -10, max: -1 }, { rollOne });

    const parsed = parseToolResult(result);
    assert.deepEqual(parsed, { rolls: [-3] });
    assert.deepEqual(rollOne.mock.calls[0], [-10, -1]);
  });

  it("rejects min > max", async () => {
    const result = (await callTool({ min: 10, max: 1 })) as {
      isError?: boolean;
      content: { type: string }[];
    };
    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /min .* must be <= max/);
  });

  it("rejects count < 1", async () => {
    const result = (await callTool({ min: 1, max: 6, count: 0 })) as {
      isError?: boolean;
      content: { type: string }[];
    };
    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /count .* must be >= 1/);
  });

  it("rejects count exceeding the maximum", async () => {
    const result = (await callTool({ min: 1, max: 6, count: 10_000 })) as {
      isError?: boolean;
      content: { type: string }[];
    };
    assert.equal(result.isError, true);
    const parsed = parseToolResult(result);
    assert.match(parsed.error, /exceeds maximum/);
  });

  it("uses crypto-backed default rng when no deps provided", async () => {
    const result = await callTool({ min: 1, max: 6, count: 20 });
    const parsed = parseToolResult(result);
    assert.equal(parsed.rolls.length, 20);
    for (const v of parsed.rolls) {
      assert.ok(Number.isInteger(v), `expected integer, got ${v}`);
      assert.ok(v >= 1 && v <= 6, `expected 1..6, got ${v}`);
    }
  });
});
