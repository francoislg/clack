import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { loadConfig } from "./config.js";
import {
  interpolateVariables,
  loadInstructions,
  validateInstructionFiles,
} from "./instructions.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpBase = resolve(tmpdir(), `instructions-test-${process.pid}`);
const tmpDataDir = join(tmpBase, "data");
const tmpAuthDir = join(tmpDataDir, "auth");
const configPath = join(tmpDataDir, "config.json");
const slackAuthPath = join(tmpAuthDir, "slack.json");
const defaultDir = join(tmpDataDir, "default_configuration");

function setup() {
  if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  mkdirSync(tmpBase, { recursive: true });
  process.chdir(tmpBase);

  mkdirSync(tmpAuthDir, { recursive: true });
  writeFileSync(
    slackAuthPath,
    JSON.stringify({
      botToken: "xoxb-111-222-abc",
      appToken: "xapp-1-A111-222-xyz",
      signingSecret: "s3cr3t",
    }),
  );
  mkdirSync(tmpDataDir, { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({
      repositories: [{ name: "repo", url: "https://github.com/org/repo.git", description: "Test" }],
    }),
  );
  loadConfig(configPath, true);
}

function writeDefault(role: string, filename: string, content: string) {
  const dir = resolve(defaultDir, role);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, filename), content, "utf-8");
}

function writeDefaultTopic(role: string, topic: string, filename: string, content: string) {
  const dir = resolve(defaultDir, role, "topics", topic);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, filename), content, "utf-8");
}

const originalCwd = process.cwd();

// ---------------------------------------------------------------------------
// interpolateVariables
// ---------------------------------------------------------------------------

describe("interpolateVariables", () => {
  it("replaces known variables with their values", () => {
    const result = interpolateVariables("Hello {NAME}!", { NAME: "Clack" });
    assert.equal(result, "Hello Clack!");
  });

  it("replaces multiple occurrences of the same variable", () => {
    const result = interpolateVariables("{X} and {X}", { X: "a" });
    assert.equal(result, "a and a");
  });

  it("replaces multiple different variables", () => {
    const result = interpolateVariables("{BOT_NAME} v{VERSION}", {
      BOT_NAME: "Clack",
      VERSION: "2.0",
    });
    assert.equal(result, "Clack v2.0");
  });

  it("replaces unknown variables with empty string", () => {
    const result = interpolateVariables("Hello {UNKNOWN}!", {});
    assert.equal(result, "Hello !");
  });

  it("replaces a mix of known and unknown variables", () => {
    const result = interpolateVariables("{A} {B} {C}", { A: "1", C: "3" });
    assert.equal(result, "1  3");
  });

  it("returns the original string when there are no placeholders", () => {
    const result = interpolateVariables("no placeholders here", { X: "y" });
    assert.equal(result, "no placeholders here");
  });

  it("handles empty content", () => {
    const result = interpolateVariables("", { X: "y" });
    assert.equal(result, "");
  });

  it("handles empty variables map", () => {
    const result = interpolateVariables("plain text", {});
    assert.equal(result, "plain text");
  });

  it("only matches word characters inside braces", () => {
    const result = interpolateVariables("{with-dash} {with space}", {});
    assert.equal(result, "{with-dash} {with space}");
  });

  it("handles variables with underscores and digits", () => {
    const result = interpolateVariables("{VAR_1} {a2b}", {
      VAR_1: "first",
      a2b: "second",
    });
    assert.equal(result, "first second");
  });

  it("replaces variable value that itself contains braces literally", () => {
    const result = interpolateVariables("{X}", { X: "{Y}" });
    assert.equal(result, "{Y}");
  });

  it("handles adjacent placeholders", () => {
    const result = interpolateVariables("{A}{B}", { A: "1", B: "2" });
    assert.equal(result, "12");
  });
});

// ---------------------------------------------------------------------------
// loadInstructions
// ---------------------------------------------------------------------------

