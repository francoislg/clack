import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { loadConfig } from "./config.js";
import {
  resolveInstructions,
  buildRoleChain,
  validateInstructionDirs,
  listRoleDirFiles,
  listRoleTopicDirFiles,
  readRoleFile,
  readRoleTopicFile,
  type VirtualDefaults,
} from "./cascadingConfigResolver.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpBase = resolve(tmpdir(), `cascade-test-${process.pid}`);
const tmpDataDir = join(tmpBase, "data");
const tmpAuthDir = join(tmpDataDir, "auth");
const configPath = join(tmpDataDir, "config.json");
const slackAuthPath = join(tmpAuthDir, "slack.json");
const configDir = join(tmpDataDir, "configuration");
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

function writeCustom(role: string, filename: string, content: string) {
  const dir = resolve(configDir, role);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, filename), content, "utf-8");
}

const originalCwd = process.cwd();

// ---------------------------------------------------------------------------
// resolveInstructions
// ---------------------------------------------------------------------------

describe("resolveInstructions", () => {
  beforeEach(setup);
  afterEach(() => process.chdir(originalCwd));

  it("loads all files from user/ for a basic role chain", () => {
    writeDefault("user", "identity.md", "I am a bot");
    writeDefault("user", "response.md", "Be concise");

    const result = resolveInstructions(["user"]);
    assert.ok(result.includes("I am a bot"));
    assert.ok(result.includes("Be concise"));
  });

  it("concatenates files in alphabetical order", () => {
    writeDefault("user", "beta.md", "BETA");
    writeDefault("user", "alpha.md", "ALPHA");

    const result = resolveInstructions(["user"]);
    const alphaIdx = result.indexOf("ALPHA");
    const betaIdx = result.indexOf("BETA");
    assert.ok(alphaIdx < betaIdx, "alpha.md should come before beta.md");
  });

  it("higher role overrides lower role for same filename", () => {
    writeDefault("user", "changes.md", "No changes allowed");
    writeDefault("dev", "changes.md", "You can propose changes");

    const result = resolveInstructions(["user", "dev"]);
    assert.ok(result.includes("You can propose changes"));
    assert.ok(!result.includes("No changes allowed"));
  });

  it("inherits from lower role when higher role has no override", () => {
    writeDefault("user", "identity.md", "I am a bot");
    writeDefault("dev", "changes.md", "Dev changes");

    const result = resolveInstructions(["user", "dev"]);
    assert.ok(result.includes("I am a bot"), "should inherit user/identity.md");
    assert.ok(result.includes("Dev changes"), "should include dev/changes.md");
  });

  it("custom overrides default within same role level", () => {
    writeDefault("user", "identity.md", "Default identity");
    writeCustom("user", "identity.md", "Custom identity");

    const result = resolveInstructions(["user"]);
    assert.ok(result.includes("Custom identity"));
    assert.ok(!result.includes("Default identity"));
  });

  it("role cascade beats two-tier: default/dev beats custom/user", () => {
    writeCustom("user", "changes.md", "Custom user changes");
    writeDefault("dev", "changes.md", "Default dev changes");

    const result = resolveInstructions(["user", "dev"]);
    assert.ok(result.includes("Default dev changes"));
    assert.ok(!result.includes("Custom user changes"));
  });

  it("custom at higher role wins over everything", () => {
    writeDefault("user", "changes.md", "Default user");
    writeCustom("user", "changes.md", "Custom user");
    writeDefault("dev", "changes.md", "Default dev");
    writeCustom("dev", "changes.md", "Custom dev");

    const result = resolveInstructions(["user", "dev"]);
    assert.ok(result.includes("Custom dev"));
    assert.ok(!result.includes("Default dev"));
    assert.ok(!result.includes("Custom user"));
    assert.ok(!result.includes("Default user"));
  });

  it("empty file at higher role suppresses instruction", () => {
    writeDefault("user", "restriction.md", "Some restriction");
    writeDefault("dev", "restriction.md", "   \n  \t  \n  ");

    const result = resolveInstructions(["user", "dev"]);
    assert.ok(!result.includes("Some restriction"));
  });

  it("purely additive file at higher role level is included", () => {
    writeDefault("user", "identity.md", "I am a bot");
    writeDefault("admin", "config.md", "Config management");

    const result = resolveInstructions(["user", "admin"]);
    assert.ok(result.includes("I am a bot"));
    assert.ok(result.includes("Config management"));
  });

  it("custom-only file with no default is included", () => {
    writeDefault("user", "identity.md", "I am a bot");
    writeCustom("user", "company.md", "Our company does X");

    const result = resolveInstructions(["user"]);
    assert.ok(result.includes("Our company does X"));
  });

  it("ignores non-.md files", () => {
    writeDefault("user", "identity.md", "I am a bot");
    // Write a non-md file
    const dir = resolve(defaultDir, "user");
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, ".DS_Store"), "junk");
    writeFileSync(resolve(dir, "notes.txt"), "not markdown");

    const result = resolveInstructions(["user"]);
    assert.ok(result.includes("I am a bot"));
    assert.ok(!result.includes("junk"));
    assert.ok(!result.includes("not markdown"));
  });

  it("returns empty string when no files exist", () => {
    const result = resolveInstructions(["user"]);
    assert.equal(result, "");
  });

  it("files only at higher role (not in user/) are included", () => {
    writeDefault("admin", "config.md", "Admin only content");

    const result = resolveInstructions(["user", "admin"]);
    assert.ok(result.includes("Admin only content"));
  });

  it("files beyond the role chain are excluded", () => {
    writeDefault("user", "identity.md", "Bot identity");
    writeDefault("admin", "config.md", "Admin config");

    const result = resolveInstructions(["user"]); // no admin in chain
    assert.ok(result.includes("Bot identity"));
    assert.ok(!result.includes("Admin config"));
  });

  it("three-level cascade: admin overrides dev overrides user", () => {
    writeDefault("user", "changes.md", "User level");
    writeDefault("dev", "changes.md", "Dev level");
    writeDefault("admin", "changes.md", "Admin level");

    const result = resolveInstructions(["user", "dev", "admin"]);
    assert.ok(result.includes("Admin level"));
    assert.ok(!result.includes("Dev level"));
    assert.ok(!result.includes("User level"));
  });

  it("skipping dev in chain: [user, admin] skips dev overrides", () => {
    writeDefault("user", "changes.md", "No changes");
    writeDefault("dev", "changes.md", "Dev can change");
    writeDefault("admin", "config.md", "Admin config");

    const result = resolveInstructions(["user", "admin"]);
    assert.ok(result.includes("No changes"), "should keep user/changes.md since dev is skipped");
    assert.ok(result.includes("Admin config"), "should include admin/config.md");
    assert.ok(!result.includes("Dev can change"), "dev should be skipped");
  });
});

