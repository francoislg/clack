import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Enforces the "single cascade resolution implementation" requirement: `resolveCascade`
 * is the only resolution path, and no resolver re-derives a slot from `season.format`.
 * A guard, not a unit test — it greps the domain source so a reintroduced legacy resolver
 * or slot re-derivation fails the build.
 */
const DOMAIN_DIR = dirname(fileURLToPath(import.meta.url));

const LEGACY_RESOLVERS = [
  "resolveAnswersFormat",
  "resolveQuestionType",
  "resolvePromptMedium",
  "resolveFreeformAnswerShape",
  "resolveContexts",
  "resolveJudgeLeniency",
  "resolveHintConfig",
  "resolveInstructions",
  "resolveAdditionalInstructions",
];

// `buildCascadeContext` and `resolveEffectiveFormat` are the ONLY functions allowed to
// read per-slot composition off a format.
const SLOT_SOURCING_ALLOWLIST = new Set(["cascadeContext.ts", "format.ts"]);

function sourceFiles(): { name: string; text: string }[] {
  return readdirSync(DOMAIN_DIR)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((name) => ({ name, text: readFileSync(join(DOMAIN_DIR, name), "utf8") }));
}

describe("cascade single implementation guard", () => {
  it("no legacy per-axis resolver is defined or exported in domain/", () => {
    const offenders: string[] = [];
    for (const { name, text } of sourceFiles()) {
      for (const fn of LEGACY_RESOLVERS) {
        if (new RegExp(`function ${fn}\\b`).test(text)) offenders.push(`${name}: ${fn}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no resolver re-derives a slot via `.format.questions[` outside the allowlist", () => {
    const offenders: string[] = [];
    for (const { name, text } of sourceFiles()) {
      if (SLOT_SOURCING_ALLOWLIST.has(name)) continue;
      if (/\.format\.questions\[/.test(text)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });
});
