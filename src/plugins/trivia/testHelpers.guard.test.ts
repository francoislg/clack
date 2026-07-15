import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Enforces the canonical-fakes rule: a collaborator in a test gets either the
 * canonical fake from testHelpers.ts (extended via its `overrides` param when a
 * variant is needed) or a `vi.mock` with interaction assertions — never a local
 * stub that re-implements the dependency's behavior and drifts from it.
 *
 * Scoped to `t` and `actionId` because those two have exactly ONE faithful
 * rendering (the one in createFakeSdk) — re-implementing them is never a
 * legitimate override, unlike behavior-bearing members (readFile, dmOwner,
 * logger, …) which tests may rightfully replace per-scenario.
 *
 * A guard, not a unit test — it greps the plugin's test files so a hand-rolled
 * stub fails the build with a pointer to the sanctioned alternatives.
 */
const TRIVIA_DIR = dirname(fileURLToPath(import.meta.url));

const RENDER_MEMBER_STUB = /^\s*(t|actionId):\s*(\(|vi\.fn)/;

function testFiles(): { name: string; lines: string[] }[] {
  return readdirSync(TRIVIA_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".test.ts") && !f.endsWith("testHelpers.guard.test.ts"))
    .map((name) => ({
      name,
      lines: readFileSync(join(TRIVIA_DIR, name), "utf8").split("\n"),
    }));
}

describe("canonical fakes guard", () => {
  it("no test re-implements sdk.t or sdk.actionId — use createFakeSdk()", () => {
    const offenders: string[] = [];
    for (const { name, lines } of testFiles()) {
      lines.forEach((line, i) => {
        if (RENDER_MEMBER_STUB.test(line)) {
          offenders.push(`${name}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
