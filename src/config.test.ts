import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  findRepoByName,
  getDataDir,
  getRepositoriesDir,
  getSessionsDir,
  getWorktreesDir,
  getConfigurationDir,
  getDefaultConfigurationDir,
  getWorktreeSessionsDir,
  loadConfig,
  getConfig,
  type Config,
  type RepositoryConfig,
} from "./config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A minimal valid config object with one repository. */
function minimalConfig(overrides?: Record<string, unknown>) {
  return {
    repositories: [
      {
        name: "my-repo",
        url: "https://github.com/org/my-repo.git",
        description: "A test repository",
      },
    ],
    ...overrides,
  };
}

/** A full Config object for findRepoByName tests (no filesystem needed). */
function makeConfig(repos: RepositoryConfig[]): Config {
  return {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "secret",
      fetchAndStoreUsername: false,
      sendErrorsAsDM: false,
    },
    reactions: { trigger: "robot_face" },
    directMessages: { enabled: false },
    mentions: { enabled: false },
    repositories: repos,
    git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
    sessions: { cleanupIntervalMinutes: 60 },
    claudeCode: { model: "sonnet" },
  };
}

// Temp directory used by loadConfig tests
const tmpBase = resolve(tmpdir(), `config-test-${process.pid}`);
const tmpDataDir = join(tmpBase, "data");
const tmpAuthDir = join(tmpDataDir, "auth");
const configPath = join(tmpDataDir, "config.json");
const slackAuthPath = join(tmpAuthDir, "slack.json");

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