// ---------------------------------------------------------------------------
// buildRoleChain
// ---------------------------------------------------------------------------

describe("buildRoleChain", () => {
  it("member → [user] regardless of changesWorkflow", () => {
    assert.deepEqual(buildRoleChain("member", false), ["user"]);
    assert.deepEqual(buildRoleChain("member", true), ["user"]);
  });

  it("dev without changesWorkflow → [user]", () => {
    assert.deepEqual(buildRoleChain("dev", false), ["user"]);
  });

  it("dev with changesWorkflow → [user, dev]", () => {
    assert.deepEqual(buildRoleChain("dev", true), ["user", "dev"]);
  });

  it("admin without changesWorkflow → [user, admin]", () => {
    assert.deepEqual(buildRoleChain("admin", false), ["user", "admin"]);
  });

  it("admin with changesWorkflow → [user, dev, admin]", () => {
    assert.deepEqual(buildRoleChain("admin", true), ["user", "dev", "admin"]);
  });

  it("owner without changesWorkflow → [user, admin, owner]", () => {
    assert.deepEqual(buildRoleChain("owner", false), ["user", "admin", "owner"]);
  });

  it("owner with changesWorkflow → [user, dev, admin, owner]", () => {
    assert.deepEqual(buildRoleChain("owner", true), ["user", "dev", "admin", "owner"]);
  });
});

// ---------------------------------------------------------------------------
// validateInstructionDirs
// ---------------------------------------------------------------------------

describe("validateInstructionDirs", () => {
  beforeEach(setup);
  afterEach(() => process.chdir(originalCwd));

  it("passes when user/ directory has files in default_configuration", () => {
    writeDefault("user", "identity.md", "content");
    assert.doesNotThrow(() => validateInstructionDirs());
  });

  it("passes when user/ directory has files in configuration only", () => {
    writeCustom("user", "identity.md", "custom content");
    assert.doesNotThrow(() => validateInstructionDirs());
  });

  it("throws when user/ directory is empty in both tiers", () => {
    assert.throws(() => validateInstructionDirs(), /No instruction files found/);
  });
});

