import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { loadConfig } from "./config.js";
import { resolveInstructions } from "./cascadingConfigResolver.js";
import { loadInstructions } from "./instructions.js";

// Integration test: resolveInstructions against the REAL shipped
// data/default_configuration content (symlinked in), exercising loadConfig and
// the actual on-disk role files end-to-end. Kept out of the unit test file, which
// uses synthetic temp fixtures only.

const originalCwd = process.cwd();

describe("shipped default_configuration smoke test", () => {
  // Point config at the real project root so resolveInstructions reads actual files.
  // We use the project root (where data/default_configuration lives) but provide
  // an empty configuration/ so no custom files interfere.
  const projectRoot = resolve(import.meta.dirname, "..");
  const smokeBase = resolve(tmpdir(), `cascade-smoke-${process.pid}`);

  beforeEach(() => {
    // Create a data dir that symlinks default_configuration and has empty configuration
    if (existsSync(smokeBase)) rmSync(smokeBase, { recursive: true });
    mkdirSync(smokeBase, { recursive: true });
    const smokeDataDir = join(smokeBase, "data");
    mkdirSync(smokeDataDir, { recursive: true });

    // Symlink real defaults — use junction on Windows so non-admin users can create it
    symlinkSync(
      resolve(projectRoot, "data/default_configuration"),
      join(smokeDataDir, "default_configuration"),
      process.platform === "win32" ? "junction" : "dir",
    );
    // Empty configuration dir
    mkdirSync(join(smokeDataDir, "configuration"), { recursive: true });
    // Auth and config for loadConfig
    const authDir = join(smokeDataDir, "auth");
    mkdirSync(authDir, { recursive: true });
    writeFileSync(
      join(authDir, "slack.json"),
      JSON.stringify({ botToken: "xoxb-test", appToken: "xapp-test", signingSecret: "s" }),
    );
    writeFileSync(
      join(smokeDataDir, "config.json"),
      JSON.stringify({
        repositories: [
          { name: "test-repo", url: "https://github.com/org/test.git", description: "Test" },
        ],
      }),
    );

    process.chdir(smokeBase);
    loadConfig(join(smokeDataDir, "config.json"), true);
  });

  afterEach(() => process.chdir(originalCwd));

  it("user-only chain includes user/ files but not dev/ or admin/", () => {
    const result = resolveInstructions(["user"]);
    // Must contain user files
    assert.ok(result.includes("submit_response"), "should include submit-response content");
    assert.ok(result.includes("Information Only"), "should include user/changes.md restriction");
    // Must NOT contain dev or admin content
    assert.ok(!result.includes("propose_change"), "should not include dev changes workflow");
    assert.ok(!result.includes("propose_config_update"), "should not include admin config tool");
  });

  it("user+dev chain overrides user/changes.md with dev/changes.md", () => {
    const result = resolveInstructions(["user", "dev"]);
    // Dev changes should replace user changes
    assert.ok(result.includes("propose_change"), "should include dev propose_change workflow");
    assert.ok(!result.includes("Information Only"), "user restriction should be overridden by dev");
    // User-only files still present
    assert.ok(result.includes("submit_response"), "should still include submit-response");
  });

  it("user+admin chain includes admin config but not dev changes", () => {
    const result = resolveInstructions(["user", "admin"]);
    assert.ok(result.includes("propose_config_update"), "should include admin config tool");
    assert.ok(
      result.includes("Information Only"),
      "should keep user restriction (no dev override)",
    );
    assert.ok(!result.includes("propose_change"), "should not include dev changes workflow");
  });

  it("user+dev+admin chain has dev changes AND admin config", () => {
    const result = resolveInstructions(["user", "dev", "admin"]);
    assert.ok(result.includes("propose_change"), "should include dev changes");
    assert.ok(result.includes("propose_config_update"), "should include admin config");
    assert.ok(!result.includes("Information Only"), "user restriction overridden by dev");
  });

  it("full chain user+dev+admin+owner includes everything", () => {
    const result = resolveInstructions(["user", "dev", "admin", "owner"]);
    assert.ok(result.includes("submit_response"), "user content present");
    assert.ok(result.includes("propose_change"), "dev content present");
    assert.ok(result.includes("propose_config_update"), "admin content present");
  });

  it("response-rendering topic content loads ONLY when the topic is attached", () => {
    const lean = loadInstructions("member", { changesWorkflowEnabled: false, variables: {} });
    assert.ok(
      lean.includes("ends the conversation permanently"),
      "baseline stub contract always present",
    );
    assert.ok(
      !lean.includes("Actions by Delivery Context"),
      "rendering guidance must not load without the topic",
    );

    const attached = loadInstructions("member", {
      changesWorkflowEnabled: false,
      variables: {},
      topics: ["response-rendering"],
    });
    assert.ok(
      attached.includes("Actions by Delivery Context"),
      "rendering guidance loads with the topic",
    );
    assert.ok(attached.length > lean.length, "attached prompt is strictly larger");
  });

  it("re-homed operator override wins over the shipped response-rendering default", () => {
    const overrideDir = join(
      smokeBase,
      "data",
      "configuration",
      "user",
      "topics",
      "response-rendering",
    );
    mkdirSync(overrideDir, { recursive: true });
    writeFileSync(join(overrideDir, "block-kit-formatting.md"), "OPERATOR OVERRIDE MARKER\n");

    const attached = loadInstructions("member", {
      changesWorkflowEnabled: false,
      variables: {},
      topics: ["response-rendering"],
    });
    assert.ok(attached.includes("OPERATOR OVERRIDE MARKER"), "operator override content wins");
    assert.ok(
      attached.includes("Actions by Delivery Context"),
      "other shipped topic files still load",
    );
  });
});
