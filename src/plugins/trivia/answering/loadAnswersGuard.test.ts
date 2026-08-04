import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";

/**
 * Enforces the scoring-view vs audit-view split (design D3 of
 * refactor-trivia-answering-strategy): scoring-view consumers read answers through
 * the `AnsweringStrategy` projections, never `scoped.loadAnswers()` directly. Only
 * the strategy implementation and the three audit-view tools — which target one
 * user's raw row by identity — may call it. A new direct read is a conscious
 * one-line allowlist edit here, visible in review; anything else fails the build.
 */
const TRIVIA_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const ALLOWLIST = new Set([
  // The ownership seam itself — the strategies + game-wide projection that read raw
  // rows and project them (individual rows and team slots) into the scoring view.
  "answering/individual.ts",
  "answering/byTeam.ts",
  "answering/scoredAnswers.ts",
  // Audit-view tools: operate on a specific user's row by identity, bypass projections.
  "revealCards/seeAnswerButton.ts",
  "tools/questions/getQuestionHistory.ts",
  "tools/reveal/overrideAnswer.ts",
  // Reminder tool: needs to read raw answers to find unplayed candidates for reminders.
  "tools/reminders/remindUnplayed.ts",
]);

const CALL_PATTERN = /\.loadAnswers\(/;

// Strip block and line comments so a doc comment mentioning `.loadAnswers(` can't
// register as a false offender (the pattern targets real calls, not prose).
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function productionFiles(): { rel: string; text: string }[] {
  return (readdirSync(TRIVIA_ROOT, { recursive: true }) as string[])
    .map((entry) => entry.split(sep).join("/"))
    .filter((rel) => rel.endsWith(".ts") && !rel.endsWith(".test.ts"))
    .map((rel) => ({ rel, text: stripComments(readFileSync(join(TRIVIA_ROOT, rel), "utf8")) }));
}

describe("loadAnswers scoring-view guard", () => {
  it("only allowlisted files call `.loadAnswers(` directly", () => {
    const offenders = productionFiles()
      .filter(({ rel }) => !ALLOWLIST.has(rel))
      .filter(({ text }) => CALL_PATTERN.test(text))
      .map(({ rel }) => rel);
    expect(offenders).toEqual([]);
  });

  it("every allowlist entry still calls `.loadAnswers(` (no stale exemptions)", () => {
    const byRel = new Map(productionFiles().map(({ rel, text }) => [rel, text]));
    const stale = [...ALLOWLIST].filter((rel) => {
      const text = byRel.get(rel);
      return text === undefined || !CALL_PATTERN.test(text);
    });
    expect(stale).toEqual([]);
  });
});