// ---------------------------------------------------------------------------
// listRoleDirFiles
// ---------------------------------------------------------------------------

describe("listRoleDirFiles", () => {
  beforeEach(setup);
  afterEach(() => process.chdir(originalCwd));

  it("returns files grouped by role directory", () => {
    writeDefault("user", "identity.md", "content");
    writeDefault("dev", "changes.md", "content");

    const result = listRoleDirFiles();
    const userDir = result.find((r) => r.role === "user");
    const devDir = result.find((r) => r.role === "dev");

    assert.ok(userDir);
    assert.equal(userDir.files.length, 1);
    assert.equal(userDir.files[0].filename, "identity.md");
    assert.equal(userDir.files[0].source, "default");

    assert.ok(devDir);
    assert.equal(devDir.files.length, 1);
    assert.equal(devDir.files[0].filename, "changes.md");
  });

  it("marks customized files correctly", () => {
    writeDefault("user", "identity.md", "default");
    writeCustom("user", "identity.md", "custom");

    const result = listRoleDirFiles();
    const userDir = result.find((r) => r.role === "user")!;
    assert.equal(userDir.files[0].source, "customized");
  });

  it("marks custom-only files correctly", () => {
    writeCustom("user", "company.md", "custom only");

    const result = listRoleDirFiles();
    const userDir = result.find((r) => r.role === "user")!;
    assert.equal(userDir.files[0].source, "custom-only");
  });

  it("omits role directories with no files", () => {
    writeDefault("user", "identity.md", "content");

    const result = listRoleDirFiles();
    assert.ok(!result.find((r) => r.role === "dev"));
    assert.ok(!result.find((r) => r.role === "admin"));
    assert.ok(!result.find((r) => r.role === "owner"));
  });

  it("sorts files alphabetically within each directory", () => {
    writeDefault("user", "zebra.md", "z");
    writeDefault("user", "alpha.md", "a");

    const result = listRoleDirFiles();
    const userDir = result.find((r) => r.role === "user")!;
    assert.equal(userDir.files[0].filename, "alpha.md");
    assert.equal(userDir.files[1].filename, "zebra.md");
  });
});

// ---------------------------------------------------------------------------
// readRoleFile
// ---------------------------------------------------------------------------

describe("readRoleFile", () => {
  beforeEach(setup);
  afterEach(() => process.chdir(originalCwd));

  it("returns both default and custom content when both exist", () => {
    writeDefault("user", "identity.md", "default content");
    writeCustom("user", "identity.md", "custom content");

    const result = readRoleFile("user", "identity.md");
    assert.equal(result.default_content, "default content");
    assert.equal(result.custom_content, "custom content");
  });

  it("returns only default when no custom exists", () => {
    writeDefault("user", "identity.md", "default content");

    const result = readRoleFile("user", "identity.md");
    assert.equal(result.default_content, "default content");
    assert.equal(result.custom_content, null);
  });

  it("returns only custom when no default exists", () => {
    writeCustom("user", "company.md", "custom content");

    const result = readRoleFile("user", "company.md");
    assert.equal(result.default_content, null);
    assert.equal(result.custom_content, "custom content");
  });

  it("returns both null when file does not exist", () => {
    const result = readRoleFile("user", "nonexistent.md");
    assert.equal(result.default_content, null);
    assert.equal(result.custom_content, null);
  });
});

// ---------------------------------------------------------------------------
// Smoke test: shipped default_configuration content
// ---------------------------------------------------------------------------

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

    // Symlink real defaults
    symlinkSync(
      resolve(projectRoot, "data/default_configuration"),
      join(smokeDataDir, "default_configuration"),
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
});

// ---------------------------------------------------------------------------
// Virtual Defaults (plugin integration)
// ---------------------------------------------------------------------------

