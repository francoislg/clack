import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { loadConfig } from "./config.js";
import {
  listInstructionFiles,
  readInstructionFile,
  writeInstructionFile,
} from "./configurationFiles.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpBase = resolve("/private/tmp", `configfiles-test-${process.pid}`);
const tmpDataDir = join(tmpBase, "data");
const tmpAuthDir = join(tmpDataDir, "auth");
const configPath = join(tmpDataDir, "config.json");
const slackAuthPath = join(tmpAuthDir, "slack.json");
const configDir = join(tmpDataDir, "configuration");
const defaultDir = join(tmpDataDir, "default_configuration");

function writeSlackAuth() {
  mkdirSync(tmpAuthDir, { recursive: true });
  writeFileSync(
    slackAuthPath,
    JSON.stringify({
      botToken: "xoxb-111-222-abc",
      appToken: "xapp-1-A111-222-xyz",
      signingSecret: "s3cr3t",
    })
  );
}

function writeConfig(repos: Array<{ name: string; url: string; description: string }>) {
  mkdirSync(tmpDataDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify({ repositories: repos }));
}

function writeDefaultFile(filename: string, content: string) {
  const filePath = resolve(defaultDir, filename);
  mkdirSync(resolve(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

function writeOverrideFile(filename: string, content: string) {
  const filePath = resolve(configDir, filename);
  mkdirSync(resolve(filePath, ".."), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

const originalCwd = process.cwd();

// ---------------------------------------------------------------------------
// listInstructionFiles
// ---------------------------------------------------------------------------

describe("listInstructionFiles", () => {
  beforeEach(() => {
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
    mkdirSync(tmpBase, { recursive: true });
    process.chdir(tmpBase);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("returns empty roles when no role directory files exist", () => {
    writeSlackAuth();
    writeConfig([
      { name: "repo", url: "https://github.com/org/repo.git", description: "Repo" },
    ]);
    loadConfig(configPath, true);

    const result = listInstructionFiles();
    assert.deepEqual(result.roles, []);
  });

  it("scans role directories for default files", () => {
    writeSlackAuth();
    writeConfig([
      { name: "repo", url: "https://github.com/org/repo.git", description: "Repo" },
    ]);
    loadConfig(configPath, true);

    writeDefaultFile("user/identity.md", "identity content");
    writeDefaultFile("user/behavior.md", "behavior content");
    writeDefaultFile("dev/changes.md", "changes content");

    const result = listInstructionFiles();

    const userRole = result.roles.find((r) => r.role === "user");
    assert.ok(userRole);
    assert.equal(userRole.files.length, 2);
    assert.ok(userRole.files.some((f) => f.filename === "behavior.md" && f.source === "default"));
    assert.ok(userRole.files.some((f) => f.filename === "identity.md" && f.source === "default"));

    const devRole = result.roles.find((r) => r.role === "dev");
    assert.ok(devRole);
    assert.equal(devRole.files.length, 1);
    assert.ok(devRole.files.some((f) => f.filename === "changes.md" && f.source === "default"));
  });

  it("reports source=customized when both default and custom exist", () => {
    writeSlackAuth();
    writeConfig([
      { name: "repo", url: "https://github.com/org/repo.git", description: "Repo" },
    ]);
    loadConfig(configPath, true);

    writeDefaultFile("user/identity.md", "default content");
    writeOverrideFile("user/identity.md", "custom content");

    const result = listInstructionFiles();

    const userRole = result.roles.find((r) => r.role === "user");
    assert.ok(userRole);
    const entry = userRole.files.find((f) => f.filename === "identity.md");
    assert.ok(entry);
    assert.equal(entry.source, "customized");
  });

  it("reports source=custom-only when only custom file exists", () => {
    writeSlackAuth();
    writeConfig([
      { name: "repo", url: "https://github.com/org/repo.git", description: "Repo" },
    ]);
    loadConfig(configPath, true);

    writeOverrideFile("admin/custom-rule.md", "admin custom");

    const result = listInstructionFiles();

    const adminRole = result.roles.find((r) => r.role === "admin");
    assert.ok(adminRole);
    const entry = adminRole.files.find((f) => f.filename === "custom-rule.md");
    assert.ok(entry);
    assert.equal(entry.source, "custom-only");
  });

  it("omits role directories with no files", () => {
    writeSlackAuth();
    writeConfig([
      { name: "repo", url: "https://github.com/org/repo.git", description: "Repo" },
    ]);
    loadConfig(configPath, true);

    writeDefaultFile("user/identity.md", "content");

    const result = listInstructionFiles();

    assert.equal(result.roles.length, 1);
    assert.equal(result.roles[0].role, "user");
  });

  it("includes repo-scoped instruction files for each configured repository", () => {
    writeSlackAuth();
    writeConfig([
      { name: "alpha", url: "https://github.com/org/alpha.git", description: "Alpha" },
      { name: "beta", url: "https://github.com/org/beta.git", description: "Beta" },
    ]);
    loadConfig(configPath, true);

    const result = listInstructionFiles();
    const repoFilenames = result.repos.map((r) => r.filename);

    assert.ok(repoFilenames.includes("alpha/changes_instructions.md"));
    assert.ok(repoFilenames.includes("alpha/worktree_setup_instructions.md"));
    assert.ok(repoFilenames.includes("beta/changes_instructions.md"));
    assert.ok(repoFilenames.includes("beta/worktree_setup_instructions.md"));
  });

  it("reports hasDefault and hasOverride for repo files", () => {
    writeSlackAuth();
    writeConfig([
      { name: "repo", url: "https://github.com/org/repo.git", description: "Repo" },
    ]);
    loadConfig(configPath, true);

    writeDefaultFile("repo/changes_instructions.md", "default changes");
    writeOverrideFile("repo/worktree_setup_instructions.md", "custom setup");

    const result = listInstructionFiles();

    const changesEntry = result.repos.find((r) => r.filename === "repo/changes_instructions.md");
    assert.ok(changesEntry);
    assert.equal(changesEntry.hasDefault, true);
    assert.equal(changesEntry.hasOverride, false);

    const setupEntry = result.repos.find((r) => r.filename === "repo/worktree_setup_instructions.md");
    assert.ok(setupEntry);
    assert.equal(setupEntry.hasDefault, false);
    assert.equal(setupEntry.hasOverride, true);
  });

  it("returns correct repo count: 2 files per repo", () => {
    writeSlackAuth();
    writeConfig([
      { name: "a", url: "https://github.com/org/a.git", description: "A" },
      { name: "b", url: "https://github.com/org/b.git", description: "B" },
      { name: "c", url: "https://github.com/org/c.git", description: "C" },
    ]);
    loadConfig(configPath, true);

    const result = listInstructionFiles();
    assert.equal(result.repos.length, 6);
  });
});

// ---------------------------------------------------------------------------
// readInstructionFile
// ---------------------------------------------------------------------------

describe("readInstructionFile", () => {
  beforeEach(() => {
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
    mkdirSync(tmpBase, { recursive: true });
    process.chdir(tmpBase);
    writeSlackAuth();
    writeConfig([
      { name: "repo", url: "https://github.com/org/repo.git", description: "Repo" },
    ]);
    loadConfig(configPath, true);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("returns both default and custom content when both exist", () => {
    writeDefaultFile("user/identity.md", "default content");
    writeOverrideFile("user/identity.md", "custom content");

    const result = readInstructionFile("user/identity.md");
    assert.equal(result.default_content, "default content");
    assert.equal(result.custom_content, "custom content");
  });

  it("returns only default_content when no custom file exists", () => {
    writeDefaultFile("user/identity.md", "default content");

    const result = readInstructionFile("user/identity.md");
    assert.equal(result.default_content, "default content");
    assert.equal(result.custom_content, null);
  });

  it("returns only custom_content when no default file exists", () => {
    writeOverrideFile("dev/custom-rule.md", "custom only");

    const result = readInstructionFile("dev/custom-rule.md");
    assert.equal(result.default_content, null);
    assert.equal(result.custom_content, "custom only");
  });

  it("returns both null when neither file exists", () => {
    const result = readInstructionFile("user/nonexistent.md");
    assert.equal(result.default_content, null);
    assert.equal(result.custom_content, null);
  });

  it("returns both null for paths without role/filename format", () => {
    const result = readInstructionFile("no-slash.md");
    assert.equal(result.default_content, null);
    assert.equal(result.custom_content, null);
  });

  it("preserves file content exactly (whitespace, newlines, unicode)", () => {
    const content = "  line 1\n\ttab line\n\nempty above\n\u2603 snowman\n";
    writeOverrideFile("user/identity.md", content);

    const result = readInstructionFile("user/identity.md");
    assert.equal(result.custom_content, content);
  });

  it("works with all role directories", () => {
    writeDefaultFile("admin/config.md", "admin default");
    writeDefaultFile("owner/owner-stuff.md", "owner default");

    const adminResult = readInstructionFile("admin/config.md");
    assert.equal(adminResult.default_content, "admin default");

    const ownerResult = readInstructionFile("owner/owner-stuff.md");
    assert.equal(ownerResult.default_content, "owner default");
  });
});

// ---------------------------------------------------------------------------
// writeInstructionFile
// ---------------------------------------------------------------------------

describe("writeInstructionFile", () => {
  beforeEach(() => {
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
    mkdirSync(tmpBase, { recursive: true });
    process.chdir(tmpBase);
    writeSlackAuth();
    writeConfig([
      { name: "repo", url: "https://github.com/org/repo.git", description: "Repo" },
    ]);
    loadConfig(configPath, true);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("writes a file to the configuration directory", () => {
    writeInstructionFile("instructions.md", "new content");

    const writtenPath = resolve(configDir, "instructions.md");
    assert.ok(existsSync(writtenPath));
    assert.equal(readFileSync(writtenPath, "utf-8"), "new content");
  });

  it("creates parent directories for repo-scoped files", () => {
    writeInstructionFile("repo/changes_instructions.md", "changes content");

    const writtenPath = resolve(configDir, "repo/changes_instructions.md");
    assert.ok(existsSync(writtenPath));
    assert.equal(readFileSync(writtenPath, "utf-8"), "changes content");
  });

  it("overwrites an existing file", () => {
    writeOverrideFile("instructions.md", "old content");

    writeInstructionFile("instructions.md", "updated content");

    const writtenPath = resolve(configDir, "instructions.md");
    assert.equal(readFileSync(writtenPath, "utf-8"), "updated content");
  });

  it("blocks path traversal with ../", () => {
    assert.throws(
      () => writeInstructionFile("../escape.md", "malicious"),
      /path traversal not allowed/
    );
  });

  it("blocks path traversal with absolute path component", () => {
    // A filename like "foo/../../etc/passwd" should resolve outside configDir
    assert.throws(
      () => writeInstructionFile("foo/../../escape.md", "malicious"),
      /path traversal not allowed/
    );
  });

  it("allows nested subdirectory writes", () => {
    writeInstructionFile("deep/nested/file.md", "nested content");

    const writtenPath = resolve(configDir, "deep/nested/file.md");
    assert.ok(existsSync(writtenPath));
    assert.equal(readFileSync(writtenPath, "utf-8"), "nested content");
  });

  it("preserves content exactly (whitespace, newlines, unicode)", () => {
    const content = "  spaces\n\ttabs\n\n\u2603 snowman\nend\n";
    writeInstructionFile("instructions.md", content);

    const writtenPath = resolve(configDir, "instructions.md");
    assert.equal(readFileSync(writtenPath, "utf-8"), content);
  });

  it("written file is then readable via readInstructionFile", () => {
    writeInstructionFile("admin/custom-rule.md", "admin stuff");

    const result = readInstructionFile("admin/custom-rule.md");
    assert.equal(result.custom_content, "admin stuff");
  });

  it("written override takes precedence over existing default", () => {
    writeDefaultFile("user/identity.md", "default version");
    writeInstructionFile("user/identity.md", "override version");

    const result = readInstructionFile("user/identity.md");
    assert.equal(result.default_content, "default version");
    assert.equal(result.custom_content, "override version");
  });
});