function writeConfig(obj: unknown) {
  mkdirSync(tmpDataDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// findRepoByName
// ---------------------------------------------------------------------------

describe("findRepoByName", () => {
  const repos: RepositoryConfig[] = [
    {
      name: "Frontend",
      url: "https://github.com/org/frontend.git",
      description: "UI app",
    },
    {
      name: "backend-api",
      url: "https://github.com/org/backend-api.git",
      description: "API server",
    },
  ];
  const config = makeConfig(repos);

  it("finds a repo by exact name", () => {
    const result = findRepoByName("Frontend", config);
    assert.equal(result?.name, "Frontend");
  });

  it("finds a repo case-insensitively", () => {
    assert.equal(findRepoByName("frontend", config)?.name, "Frontend");
    assert.equal(findRepoByName("FRONTEND", config)?.name, "Frontend");
    assert.equal(findRepoByName("BACKEND-API", config)?.name, "backend-api");
  });

  it("returns undefined for unknown repo", () => {
    assert.equal(findRepoByName("nonexistent", config), undefined);
  });

  it("returns undefined for empty string", () => {
    assert.equal(findRepoByName("", config), undefined);
  });
});

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

describe("path helpers", () => {
  const cwd = process.cwd();
  const dataDir = resolve(cwd, "data");

  it("getDataDir returns data/ under cwd", () => {
    assert.equal(getDataDir(), dataDir);
  });

  it("getRepositoriesDir returns data/repositories", () => {
    assert.equal(getRepositoriesDir(), resolve(dataDir, "repositories"));
  });

  it("getSessionsDir returns data/sessions", () => {
    assert.equal(getSessionsDir(), resolve(dataDir, "sessions"));
  });

  it("getWorktreesDir returns data/worktrees", () => {
    assert.equal(getWorktreesDir(), resolve(dataDir, "worktrees"));
  });

  it("getConfigurationDir returns data/configuration", () => {
    assert.equal(getConfigurationDir(), resolve(dataDir, "configuration"));
  });

  it("getDefaultConfigurationDir returns data/default_configuration", () => {
    assert.equal(getDefaultConfigurationDir(), resolve(dataDir, "default_configuration"));
  });

  it("getWorktreeSessionsDir returns data/worktree-sessions", () => {
    assert.equal(getWorktreeSessionsDir(), resolve(dataDir, "worktree-sessions"));
  });
});

// ---------------------------------------------------------------------------
// loadConfig / validateConfig (tested through loadConfig)
// ---------------------------------------------------------------------------

describe("loadConfig", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    // Clean up any cached config from previous tests
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
    mkdirSync(tmpBase, { recursive: true });
    // Change cwd so loadSlackAuth finds our temp auth file
    process.chdir(tmpBase);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("loads a minimal valid config with defaults applied", () => {
    writeSlackAuth();
    writeConfig(minimalConfig());

    const cfg = loadConfig(configPath, true);

    // Slack auth merged in
    assert.equal(cfg.slack.botToken, "xoxb-111-222-abc");
    assert.equal(cfg.slack.appToken, "xapp-1-A111-222-xyz");
    assert.equal(cfg.slack.signingSecret, "s3cr3t");
    assert.equal(cfg.slack.fetchAndStoreUsername, false);
    assert.equal(cfg.slack.sendErrorsAsDM, false);

    // Repository parsed
    assert.equal(cfg.repositories.length, 1);
    assert.equal(cfg.repositories[0].name, "my-repo");
    assert.equal(cfg.repositories[0].branch, "main"); // default branch

    // Defaults
    assert.equal(cfg.reactions.trigger, "robot_face");
    assert.equal(cfg.reactions.thinking?.type, "message");
    assert.equal(cfg.directMessages.enabled, false);
    assert.equal(cfg.mentions.enabled, false);
    assert.equal(cfg.git.pullIntervalMinutes, 60);
    assert.equal(cfg.git.shallowClone, true);
    assert.equal(cfg.git.cloneDepth, 1);
    assert.equal(cfg.sessions.cleanupIntervalMinutes, 60);
    assert.equal(cfg.claudeCode.model, "sonnet");
    assert.equal(cfg.slackApp?.name, "Clack");
    assert.equal(cfg.changesWorkflow, undefined);
  });

  it("applies user-provided values over defaults", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        slack: {
          fetchAndStoreUsername: true,
          sendErrorsAsDM: true,
        },
        reactions: {
          trigger: "thinking_face",
          thinking: { type: "emoji", emoji: "hourglass" },
        },
        directMessages: { enabled: true },
        mentions: { enabled: true, thinking: { type: "emoji", emoji: "eyes" } },
        git: { pullIntervalMinutes: 30, shallowClone: false, cloneDepth: 50 },
        sessions: { cleanupIntervalMinutes: 120 },
        claudeCode: { model: "opus" },
        slackApp: {
          name: "CustomBot",
          description: "Custom desc",
          backgroundColor: "#FF0000",
        },
      }),
    );

    const cfg = loadConfig(configPath, true);

    assert.equal(cfg.slack.fetchAndStoreUsername, true);
    assert.equal(cfg.slack.sendErrorsAsDM, true);
    assert.equal(cfg.reactions.trigger, "thinking_face");
    assert.equal(cfg.reactions.thinking?.type, "emoji");
    assert.equal(cfg.reactions.thinking?.emoji, "hourglass");
    assert.equal(cfg.directMessages.enabled, true);
    assert.equal(cfg.mentions.enabled, true);
    assert.equal(cfg.mentions.thinking?.type, "emoji");
    assert.equal(cfg.mentions.thinking?.emoji, "eyes");
    assert.equal(cfg.git.pullIntervalMinutes, 30);
    assert.equal(cfg.git.shallowClone, false);
    assert.equal(cfg.git.cloneDepth, 50);
    assert.equal(cfg.sessions.cleanupIntervalMinutes, 120);
    assert.equal(cfg.claudeCode.model, "opus");
    assert.equal(cfg.slackApp?.name, "CustomBot");
    assert.equal(cfg.slackApp?.backgroundColor, "#FF0000");
  });

  it("parses changesWorkflow config", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        changesWorkflow: {
          enabled: true,
          timeoutMinutes: 30,
          additionalAllowedTools: ["tool_a", "tool_b"],
          sessionExpiryHours: 48,
          monitoringIntervalMinutes: 10,
        },
        reactions: {
          trigger: "robot_face",
          changesWorkflow: { enabled: true, trigger: "wrench" },
        },
        directMessages: {
          enabled: true,
          changesWorkflow: { enabled: true },
        },
      }),
    );

    const cfg = loadConfig(configPath, true);

    assert.equal(cfg.changesWorkflow?.enabled, true);
    assert.equal(cfg.changesWorkflow?.timeoutMinutes, 30);
    assert.deepEqual(cfg.changesWorkflow?.additionalAllowedTools, ["tool_a", "tool_b"]);
    assert.equal(cfg.changesWorkflow?.sessionExpiryHours, 48);
    assert.equal(cfg.changesWorkflow?.monitoringIntervalMinutes, 10);

    assert.equal(cfg.reactions.changesWorkflow?.enabled, true);
    assert.equal(cfg.reactions.changesWorkflow?.trigger, "wrench");
    assert.equal(cfg.directMessages.changesWorkflow?.enabled, true);
  });

  it("parses repository with access control and merge strategy", () => {
    writeSlackAuth();
    writeConfig({
      repositories: [
        {
          name: "private-repo",
          url: "https://github.com/org/private.git",
          description: "Private repo",
          branch: "develop",
          access: { read: "dev", write: "admin" },
          mergeStrategy: "squash",
        },
      ],
    });

    const cfg = loadConfig(configPath, true);
    const repo = cfg.repositories[0];

    assert.equal(repo.name, "private-repo");
    assert.equal(repo.branch, "develop");
    assert.equal(repo.access?.read, "dev");
    assert.equal(repo.access?.write, "admin");
    assert.equal(repo.mergeStrategy, "squash");
  });

  it("defaults branch to main when not specified", () => {
    writeSlackAuth();
    writeConfig(minimalConfig());

    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.repositories[0].branch, "main");
  });

  // ---- Validation errors ----

  it("throws when config is not an object", () => {
    writeSlackAuth();
    writeConfig("not an object");

    assert.throws(() => loadConfig(configPath, true), /Config must be an object/);
  });

  it("throws when repositories is missing", () => {
    writeSlackAuth();
    writeConfig({});

    assert.throws(() => loadConfig(configPath, true), /repositories.*must be a non-empty array/);
  });

  it("throws when repositories is an empty array", () => {
    writeSlackAuth();
    writeConfig({ repositories: [] });

    assert.throws(() => loadConfig(configPath, true), /repositories.*must be a non-empty array/);
  });

  it("throws when a repository is missing name", () => {
    writeSlackAuth();
    writeConfig({
      repositories: [{ url: "https://github.com/org/r.git", description: "d" }],
    });

    assert.throws(() => loadConfig(configPath, true), /Repository 'name' is required/);
  });

  it("throws when a repository is missing url", () => {
    writeSlackAuth();
    writeConfig({
      repositories: [{ name: "r", description: "d" }],
    });

    assert.throws(() => loadConfig(configPath, true), /Repository 'url' is required/);
  });

  it("throws when a repository is missing description", () => {
    writeSlackAuth();
    writeConfig({
      repositories: [{ name: "r", url: "https://github.com/org/r.git" }],
    });

    assert.throws(() => loadConfig(configPath, true), /Repository 'description' is required/);
  });

  it("throws when repository access.read has an invalid role", () => {
    writeSlackAuth();
    writeConfig({
      repositories: [
        {
          name: "r",
          url: "https://github.com/org/r.git",
          description: "d",
          access: { read: "superuser" },
        },
      ],
    });

    assert.throws(() => loadConfig(configPath, true), /access\.read must be one of/);
  });

  it("throws when repository access.write has an invalid role", () => {
    writeSlackAuth();
    writeConfig({
      repositories: [
        {
          name: "r",
          url: "https://github.com/org/r.git",
          description: "d",
          access: { write: "root" },
        },
      ],
    });

    assert.throws(() => loadConfig(configPath, true), /access\.write must be one of/);
  });

  it("throws when repository mergeStrategy is invalid", () => {
    writeSlackAuth();
    writeConfig({
      repositories: [
        {
          name: "r",
          url: "https://github.com/org/r.git",
          description: "d",
          mergeStrategy: "fast-forward",
        },
      ],
    });

    assert.throws(() => loadConfig(configPath, true), /mergeStrategy.*must be one of/);
  });

  it("throws for invalid slackApp.backgroundColor", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        slackApp: { backgroundColor: "not-a-color" },
      }),
    );

    assert.throws(() => loadConfig(configPath, true), /backgroundColor.*must be a hex color/);
  });

  it("throws for empty slackApp.name", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        slackApp: { name: "" },
      }),
    );

    assert.throws(() => loadConfig(configPath, true), /slackApp\.name.*must be a non-empty string/);
  });

  it("throws when config file does not exist", () => {
    assert.throws(() => loadConfig("/nonexistent/path/config.json", true), /Config file not found/);
  });

  it("throws when config file is not valid JSON", () => {
    writeSlackAuth();
    mkdirSync(tmpDataDir, { recursive: true });
    writeFileSync(configPath, "{ invalid json }}}");

    assert.throws(() => loadConfig(configPath, true), /Config file is not valid JSON/);
  });

  // ---- Caching ----

  it("returns cached config on second call without forceReload", () => {
    writeSlackAuth();
    writeConfig(minimalConfig());

    const first = loadConfig(configPath, true);
    // Overwrite file with different data
    writeConfig(
      minimalConfig({
        claudeCode: { model: "haiku" },
      }),
    );
    const second = loadConfig(configPath);
    // Should still be cached
    assert.equal(second.claudeCode.model, first.claudeCode.model);
  });

  it("reloads config when forceReload is true", () => {
    writeSlackAuth();
    writeConfig(minimalConfig());

    const first = loadConfig(configPath, true);
    assert.equal(first.claudeCode.model, "sonnet");

    writeConfig(
      minimalConfig({
        claudeCode: { model: "haiku" },
      }),
    );
    const second = loadConfig(configPath, true);
    assert.equal(second.claudeCode.model, "haiku");
  });
});

// ---------------------------------------------------------------------------
// getConfig
// ---------------------------------------------------------------------------

describe("getConfig", () => {
  it("returns the config after loadConfig has been called", () => {
    // loadConfig was called in the previous describe block, so cachedConfig
    // should be set. getConfig should not throw.
    const cfg = getConfig();
    assert.ok(cfg);
    assert.ok(cfg.slack);
    assert.ok(cfg.repositories);
  });
});