describe("loadInstructions", () => {
  beforeEach(setup);
  afterEach(() => process.chdir(originalCwd));

  it("loads user-level instructions for a member", () => {
    writeDefault("user", "identity.md", "I am {BOT_NAME}");
    writeDefault("user", "changes.md", "No changes allowed");

    const result = loadInstructions("member", {
      changesWorkflowEnabled: false,
      variables: { BOT_NAME: "TestBot" },
    });

    assert.ok(result.includes("I am TestBot"));
    assert.ok(result.includes("No changes allowed"));
  });

  it("loads cascaded instructions for a dev with changesWorkflow", () => {
    writeDefault("user", "identity.md", "Bot identity");
    writeDefault("user", "changes.md", "No changes allowed");
    writeDefault("dev", "changes.md", "You can propose changes");

    const result = loadInstructions("dev", {
      changesWorkflowEnabled: true,
      variables: {},
    });

    assert.ok(result.includes("Bot identity"));
    assert.ok(result.includes("You can propose changes"));
    assert.ok(!result.includes("No changes allowed"));
  });

  it("dev without changesWorkflow gets only user-level instructions", () => {
    writeDefault("user", "changes.md", "No changes allowed");
    writeDefault("dev", "changes.md", "You can propose changes");

    const result = loadInstructions("dev", {
      changesWorkflowEnabled: false,
      variables: {},
    });

    assert.ok(result.includes("No changes allowed"));
    assert.ok(!result.includes("You can propose changes"));
  });

  it("admin without changesWorkflow gets [user, admin] — skips dev", () => {
    writeDefault("user", "changes.md", "No changes");
    writeDefault("dev", "changes.md", "Dev changes");
    writeDefault("admin", "config.md", "Admin config");

    const result = loadInstructions("admin", {
      changesWorkflowEnabled: false,
      variables: {},
    });

    assert.ok(result.includes("No changes"), "should keep user/changes.md");
    assert.ok(!result.includes("Dev changes"), "should skip dev");
    assert.ok(result.includes("Admin config"), "should include admin");
  });

  it("interpolates variables after concatenation", () => {
    writeDefault("user", "identity.md", "I am {BOT_NAME}");
    writeDefault("dev", "changes.md", "Ask {BOT_NAME} for help");

    const result = loadInstructions("dev", {
      changesWorkflowEnabled: true,
      variables: { BOT_NAME: "Clack" },
    });

    assert.ok(result.includes("I am Clack"));
    assert.ok(result.includes("Ask Clack for help"));
  });

  it("absent topics field is byte-identical to today's baseline behavior", () => {
    writeDefault("user", "identity.md", "Baseline");
    writeDefaultTopic("user", "trivia", "persona.md", "TOPIC CONTENT");

    const result = loadInstructions("member", {
      changesWorkflowEnabled: false,
      variables: {},
    });

    assert.ok(result.includes("Baseline"));
    assert.ok(!result.includes("TOPIC CONTENT"));
    assert.ok(!result.includes("=== TOPIC: trivia ==="));
  });

  it("empty topics array is treated as absent", () => {
    writeDefault("user", "identity.md", "Baseline");
    writeDefaultTopic("user", "trivia", "persona.md", "TOPIC CONTENT");

    const result = loadInstructions("member", {
      changesWorkflowEnabled: false,
      variables: {},
      topics: [],
    });

    assert.ok(!result.includes("TOPIC CONTENT"));
  });

  it("pre-attached topic surfaces under === TOPIC: <name> === header", () => {
    writeDefault("user", "identity.md", "Baseline");
    writeDefaultTopic("user", "trivia", "persona.md", "PERSONA_LOADED");

    const result = loadInstructions("member", {
      changesWorkflowEnabled: false,
      variables: {},
      topics: ["trivia"],
    });

    assert.ok(result.includes("Baseline"));
    assert.ok(result.includes("=== TOPIC: trivia ==="));
    assert.ok(result.includes("PERSONA_LOADED"));
  });

  it("pre-attached topic with no content emits no header", () => {
    writeDefault("user", "identity.md", "Baseline");

    const result = loadInstructions("member", {
      changesWorkflowEnabled: false,
      variables: {},
      topics: ["nonexistent"],
    });

    assert.ok(result.includes("Baseline"));
    assert.ok(!result.includes("=== TOPIC: nonexistent ==="));
  });
});

// ---------------------------------------------------------------------------
// validateInstructionFiles
// ---------------------------------------------------------------------------

describe("validateInstructionFiles", () => {
  beforeEach(setup);
  afterEach(() => process.chdir(originalCwd));

  it("passes when user/ directory has files", () => {
    writeDefault("user", "identity.md", "content");
    assert.doesNotThrow(() => validateInstructionFiles());
  });

  it("throws when user/ directory is empty", () => {
    assert.throws(() => validateInstructionFiles(), /No instruction files found/);
  });
});
