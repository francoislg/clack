/**
 * Structural guard for the plugin boundary (src/plugins/CLAUDE.md).
 *
 * ONE-SURFACE RULE — a file under `src/plugins/<name>/**` may import ONLY:
 *   1. files inside its own plugin directory,
 *   2. top-level files of `src/plugins-sdk/` (the SDK surface),
 *   3. npm packages and node builtins.
 * `plugins-sdk/testHelpers.js` is importable from test files (`*.test.ts`)
 * only; `plugins-sdk/internal/**` is never importable from a plugin.
 * `*.integration.test.ts` files are exempt — their purpose is crossing the
 * plugin↔core seam.
 *
 * SDK-LAYER DISCIPLINE — `plugins-sdk/` leaf modules (the pure helpers) must
 * import nothing that resolves inside `src/`, so they can never form an
 * import cycle. Everything else in `plugins-sdk/` is bridge code and may
 * import bot core.
 *
 * There is deliberately NO per-file exception list. If a plugin needs a
 * capability the SDK lacks, grow the SDK surface (a module export in
 * `plugins-sdk/sdk.ts` if pure, a `ClackSdk` instance member wired through
 * `plugins-sdk/internal/factory.ts` if stateful) — never punch a hole here.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative, dirname } from "node:path";

const SRC_DIR = resolve(import.meta.dirname, "..");
const PLUGINS_DIR = join(SRC_DIR, "plugins");
const SDK_DIR = join(SRC_DIR, "plugins-sdk");
const SDK_INTERNAL_DIR = join(SDK_DIR, "internal");
const TEST_SURFACE = join(SDK_DIR, "testHelpers.js");

/** Pure modules in plugins-sdk/ that must never import from src/. */
const SDK_LEAF_FILES = new Set(["toolResults.ts", "zodResult.ts", "imageSearchResult.ts"]);

function* walkTsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* walkTsFiles(full);
    } else if (full.endsWith(".ts")) {
      yield full;
    }
  }
}

/** Static imports, export-from, and dynamic import()/require() specifiers. */
const SPECIFIER_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const specs: string[] = [];
  for (const match of source.matchAll(SPECIFIER_RE)) {
    specs.push(match[1]);
  }
  return specs;
}

interface Violation {
  file: string;
  spec: string;
  reason: string;
}

function checkPluginSpecs(file: string, pluginDir: string, specs: string[]): Violation[] {
  const violations: Violation[] = [];
  const isTest = file.endsWith(".test.ts");
  for (const spec of specs) {
    if (!spec.startsWith(".")) continue; // packages + node builtins are allowed
    const target = resolve(dirname(file), spec);
    if (target.startsWith(pluginDir + "/")) continue; // own plugin
    const inSdkTopLevel =
      target.startsWith(SDK_DIR + "/") && !target.startsWith(SDK_INTERNAL_DIR + "/");
    if (inSdkTopLevel && (target !== TEST_SURFACE || isTest)) continue;
    const reason =
      target === TEST_SURFACE
        ? "imports the test-only surface (plugins-sdk/testHelpers.js) from a production file"
        : target.startsWith(SDK_INTERNAL_DIR + "/")
          ? "imports plugins-sdk/internal/** — plugins may only use the top-level SDK surface"
          : target.startsWith(PLUGINS_DIR + "/")
            ? "imports another plugin's files"
            : "imports bot core — use the plugins-sdk surface instead; if the SDK lacks it, " +
              "grow the surface (src/plugins/CLAUDE.md)";
    violations.push({ file: relative(SRC_DIR, file), spec, reason });
  }
  return violations;
}

function checkSdkLeafFile(file: string): Violation[] {
  const violations: Violation[] = [];
  for (const spec of importSpecifiers(file)) {
    if (!spec.startsWith(".")) continue;
    violations.push({
      file: relative(SRC_DIR, file),
      spec,
      reason:
        "plugins-sdk leaf modules must import only npm packages and node builtins " +
        "(they must stay leaves so they can never form an import cycle)",
    });
  }
  return violations;
}

function formatViolations(violations: Violation[]): string {
  return violations.map((v) => `  ${v.file}\n    import "${v.spec}" — ${v.reason}`).join("\n");
}

describe("plugin boundary (src/plugins/CLAUDE.md hard rules)", () => {
  it("src/plugins/ contains only plugin directories (plus docs)", () => {
    const strays = readdirSync(PLUGINS_DIR).filter(
      (e) => !statSync(join(PLUGINS_DIR, e)).isDirectory() && e !== "CLAUDE.md",
    );
    expect(
      strays,
      "non-plugin files in src/plugins/ — SDK code belongs in src/plugins-sdk/, loading infra in src/plugins-core/",
    ).toEqual([]);
  });

  it("plugin files import only their own plugin, the plugins-sdk surface, packages, and builtins", () => {
    const violations: Violation[] = [];
    for (const plugin of readdirSync(PLUGINS_DIR)) {
      const pluginDir = join(PLUGINS_DIR, plugin);
      if (!statSync(pluginDir).isDirectory()) continue;
      for (const file of walkTsFiles(pluginDir)) {
        if (file.endsWith(".integration.test.ts")) continue; // deliberate seam tests
        violations.push(...checkPluginSpecs(file, pluginDir, importSpecifiers(file)));
      }
    }
    expect(violations, `plugin-boundary violations:\n${formatViolations(violations)}`).toEqual([]);
  });

  it("plugins-sdk leaf modules import nothing from src/", () => {
    const violations: Violation[] = [];
    for (const name of SDK_LEAF_FILES) {
      violations.push(...checkSdkLeafFile(join(SDK_DIR, name)));
    }
    expect(violations, `plugins-sdk leaf violations:\n${formatViolations(violations)}`).toEqual([]);
  });

  it("every declared leaf module exists (stale leaf list is a bug)", () => {
    const topLevel = readdirSync(SDK_DIR);
    for (const name of SDK_LEAF_FILES) {
      expect(topLevel, `leaf list names missing file ${name}`).toContain(name);
    }
  });
});

describe("boundary classification (negative cases — the guard actually catches violations)", () => {
  const pluginDir = join(PLUGINS_DIR, "trivia");
  const prodFile = join(pluginDir, "tools", "questions", "postQuestions.ts");
  const testFile = join(pluginDir, "tools", "questions", "postQuestions.test.ts");

  it("flags bot-core imports", () => {
    const violations = checkPluginSpecs(prodFile, pluginDir, ["../../../../tools/helpers.js"]);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain("bot core");
  });

  it("flags another plugin's files", () => {
    const violations = checkPluginSpecs(prodFile, pluginDir, ["../../../idler/config.js"]);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain("another plugin");
  });

  it("flags plugins-sdk/internal", () => {
    const violations = checkPluginSpecs(prodFile, pluginDir, [
      "../../../../plugins-sdk/internal/factory.js",
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].reason).toContain("internal");
  });

  it("flags the test surface from a production file, allows it from a test file", () => {
    const spec = "../../../../plugins-sdk/testHelpers.js";
    expect(checkPluginSpecs(prodFile, pluginDir, [spec])).toHaveLength(1);
    expect(checkPluginSpecs(testFile, pluginDir, [spec])).toEqual([]);
  });

  it("allows own-plugin files, the façade, packages, and builtins", () => {
    const violations = checkPluginSpecs(prodFile, pluginDir, [
      "./renderHint.js",
      "../../core/types.js",
      "../../../../plugins-sdk/sdk.js",
      "../../../../plugins-sdk/toolResults.js",
      "zod",
      "node:fs",
    ]);
    expect(violations).toEqual([]);
  });
});
