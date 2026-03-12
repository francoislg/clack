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

  it("returns the four static role files when no repos are configured", () => {
    writeSlackAuth();
    writeConfig([
      { name: "my-repo", url: "https://github.com/org/my-repo.git", description: "Test" },
    ]);
    loadConfig(configPath, true);

    const files = listInstructionFiles();
    const filenames = files.map((f) => f.filename);

    assert.ok(filenames.includes("instructions.md"));
    assert.ok(filenames.includes("dev_instructions.md"));
    assert.ok(filenames.includes("admin_instructions.md"));
    assert.ok(filenames.includes("user_instructions.md"));
  });

  it("includes repo-scoped instruction files for each configured repository", () => {
    writeSlackAuth();
    writeConfig([
      { name: "alpha", url: "https://github.com/org/alpha.git", description: "Alpha" },
      { name: "beta", url: "https://github.com/org/beta.git", description: "Beta" },
    ]);
    loadConfig(configPath, true);

    const files = listInstructionFiles();
    const filenames = files.map((f) => f.filename);

    assert.ok(filenames.includes("alpha/changes_instructions.md"));
    assert.ok(filenames.includes("alpha/worktree_setup_instructions.md"));
    assert.ok(filenames.includes("beta/changes_instructions.md"));
    assert.ok(filenames.includes("beta/worktree_setup_instructions.md"));
  });

  it("reports hasDefault=true when a default file exists", () => {
    writeSlackAuth();
    writeConfig([
      { name: "repo", url: "https://github.com/org/repo.git", description: "Repo" },
    ]);
    loadConfig(configPath, true);

    writeDefaultFile("instructions.md", "default content");

    const files = listInstructionFiles();
    const entry = files.find((f) => f.filename === "instructions.md");
    assert.ok(entry);
    assert.equal(entry.hasDefault, true);
    assert.equal(entry.hasOverride, false);
  });

  it("reports hasOverride=true when an override file exists", () => {
    writeSlackAuth();
    writeConfig([
      { name: "repo", url: "https://github.com/org/repo.git", description: "Repo" },
    ]);
    loadConfig(configPath, true);

    writeOverrideFile("instructions.md", "override content");

    const files = listInstructionFiles();
    const entry = files.find((f) => f.filename === "instructions.md");
    assert.ok(entry);
    assert.equal(entry.hasOverride, true);
  });

  it("reports both hasDefault and hasOverride when both exist", () => {
    writeSlackAuth();
    writeConfig([
      { name: "repo", url: "https://github.com/org/repo.git", description: "Repo" },
    ]);
    loadConfig(configPath, true);

    writeDefaultFile("dev_instructions.md", "default");
    writeOverrideFile("dev_instructions.md", "override");

    const files = listInstructionFiles();
    const entry = files.find((f) => f.filename === "dev_instructions.md");
    assert.ok(entry);
    assert.equal(entry.hasDefault, true);
    assert.equal(entry.hasOverride, true);
  });

  it("reports hasDefault=false and hasOverride=false when neither exists", () => {
    writeSlackAuth();
    writeConfig([
      { name: "repo", url: "https://github.com/org/repo.git", description: "Repo" },
    ]);
    loadConfig(configPath, true);

    const files = listInstructionFiles();
    const entry = files.find((f) => f.filename === "admin_instructions.md");
    assert.ok(entry);
    assert.equal(entry.hasDefault, false);
    assert.equal(entry.hasOverride, false);
  });

  it("returns correct count: 4 static + 2 per repo", () => {
    writeSlackAuth();
    writeConfig([
      { name: "a", url: "https://github.com/org/a.git", description: "A" },
      { name: "b", url: "https://github.com/org/b.git", description: "B" },
      { name: "c", url: "https://github.com/org/c.git", description: "C" },
    ]);
    loadConfig(configPath, true);

    const files = listInstructionFiles();
    // 4 static + 3 repos * 2 files each = 10
    assert.equal(files.length, 10);
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

  it("returns the override content when an override file exists", () => {
    writeDefaultFile("instructions.md", "default content");
    writeOverrideFile("instructions.md", "override content");

    const result = readInstructionFile("instructions.md");
    assert.equal(result, "override content");
  });

  it("falls back to the default file when no override exists", () => {
    writeDefaultFile("instructions.md", "default content");

    const result = readInstructionFile("instructions.md");
    assert.equal(result, "default content");
  });

  it("returns null when neither override nor default exists", () => {
    const result = readInstructionFile("nonexistent.md");
    assert.equal(result, null);
  });

  it("prefers override even for repo-scoped files", () => {
    writeDefaultFile("repo/changes_instructions.md", "default changes");
    writeOverrideFile("repo/changes_instructions.md", "override changes");

    const result = readInstructionFile("repo/changes_instructions.md");
    assert.equal(result, "override changes");
  });

  it("reads default repo-scoped file when no override exists", () => {
    writeDefaultFile("repo/worktree_setup_instructions.md", "default setup");

    const result = readInstructionFile("repo/worktree_setup_instructions.md");
    assert.equal(result, "default setup");
  });

  it("preserves file content exactly (whitespace, newlines, unicode)", () => {
    const content = "  line 1\n\ttab line\n\nempty above\n\u2603 snowman\n";
    writeOverrideFile("instructions.md", content);

    const result = readInstructionFile("instructions.md");
    assert.equal(result, content);
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
    writeInstructionFile("admin_instructions.md", "admin stuff");

    const result = readInstructionFile("admin_instructions.md");
    assert.equal(result, "admin stuff");
  });

  it("written override takes precedence over existing default", () => {
    writeDefaultFile("instructions.md", "default version");
    writeInstructionFile("instructions.md", "override version");

    const result = readInstructionFile("instructions.md");
    assert.equal(result, "override version");
  });
});