describe("resolveInstructions with virtualDefaults", () => {
  beforeEach(setup);
  afterEach(() => process.chdir(originalCwd));

  it("includes virtual default when no disk files exist", () => {
    writeDefault("user", "identity.md", "core identity");

    const virtualDefaults: VirtualDefaults = new Map([
      ["user", new Map([["trivia__instructions.md", "Trivia instructions here"]])],
    ]);

    const result = resolveInstructions(["user"], undefined, virtualDefaults);
    assert.ok(result.includes("core identity"));
    assert.ok(result.includes("Trivia instructions here"));
  });

  it("disk custom override wins over virtual default", () => {
    writeDefault("user", "identity.md", "core identity");
    writeCustom("user", "trivia__instructions.md", "Admin override of trivia");

    const virtualDefaults: VirtualDefaults = new Map([
      ["user", new Map([["trivia__instructions.md", "Plugin default"]])],
    ]);

    const result = resolveInstructions(["user"], undefined, virtualDefaults);
    assert.ok(result.includes("Admin override of trivia"));
    assert.ok(!result.includes("Plugin default"));
  });

  it("virtual default overrides disk default for same filename", () => {
    writeDefault("user", "trivia__instructions.md", "Old disk default");

    const virtualDefaults: VirtualDefaults = new Map([
      ["user", new Map([["trivia__instructions.md", "Plugin virtual default"]])],
    ]);

    const result = resolveInstructions(["user"], undefined, virtualDefaults);
    assert.ok(result.includes("Plugin virtual default"));
    assert.ok(!result.includes("Old disk default"));
  });

  it("resolution order: disk default → virtual → disk custom per role tier", () => {
    writeDefault("user", "shared.md", "disk default user");

    const virtualDefaults: VirtualDefaults = new Map([
      ["user", new Map([["shared.md", "virtual user"]])],
      ["dev", new Map([["shared.md", "virtual dev"]])],
    ]);

    // user chain only: virtual user wins over disk default user
    const userResult = resolveInstructions(["user"], undefined, virtualDefaults);
    assert.ok(userResult.includes("virtual user"));

    // user+dev chain: virtual dev wins (higher role tier)
    const devResult = resolveInstructions(["user", "dev"], undefined, virtualDefaults);
    assert.ok(devResult.includes("virtual dev"));
    assert.ok(!devResult.includes("virtual user"));
  });

  it("works normally when virtualDefaults is undefined", () => {
    writeDefault("user", "identity.md", "core identity");

    const result = resolveInstructions(["user"], undefined);
    assert.ok(result.includes("core identity"));
  });
});

// ---------------------------------------------------------------------------
// resolveInstructions — topic subfolders
// ---------------------------------------------------------------------------

function writeDefaultTopic(role: string, topic: string, filename: string, content: string) {
  const dir = resolve(defaultDir, role, "topics", topic);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, filename), content, "utf-8");
}

function writeCustomTopic(role: string, topic: string, filename: string, content: string) {
  const dir = resolve(configDir, role, "topics", topic);
  mkdirSync(dir, { recursive: true });
  writeFileSync(resolve(dir, filename), content, "utf-8");
}

