import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { loadConfig } from "../config.js";
import { buildSystemPrompt, renderLanguageDirective } from "./promptBuilder.js";

const tmpBase = resolve(tmpdir(), `promptbuilder-lang-test-${process.pid}`);
const tmpDataDir = join(tmpBase, "data");
const tmpAuthDir = join(tmpDataDir, "auth");
const configPath = join(tmpDataDir, "config.json");
const slackAuthPath = join(tmpAuthDir, "slack.json");
const defaultDir = join(tmpDataDir, "default_configuration");

interface ConfigExtras {
  language?: "en" | "fr";
}

function writeSlackAuth() {
  mkdirSync(tmpAuthDir, { recursive: true });
  writeFileSync(
    slackAuthPath,
    JSON.stringify({
      botToken: "xoxb-111-222-abc",
      appToken: "xapp-1-A111-222-xyz",
      signingSecret: "s3cr3t",
    }),
  );
}

function writeConfig(extras: ConfigExtras = {}) {
  mkdirSync(tmpDataDir, { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({
      repositories: [{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }],
      ...extras,
    }),
  );
}

function writeDefaultFile(filename: string, content: string) {
  const filePath = resolve(defaultDir, filename);
  mkdirSync(resolve(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

const originalCwd = process.cwd();

describe("renderLanguageDirective", () => {
  it("returns empty string for 'en'", () => {
    assert.equal(renderLanguageDirective("en"), "");
  });

  it("renders the directive for 'fr' with both English and native names", () => {
    const out = renderLanguageDirective("fr");
    assert.ok(out.length > 0);
    assert.ok(out.startsWith("LANGUAGE\n"));
    assert.ok(out.includes("French"));
    assert.ok(out.includes("Français"));
  });

  it("instructs Claude about user-facing output categories", () => {
    const out = renderLanguageDirective("fr");
    assert.ok(out.includes("submit_response"));
    assert.ok(out.includes("button labels"));
    assert.ok(out.includes("Status messages"));
  });

  it("explicitly forbids literal idiom translation", () => {
    const out = renderLanguageDirective("fr");
    assert.ok(out.toLowerCase().includes("idiomatic"));
    assert.ok(out.toLowerCase().includes("literally"));
  });

  it("preserves identifiers and reasoning in original form", () => {
    const out = renderLanguageDirective("fr");
    assert.ok(out.includes("Internal reasoning"));
    assert.ok(out.includes("file paths"));
    assert.ok(out.includes("code identifiers"));
  });

  it("ends with a blank line so callers can concatenate cascaded content cleanly", () => {
    const out = renderLanguageDirective("fr");
    assert.ok(out.endsWith("\n\n"));
  });
});

describe("buildSystemPrompt — language directive injection", () => {
  beforeEach(() => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(tmpBase, { recursive: true });
    process.chdir(tmpBase);
    writeSlackAuth();
    writeDefaultFile("user/identity.md", "IDENTITY: You are a test bot.");
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  it("produces output byte-identical to cascaded content when language is absent", () => {
    writeConfig();
    loadConfig(configPath, true);

    const prompt = buildSystemPrompt({ role: "member" });
    assert.ok(prompt.includes("IDENTITY: You are a test bot."));
    assert.ok(!prompt.includes("LANGUAGE"));
    assert.ok(prompt.startsWith("IDENTITY:"));
  });

  it("produces output byte-identical to cascaded content when language is 'en'", () => {
    writeConfig({ language: "en" });
    loadConfig(configPath, true);

    const prompt = buildSystemPrompt({ role: "member" });
    assert.ok(!prompt.includes("LANGUAGE"));
    assert.ok(prompt.startsWith("IDENTITY:"));
  });

  it("prepends the directive when language is 'fr'", () => {
    writeConfig({ language: "fr" });
    loadConfig(configPath, true);

    const prompt = buildSystemPrompt({ role: "member" });
    assert.ok(prompt.startsWith("LANGUAGE\n"));
    assert.ok(prompt.includes("Français"));
    assert.ok(prompt.includes("French"));
    assert.ok(prompt.includes("IDENTITY: You are a test bot."));

    // Directive precedes role-cascaded content.
    const directiveIdx = prompt.indexOf("LANGUAGE");
    const identityIdx = prompt.indexOf("IDENTITY:");
    assert.ok(directiveIdx >= 0 && identityIdx > directiveIdx);
  });
});

describe("buildSystemPrompt — tracked-memory-kinds injection", () => {
  beforeEach(() => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(tmpBase, { recursive: true });
    process.chdir(tmpBase);
    writeSlackAuth();
    writeDefaultFile("user/identity.md", "IDENTITY: You are a test bot.");
    writeConfig();
    loadConfig(configPath, true);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  it("appends the block after the cascaded content when provided", () => {
    const block = "## Currently tracked in memory\n\nClack is tracking: asana, clack-pr.";
    const prompt = buildSystemPrompt({ role: "member", trackedMemoryKinds: block });
    assert.ok(prompt.includes(block));
    // Block follows the role-cascaded identity content.
    assert.ok(prompt.indexOf(block) > prompt.indexOf("IDENTITY:"));
  });

  it("omits the section when trackedMemoryKinds is an empty string", () => {
    const prompt = buildSystemPrompt({ role: "member", trackedMemoryKinds: "" });
    assert.ok(!prompt.includes("Currently tracked in memory"));
    assert.ok(prompt.startsWith("IDENTITY:"));
  });

  it("omits the section when trackedMemoryKinds is absent", () => {
    const prompt = buildSystemPrompt({ role: "member" });
    assert.ok(!prompt.includes("Currently tracked in memory"));
    assert.ok(prompt.startsWith("IDENTITY:"));
  });
});
