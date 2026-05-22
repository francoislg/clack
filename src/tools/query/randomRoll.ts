import { z } from "zod";
import { tool } from "@anthropic-ai/claude-agent-sdk";
import { randomInt } from "node:crypto";
import { textResult, errorResult } from "../helpers.js";

const MAX_COUNT = 1000;

export interface RandomRollDeps {
  /** Returns a uniformly random integer in [min, max] inclusive. */
  rollOne: (min: number, max: number) => number;
}

export const defaultDeps: RandomRollDeps = {
  rollOne: (min, max) => randomInt(min, max + 1),
};

export function createRandomRollTool(deps: RandomRollDeps = defaultDeps) {
  return tool(
    "random_roll",
    "Roll a random integer (or several) in an inclusive range. Useful for dice rolls, random selections, and tie-breaking.",
    {
      min: z.number().int().describe("Minimum value, inclusive."),
      max: z.number().int().describe("Maximum value, inclusive."),
      count: z
        .number()
        .int()
        .optional()
        .describe(`How many rolls to make (default: 1, max: ${MAX_COUNT}).`),
    },
    async ({ min, max, count }) => {
      if (min > max) {
        return errorResult(`min (${min}) must be <= max (${max}).`);
      }
      const n = count ?? 1;
      if (n < 1) {
        return errorResult(`count (${n}) must be >= 1.`);
      }
      if (n > MAX_COUNT) {
        return errorResult(`count (${n}) exceeds maximum of ${MAX_COUNT}.`);
      }

      const rolls = Array.from({ length: n }, () => deps.rollOne(min, max));
      return textResult({ rolls });
    },
  );
}