describe("resolveInstructions — topic subfolders", () => {
  beforeEach(setup);
  afterEach(() => process.chdir(originalCwd));

  it("baseline resolution excludes topic folders entirely (activeTopics empty)", () => {
    writeDefault("user", "identity.md", "core identity");
    writeDefaultTopic("user", "metabase", "metabase.md", "metabase rules");

    const result = resolveInstructions(["user"]);
    assert.ok(result.includes("core identity"));
    assert.ok(!result.includes("metabase rules"));
    assert.ok(!result.includes("TOPIC:"));
  });

  it("activates a topic when included in activeTopics", () => {
    writeDefault("user", "identity.md", "core identity");
    writeDefaultTopic("user", "metabase", "metabase.md", "metabase rules");

    const result = resolveInstructions(["user"], new Set(["metabase"]));
    assert.ok(result.includes("core identity"));
    assert.ok(result.includes("metabase rules"));
    assert.ok(result.includes("=== TOPIC: metabase ==="));
  });

  it("custom override wins over default for a topic file", () => {
    writeDefaultTopic("user", "metabase", "metabase.md", "default rules");
    writeCustomTopic("user", "metabase", "metabase.md", "custom override rules");

    const result = resolveInstructions(["user"], new Set(["metabase"]));
    assert.ok(result.includes("custom override rules"));
    assert.ok(!result.includes("default rules"));
  });

  it("additive custom topic file with no default counterpart is included", () => {
    writeDefaultTopic("user", "metabase", "metabase.md", "default rules");
    writeCustomTopic("user", "metabase", "company-dashboards.md", "company-specific dashboards");

    const result = resolveInstructions(["user"], new Set(["metabase"]));
    assert.ok(result.includes("default rules"));
    assert.ok(result.includes("company-specific dashboards"));
    // Multiple files within a topic share a single header, alphabetical order
    // (`company-dashboards.md` before `metabase.md`).
    const companyIdx = result.indexOf("company-specific dashboards");
    const defaultIdx = result.indexOf("default rules");
    assert.ok(companyIdx < defaultIdx, "company-dashboards.md should precede metabase.md");
    // Only one header for the topic
    assert.equal((result.match(/=== TOPIC: metabase ===/g) ?? []).length, 1);
  });

  it("topic files cascade across the role chain", () => {
    writeDefaultTopic("user", "metabase", "metabase.md", "user-level metabase");
    writeDefaultTopic("dev", "metabase", "metabase.md", "dev-level metabase");

    const result = resolveInstructions(["user", "dev"], new Set(["metabase"]));
    assert.ok(result.includes("dev-level metabase"));
    assert.ok(!result.includes("user-level metabase"));
  });

  it("empty/whitespace topic file suppresses that entry", () => {
    writeDefaultTopic("user", "metabase", "metabase.md", "original");
    writeCustomTopic("user", "metabase", "metabase.md", "   \n\t  ");

    const result = resolveInstructions(["user"], new Set(["metabase"]));
    assert.ok(!result.includes("original"));
    // If all files in the topic are empty, no header appears.
    assert.ok(!result.includes("=== TOPIC: metabase ==="));
  });

  it("multiple active topics concatenate under separate headers, alphabetically ordered", () => {
    writeDefaultTopic("user", "metabase", "metabase.md", "metabase content");
    writeDefaultTopic("user", "monday", "monday.md", "monday content");

    const result = resolveInstructions(["user"], new Set(["monday", "metabase"]));
    const metabaseIdx = result.indexOf("=== TOPIC: metabase ===");
    const mondayIdx = result.indexOf("=== TOPIC: monday ===");
    assert.ok(metabaseIdx > -1 && mondayIdx > -1);
    assert.ok(metabaseIdx < mondayIdx, "metabase should appear before monday alphabetically");
  });

  it("topic with no matching files returns nothing extra beyond baseline", () => {
    writeDefault("user", "identity.md", "core identity");

    const result = resolveInstructions(["user"], new Set(["nonexistent-topic"]));
    assert.ok(result.includes("core identity"));
    assert.ok(!result.includes("TOPIC:"));
  });

  it("plugin virtual default for a topic file is included when topic is active", () => {
    const virtualDefaults: VirtualDefaults = new Map([
      ["user", new Map([["topics/metabase/rules.md", "Virtual metabase rules"]])],
    ]);

    const result = resolveInstructions(["user"], new Set(["metabase"]), virtualDefaults);
    assert.ok(result.includes("=== TOPIC: metabase ==="));
    assert.ok(result.includes("Virtual metabase rules"));
  });

  it("plugin virtual topic default is NOT included in baseline resolution", () => {
    const virtualDefaults: VirtualDefaults = new Map([
      ["user", new Map([["topics/metabase/rules.md", "Virtual metabase rules"]])],
    ]);

    const result = resolveInstructions(["user"], undefined, virtualDefaults);
    assert.ok(!result.includes("Virtual metabase rules"));
  });

  it("disk custom override wins over plugin virtual topic default", () => {
    writeCustomTopic("user", "metabase", "rules.md", "disk custom rules");
    const virtualDefaults: VirtualDefaults = new Map([
      ["user", new Map([["topics/metabase/rules.md", "virtual default rules"]])],
    ]);

    const result = resolveInstructions(["user"], new Set(["metabase"]), virtualDefaults);
    assert.ok(result.includes("disk custom rules"));
    assert.ok(!result.includes("virtual default rules"));
  });
});

