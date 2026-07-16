import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Enforces the canonical-fakes rule: a collaborator in a test gets either the
 * canonical fake from testHelpers.fakeSdk.ts / testHelpers.ts (extended via its
 * overrides param or the mock API when a variant is needed) or a `vi.mock` at the
 * boundary — never a local object literal that re-implements the collaborator and
 * drifts from it, and never a closure capture array where a mock's own call
 * history serves.
 *
 * What is NOT guarded here anymore: overriding `t`/`actionId`/`viewCallbackId` is
 * a compile error (they are plain functions on `FakeSdk`, absent from its mock
 * block), and mocking `dmOwner`/`readFile`/`writeFile` is the sanctioned path —
 * every collaborator member of the canonical fake is a vi.fn.
 *
 * Note: spies sit at the collaborator's public surface, and internal cross-calls
 * (e.g. `saveQuestion` reading `loadQuestions` through a closure) bypass them by
 * design — a test observes what the unit under test asked for, not the
 * collaborator's plumbing.
 *
 * A guard, not a unit test — it greps the plugin's test files so an offending
 * pattern fails the build with a pointer to the sanctioned alternative.
 */
const TRIVIA_DIR = dirname(fileURLToPath(import.meta.url));

/** Interfaces a test must never re-implement as a local object literal. */
const COLLABORATOR_TYPES = [
  "ClackSdk",
  "ClackSdkUsers",
  "ClackSdkMemory",
  "RegisteredMcpServer",
  "RevealSlackDeps",
  "LockSlackDeps",
  "PostQuestionsSlackDeps",
  "TriviaDataLayer",
  "ScopedTriviaDataLayer",
  "FakeTriviaDataLayer",
  "FakeScopedTriviaDataLayer",
].join("|");

// A function or const whose declared type is a collaborator interface:
//   function fakeDeps(): RevealSlackDeps {          — return annotation + body
//   const deps: RevealSlackDeps = {                 — annotated literal
//   const make = (): RevealSlackDeps => ({          — arrow returning a literal
const COLLABORATOR_FACTORY = new RegExp(
  `(\\)\\s*:\\s*(${COLLABORATOR_TYPES})\\s*(\\{|=>)|:\\s*(${COLLABORATOR_TYPES})\\s*=\\s*\\{)`,
);

// Recording calls into a local array instead of reading a mock's call history:
//   const updateCalls: string[] = [];
const CAPTURE_ARRAY = /^\s*(const|let)\s+\w*[Cc]alls?\w*\s*(:\s*[^=]+)?=\s*\[\]\s*;?\s*$/;

/**
 * Canonical factories — a wrapper delegating to one of these (spreading its
 * result and overriding a member, or seeding it) is sanctioned, so the guard
 * accepts a match with a factory call within a few lines on either side.
 */
const CANONICAL_FACTORIES =
  /\b(createFakeSdk|createFakeRevealSlackDeps|createFakeLockSlackDeps|createFakePostQuestionsSlackDeps|createTriviaDataLayer|createSdkDataLayer)\s*\(/;

const SANCTIONED_WINDOW_LINES = 15;

function testFiles(): { name: string; lines: string[] }[] {
  return readdirSync(TRIVIA_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f.endsWith(".test.ts") && !f.endsWith("testHelpers.guard.test.ts"))
    .map((name) => ({
      name,
      lines: readFileSync(join(TRIVIA_DIR, name), "utf8").split("\n"),
    }));
}

function delegatesToCanonicalFactory(lines: string[], matchIndex: number): boolean {
  const start = Math.max(0, matchIndex - SANCTIONED_WINDOW_LINES);
  const end = Math.min(lines.length, matchIndex + SANCTIONED_WINDOW_LINES);
  for (let i = start; i < end; i++) {
    if (CANONICAL_FACTORIES.test(lines[i])) return true;
  }
  return false;
}

describe("canonical fakes guard", () => {
  it("no test hand-rolls a collaborator object — use the canonical fakes from testHelpers", () => {
    const offenders: string[] = [];
    for (const { name, lines } of testFiles()) {
      lines.forEach((line, i) => {
        if (COLLABORATOR_FACTORY.test(line) && !delegatesToCanonicalFactory(lines, i)) {
          offenders.push(`${name}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      "hand-rolled collaborator object(s) — use createFakeSdk / createFakeRevealSlackDeps / createFakeLockSlackDeps (or vi.mock at the boundary) instead",
    ).toEqual([]);
  });

  it("no test records calls into a capture array — assert through the mock's call history", () => {
    const offenders: string[] = [];
    for (const { name, lines } of testFiles()) {
      lines.forEach((line, i) => {
        if (CAPTURE_ARRAY.test(line)) {
          offenders.push(`${name}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      "capture array(s) — the canonical fake's members are vi.fn mocks; assert via <member>.mock.calls / toHaveBeenCalledWith",
    ).toEqual([]);
  });
});
