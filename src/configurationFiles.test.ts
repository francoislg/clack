import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { loadConfig } from "./config.js";
import {
  listInstructionFiles,
  readInstructionFile,
  writeInstructionFile,
  deleteInstructionFile,
  getEffectiveContentLength,
} from "./configurationFiles.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const tmpBase = resolve(tmpdir(), `configfiles-test-${process.pid}`);
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
    }),
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
    writeConfig([{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }]);
    loadConfig(configPath, true);

    const result = listInstructionFiles();
    assert.deepEqual(result.roles, []);
    assert.deepEqual(result.preAnalysis, []);
  });

  it("scans role directories for default files", () => {
    writeSlackAuth();
    writeConfig([{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }]);
    loadConfig(configPath, true);

    writeDefaultFile("user/identity.md", "identity content");
    writeDefaultFile("user/behavior.md", "behavior content");
    writeDefaultFile("dev/changes.md", "changes content");

    const result = listInstructionFiles();

    const userRole = result.roles.find((r) => r.role === "user");
    assert.ok(userRole);
    assert.equal(userRole.files.length, 2);
    assert.ok(userRole.files.some((f) => f.file === "behavior.md" && f.status === "default"));
    assert.ok(userRole.files.some((f) => f.file === "identity.md" && f.status === "default"));

    const devRole = result.roles.find((r) => r.role === "dev");
    assert.ok(devRole);
    assert.equal(devRole.files.length, 1);
    assert.ok(devRole.files.some((f) => f.file === "changes.md" && f.status === "default"));
  });

  it("reports status=customized when both default and custom exist", () => {
    writeSlackAuth();
    writeConfig([{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }]);
    loadConfig(configPath, true);

    writeDefaultFile("user/identity.md", "default content");
    writeOverrideFile("user/identity.md", "custom content");

    const result = listInstructionFiles();

    const userRole = result.roles.find((r) => r.role === "user");
    assert.ok(userRole);
    const entry = userRole.files.find((f) => f.file === "identity.md");
    assert.ok(entry);
    assert.equal(entry.status, "customized");
  });

  it("reports status=custom-only when only custom file exists", () => {
    writeSlackAuth();
    writeConfig([{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }]);
    loadConfig(configPath, true);

    writeOverrideFile("admin/custom-rule.md", "admin custom");

    const result = listInstructionFiles();

    const adminRole = result.roles.find((r) => r.role === "admin");
    assert.ok(adminRole);
    const entry = adminRole.files.find((f) => f.file === "custom-rule.md");
    assert.ok(entry);
    assert.equal(entry.status, "custom-only");
  });

  it("omits role directories with no baseline or topic files", () => {
    writeSlackAuth();
    writeConfig([{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }]);
    loadConfig(configPath, true);

    writeDefaultFile("user/identity.md", "content");

    const result = listInstructionFiles();
    const roleNames = result.roles.map((r) => r.role);

    assert.ok(roleNames.includes("user"));
    assert.ok(!roleNames.includes("dev"));
    assert.ok(!roleNames.includes("admin"));
    // pre-analysis is no longer surfaced inside roles
    assert.ok(!roleNames.includes("pre-analysis"));
  });

  it("surfaces topic files under the role's topics array", () => {
    writeSlackAuth();
    writeConfig([{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }]);
    loadConfig(configPath, true);

    writeDefaultFile("user/topics/metabase/rules.md", "default topic rules");
    writeOverrideFile("user/topics/metabase/queries.md", "custom queries");

    const result = listInstructionFiles();

    const userRole = result.roles.find((r) => r.role === "user");
    assert.ok(userRole);
    assert.equal(userRole.topics.length, 1);
    const metabase = userRole.topics[0];
    assert.equal(metabase.topic, "metabase");
    assert.ok(metabase.files.some((f) => f.file === "rules.md" && f.status === "default"));
    assert.ok(metabase.files.some((f) => f.file === "queries.md" && f.status === "custom-only"));
  });

  it("surfaces a role with topic-only files (no baseline)", () => {
    writeSlackAuth();
    writeConfig([{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }]);
    loadConfig(configPath, true);

    writeDefaultFile("dev/topics/monday/setup.md", "monday setup");

    const result = listInstructionFiles();

    const devRole = result.roles.find((r) => r.role === "dev");
    assert.ok(devRole);
    assert.deepEqual(devRole.files, []);
    assert.equal(devRole.topics.length, 1);
    assert.equal(devRole.topics[0].topic, "monday");
  });

  it("surfaces preAnalysis at the top level (not inside roles)", () => {
    writeSlackAuth();
    writeConfig([{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }]);
    loadConfig(configPath, true);

    writeDefaultFile("pre-analysis/context.md", "shared context");

    const result = listInstructionFiles();

    assert.equal(result.preAnalysis.length, 1);
    assert.equal(result.preAnalysis[0].file, "context.md");
    assert.equal(result.preAnalysis[0].status, "default");
    assert.ok(!result.roles.some((r) => r.role === "pre-analysis"));
  });

  it("includes repo-scoped instruction files for each configured repository", () => {
    writeSlackAuth();
    writeConfig([
      { name: "alpha", url: "https://github.com/org/alpha.git", description: "Alpha" },
      { name: "beta", url: "https://github.com/org/beta.git", description: "Beta" },
    ]);
    loadConfig(configPath, true);

    const result = listInstructionFiles();
    const repoNames = result.repos.map((r) => r.repo);

    assert.ok(repoNames.includes("alpha"));
    assert.ok(repoNames.includes("beta"));

    const alpha = result.repos.find((r) => r.repo === "alpha");
    assert.ok(alpha);
    assert.equal(alpha.files.length, 2);
    assert.ok(alpha.files.some((f) => f.file === "changes_instructions.md"));
    assert.ok(alpha.files.some((f) => f.file === "worktree_setup_instructions.md"));
  });

  it("reports semantic status for repo files", () => {
    writeSlackAuth();
    writeConfig([{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }]);
    loadConfig(configPath, true);

    writeDefaultFile("repo/changes_instructions.md", "default changes");
    writeOverrideFile("repo/worktree_setup_instructions.md", "custom setup");

    const result = listInstructionFiles();
    const repo = result.repos.find((r) => r.repo === "repo");
    assert.ok(repo);

    const changesEntry = repo.files.find((f) => f.file === "changes_instructions.md");
    assert.ok(changesEntry);
    assert.equal(changesEntry.status, "default");

    const setupEntry = repo.files.find((f) => f.file === "worktree_setup_instructions.md");
    assert.ok(setupEntry);
    assert.equal(setupEntry.status, "custom-only");
  });

  it("returns correct repo count: 1 entry per repo with 2 files each", () => {
    writeSlackAuth();
    writeConfig([
      { name: "a", url: "https://github.com/org/a.git", description: "A" },
      { name: "b", url: "https://github.com/org/b.git", description: "B" },
      { name: "c", url: "https://github.com/org/c.git", description: "C" },
    ]);
    loadConfig(configPath, true);

    const result = listInstructionFiles();
    assert.equal(result.repos.length, 3);
    for (const repo of result.repos) {
      assert.equal(repo.files.length, 2);
    }
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
    writeConfig([{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }]);
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

  it("reads a topic-scoped file via 4-segment path", () => {
    writeDefaultFile("dev/topics/metabase/rules.md", "topic default");
    writeOverrideFile("dev/topics/metabase/rules.md", "topic override");

    const result = readInstructionFile("dev/topics/metabase/rules.md");
    assert.equal(result.default_content, "topic default");
    assert.equal(result.custom_content, "topic override");
  });

  it("returns null/null for missing topic files", () => {
    const result = readInstructionFile("dev/topics/metabase/missing.md");
    assert.equal(result.default_content, null);
    assert.equal(result.custom_content, null);
  });

  it("returns null/null for 3-segment malformed paths", () => {
    const result = readInstructionFile("dev/topics/metabase");
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
    writeConfig([{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }]);
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
      /path traversal not allowed/,
    );
  });

  it("blocks path traversal with absolute path component", () => {
    // A filename like "foo/../../etc/passwd" should resolve outside configDir
    assert.throws(
      () => writeInstructionFile("foo/../../escape.md", "malicious"),
      /path traversal not allowed/,
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

  it("creates nested directories for a brand-new topic path", () => {
    writeInstructionFile("dev/topics/newtopic/rules.md", "topic content");

    const writtenPath = resolve(configDir, "dev/topics/newtopic/rules.md");
    assert.ok(existsSync(writtenPath));
    assert.equal(readFileSync(writtenPath, "utf-8"), "topic content");

    const result = readInstructionFile("dev/topics/newtopic/rules.md");
    assert.equal(result.custom_content, "topic content");
  });
});

// ---------------------------------------------------------------------------
// deleteInstructionFile
// ---------------------------------------------------------------------------

describe("deleteInstructionFile", () => {
  beforeEach(() => {
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
    mkdirSync(tmpBase, { recursive: true });
    process.chdir(tmpBase);
    writeSlackAuth();
    writeConfig([{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }]);
    loadConfig(configPath, true);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("deletes an existing override file", () => {
    writeOverrideFile("user/identity.md", "custom content");
    assert.ok(existsSync(resolve(configDir, "user/identity.md")));

    deleteInstructionFile("user/identity.md");
    assert.ok(!existsSync(resolve(configDir, "user/identity.md")));
  });

  it("throws when file does not exist", () => {
    assert.throws(() => deleteInstructionFile("user/nonexistent.md"), /File not found/);
  });

  it("blocks path traversal with ../", () => {
    assert.throws(() => deleteInstructionFile("../escape.md"), /path traversal not allowed/);
  });

  it("blocks path traversal with nested ../", () => {
    assert.throws(() => deleteInstructionFile("foo/../../escape.md"), /path traversal not allowed/);
  });

  it("does not affect default files", () => {
    writeDefaultFile("user/identity.md", "default content");
    writeOverrideFile("user/identity.md", "custom content");

    deleteInstructionFile("user/identity.md");

    const result = readInstructionFile("user/identity.md");
    assert.equal(result.default_content, "default content");
    assert.equal(result.custom_content, null);
  });
});

// ---------------------------------------------------------------------------
// getEffectiveContentLength
// ---------------------------------------------------------------------------

describe("getEffectiveContentLength", () => {
  beforeEach(() => {
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
    mkdirSync(tmpBase, { recursive: true });
    process.chdir(tmpBase);
    writeSlackAuth();
    writeConfig([{ name: "repo", url: "https://github.com/org/repo.git", description: "Repo" }]);
    loadConfig(configPath, true);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("returns custom content length when override exists", () => {
    writeDefaultFile("user/identity.md", "short");
    writeOverrideFile("user/identity.md", "much longer custom content");

    assert.equal(getEffectiveContentLength("user/identity.md"), 26);
  });

  it("returns default content length when no override exists", () => {
    writeDefaultFile("user/identity.md", "default content here");

    assert.equal(getEffectiveContentLength("user/identity.md"), 20);
  });

  it("returns 0 when neither file exists", () => {
    assert.equal(getEffectiveContentLength("user/nonexistent.md"), 0);
  });

  it("returns custom-only file length", () => {
    writeOverrideFile("admin/custom-rule.md", "custom only content");

    assert.equal(getEffectiveContentLength("admin/custom-rule.md"), 19);
  });
});