describe("listRoleDirFiles with virtualDefaults", () => {
  beforeEach(setup);
  afterEach(() => process.chdir(originalCwd));

  it("includes virtual files with source 'plugin'", () => {
    writeDefault("user", "identity.md", "core");

    const virtualDefaults: VirtualDefaults = new Map([
      ["user", new Map([["trivia__instructions.md", "Trivia content"]])],
    ]);

    const result = listRoleDirFiles(virtualDefaults);
    const userDir = result.find((r) => r.role === "user")!;
    const triviaFile = userDir.files.find((f) => f.filename === "trivia__instructions.md");
    assert.ok(triviaFile);
    assert.equal(triviaFile.source, "plugin");
  });

  it("marks plugin file as 'plugin-customized' when admin override exists", () => {
    writeCustom("user", "trivia__instructions.md", "Custom override");

    const virtualDefaults: VirtualDefaults = new Map([
      ["user", new Map([["trivia__instructions.md", "Plugin default"]])],
    ]);

    const result = listRoleDirFiles(virtualDefaults);
    const userDir = result.find((r) => r.role === "user")!;
    const triviaFile = userDir.files.find((f) => f.filename === "trivia__instructions.md");
    assert.ok(triviaFile);
    assert.equal(triviaFile.source, "plugin-customized");
  });
});

// ---------------------------------------------------------------------------
// listRoleTopicDirFiles / readRoleTopicFile — Home Tab visibility for topics
// ---------------------------------------------------------------------------

describe("listRoleTopicDirFiles", () => {
  beforeEach(setup);
  afterEach(() => process.chdir(originalCwd));

  it("lists topic files grouped by (role, topic) with source tags", () => {
    writeDefaultTopic("user", "metabase", "metabase.md", "default rules");
    writeCustomTopic("user", "metabase", "company.md", "company-specific");

    const result = listRoleTopicDirFiles();
    const metabase = result.find((r) => r.role === "user" && r.topic === "metabase");
    assert.ok(metabase);
    const filenames = metabase.files.map((f) => f.filename).sort();
    assert.deepEqual(filenames, ["company.md", "metabase.md"]);
    assert.equal(metabase.files.find((f) => f.filename === "company.md")?.source, "custom-only");
    assert.equal(metabase.files.find((f) => f.filename === "metabase.md")?.source, "default");
  });

  it("marks customized topic files correctly", () => {
    writeDefaultTopic("user", "metabase", "metabase.md", "default");
    writeCustomTopic("user", "metabase", "metabase.md", "custom");

    const result = listRoleTopicDirFiles();
    const metabase = result.find((r) => r.topic === "metabase");
    assert.ok(metabase);
    const file = metabase.files.find((f) => f.filename === "metabase.md");
    assert.equal(file?.source, "customized");
  });

  it("includes plugin virtual topic files", () => {
    const virtualDefaults: VirtualDefaults = new Map([
      ["user", new Map([["topics/metabase/rules.md", "virtual"]])],
    ]);

    const result = listRoleTopicDirFiles(virtualDefaults);
    const metabase = result.find((r) => r.role === "user" && r.topic === "metabase");
    assert.ok(metabase);
    const file = metabase.files.find((f) => f.filename === "rules.md");
    assert.equal(file?.source, "plugin");
  });

  it("returns no entries when no topic files exist", () => {
    writeDefault("user", "identity.md", "baseline");
    const result = listRoleTopicDirFiles();
    assert.deepEqual(result, []);
  });

  it("spans multiple roles and multiple topics", () => {
    writeDefaultTopic("user", "metabase", "a.md", "A");
    writeDefaultTopic("dev", "monday", "b.md", "B");

    const result = listRoleTopicDirFiles();
    const topics = result.map((r) => `${r.role}/${r.topic}`).sort();
    assert.deepEqual(topics, ["dev/monday", "user/metabase"]);
  });
});

describe("readRoleTopicFile", () => {
  beforeEach(setup);
  afterEach(() => process.chdir(originalCwd));

  it("returns default and custom content for a topic file", () => {
    writeDefaultTopic("user", "metabase", "metabase.md", "default content");
    writeCustomTopic("user", "metabase", "metabase.md", "custom content");

    const { default_content, custom_content } = readRoleTopicFile(
      "user",
      "metabase",
      "metabase.md",
    );
    assert.equal(default_content, "default content");
    assert.equal(custom_content, "custom content");
  });

  it("returns null for missing sources", () => {
    writeDefaultTopic("user", "metabase", "metabase.md", "default only");

    const { default_content, custom_content } = readRoleTopicFile(
      "user",
      "metabase",
      "metabase.md",
    );
    assert.equal(default_content, "default only");
    assert.equal(custom_content, null);
  });
});
