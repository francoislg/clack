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
  getTaskCardMaxDetails,
  DEFAULT_TASK_CARD_MAX_DETAILS,
  DEFAULT_MAX_ADDITIONAL_MESSAGES,
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

  it("omits reusableFolders when changesWorkflow has no reusableFolders block", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        changesWorkflow: { enabled: true },
      }),
    );

    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.changesWorkflow?.reusableFolders, undefined);
  });

  it("applies reusableFolders defaults when block is empty", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        changesWorkflow: {
          enabled: true,
          reusableFolders: {},
        },
      }),
    );

    const cfg = loadConfig(configPath, true);
    const rf = cfg.changesWorkflow?.reusableFolders;
    assert.equal(rf?.enabled, false);
    assert.equal(rf?.minimumProvisioned, 0);
    assert.equal(rf?.maxConcurrent, 3);
    assert.equal(rf?.maxQueueDepth, 5);
    assert.equal(rf?.idleReleaseHours, 24);
    assert.equal(rf?.dirtyTrackedQuarantine, true);
  });

  it("parses partial reusableFolders block applying defaults to missing fields", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        changesWorkflow: {
          enabled: true,
          reusableFolders: {
            enabled: true,
            maxConcurrent: 5,
          },
        },
      }),
    );

    const cfg = loadConfig(configPath, true);
    const rf = cfg.changesWorkflow?.reusableFolders;
    assert.equal(rf?.enabled, true);
    assert.equal(rf?.maxConcurrent, 5);
    assert.equal(rf?.minimumProvisioned, 0);
    assert.equal(rf?.maxQueueDepth, 5);
    assert.equal(rf?.idleReleaseHours, 24);
    assert.equal(rf?.dirtyTrackedQuarantine, true);
  });

  it("parses full reusableFolders block", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        changesWorkflow: {
          enabled: true,
          reusableFolders: {
            enabled: true,
            minimumProvisioned: 2,
            maxConcurrent: 4,
            maxQueueDepth: 10,
            idleReleaseHours: 48,
            dirtyTrackedQuarantine: false,
          },
        },
      }),
    );

    const cfg = loadConfig(configPath, true);
    const rf = cfg.changesWorkflow?.reusableFolders;
    assert.equal(rf?.enabled, true);
    assert.equal(rf?.minimumProvisioned, 2);
    assert.equal(rf?.maxConcurrent, 4);
    assert.equal(rf?.maxQueueDepth, 10);
    assert.equal(rf?.idleReleaseHours, 48);
    assert.equal(rf?.dirtyTrackedQuarantine, false);
  });

  it("falls back to defaults when reusableFolders fields have invalid types", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        changesWorkflow: {
          enabled: true,
          reusableFolders: {
            maxConcurrent: "three",
            enabled: "yes",
          },
        },
      }),
    );

    const cfg = loadConfig(configPath, true);
    const rf = cfg.changesWorkflow?.reusableFolders;
    // Non-number is ignored, default is used
    assert.equal(rf?.maxConcurrent, 3);
    // Non-bool is ignored, default is false
    assert.equal(rf?.enabled, false);
  });

  it("parses reactions.stop when provided", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        reactions: { trigger: "robot_face", stop: "clack-stop" },
      }),
    );

    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.reactions.stop, "clack-stop");
  });

  it("coerces empty string to null for reactions.stop (feature disabled)", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        reactions: { trigger: "robot_face", stop: "" },
      }),
    );

    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.reactions.stop, null);
  });

  it("preserves reactions.stop: null as disabled", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        reactions: { trigger: "robot_face", stop: null },
      }),
    );

    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.reactions.stop, null);
  });

  it("rejects reactions.stop with colons", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        reactions: { trigger: "robot_face", stop: ":octagonal_sign:" },
      }),
    );

    assert.throws(() => loadConfig(configPath, true), /without colons or whitespace/);
  });

  it("rejects reactions.stop with whitespace", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        reactions: { trigger: "robot_face", stop: "octagonal sign" },
      }),
    );

    assert.throws(() => loadConfig(configPath, true), /without colons or whitespace/);
  });

  it("rejects reactions.stop that is not a string or null", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        reactions: { trigger: "robot_face", stop: 42 },
      }),
    );

    assert.throws(() => loadConfig(configPath, true), /must be a string or null/);
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

  it("parses a valid mcpServers registry", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        mcpServers: {
          metabase: { alwaysLoad: false, description: "metabase queries" },
          github: { alwaysLoad: true, description: "GitHub MCP — PRs, issues" },
        },
      }),
    );

    const cfg = loadConfig(configPath, true);

    assert.deepEqual(cfg.mcpServers, {
      metabase: { alwaysLoad: false, description: "metabase queries" },
      github: { alwaysLoad: true, description: "GitHub MCP — PRs, issues" },
    });
  });

  it("treats mcpServers as optional", () => {
    writeSlackAuth();
    writeConfig(minimalConfig());

    const cfg = loadConfig(configPath, true);

    assert.equal(cfg.mcpServers, undefined);
  });

  it("throws when mcpServers is not an object", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        mcpServers: ["metabase", "monday"],
      }),
    );

    assert.throws(() => loadConfig(configPath, true), /Config 'mcpServers' must be an object/);
  });

  it("throws when an entry is missing alwaysLoad", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        mcpServers: {
          metabase: { description: "metabase queries" },
        },
      }),
    );

    assert.throws(
      () => loadConfig(configPath, true),
      /'mcpServers\.metabase\.alwaysLoad' must be a boolean/,
    );
  });

  it("throws when an entry's description is empty", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        mcpServers: {
          metabase: { alwaysLoad: false, description: "   " },
        },
      }),
    );

    assert.throws(
      () => loadConfig(configPath, true),
      /'mcpServers\.metabase\.description' must be a non-empty string/,
    );
  });

  it("throws when an entry is not an object", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        mcpServers: { metabase: "not-an-object" },
      }),
    );

    assert.throws(() => loadConfig(configPath, true), /'mcpServers\.metabase' must be an object/);
  });

  it("parses a valid mcpServers entry with toolMapping", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        mcpServers: {
          "mongodb-dev": {
            alwaysLoad: false,
            description: "dev",
            toolMapping: { name: "mongodb", label: "dev" },
          },
          "mongodb-prod": {
            alwaysLoad: true,
            description: "prod",
            toolMapping: { name: "mongodb" },
          },
        },
      }),
    );

    const cfg = loadConfig(configPath, true);

    assert.deepEqual(cfg.mcpServers, {
      "mongodb-dev": {
        alwaysLoad: false,
        description: "dev",
        toolMapping: { name: "mongodb", label: "dev" },
      },
      "mongodb-prod": {
        alwaysLoad: true,
        description: "prod",
        toolMapping: { name: "mongodb" },
      },
    });
  });

  it("throws when toolMapping is not an object", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        mcpServers: {
          "mongodb-dev": { alwaysLoad: false, description: "dev", toolMapping: "mongodb" },
        },
      }),
    );

    assert.throws(
      () => loadConfig(configPath, true),
      /'mcpServers\.mongodb-dev\.toolMapping' must be an object/,
    );
  });

  it("throws when toolMapping.name is missing or has whitespace", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        mcpServers: {
          "mongodb-dev": {
            alwaysLoad: false,
            description: "dev",
            toolMapping: { name: "" },
          },
        },
      }),
    );
    assert.throws(
      () => loadConfig(configPath, true),
      /'mcpServers\.mongodb-dev\.toolMapping\.name' must be a non-empty identifier/,
    );

    writeConfig(
      minimalConfig({
        mcpServers: {
          "mongodb-dev": {
            alwaysLoad: false,
            description: "dev",
            toolMapping: { name: "mongo db" },
          },
        },
      }),
    );
    assert.throws(
      () => loadConfig(configPath, true),
      /'mcpServers\.mongodb-dev\.toolMapping\.name' must be a non-empty identifier/,
    );
  });

  it("throws when toolMapping.label is empty", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        mcpServers: {
          "mongodb-dev": {
            alwaysLoad: false,
            description: "dev",
            toolMapping: { name: "mongodb", label: "   " },
          },
        },
      }),
    );

    assert.throws(
      () => loadConfig(configPath, true),
      /'mcpServers\.mongodb-dev\.toolMapping\.label' must be a non-empty string/,
    );
  });

  it("throws when toolMapping has unknown keys", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        mcpServers: {
          "mongodb-dev": {
            alwaysLoad: false,
            description: "dev",
            toolMapping: { name: "mongodb", label: "dev", extra: true },
          },
        },
      }),
    );

    assert.throws(
      () => loadConfig(configPath, true),
      /'mcpServers\.mongodb-dev\.toolMapping' contains unknown key 'extra'/,
    );
  });

  it("parses a valid skillPlugins registry", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        skillPlugins: {
          marketingskills: { lazyLoad: true, description: "Marketing playbooks" },
          othersskills: { lazyLoad: false },
        },
      }),
    );

    const cfg = loadConfig(configPath, true);

    assert.deepEqual(cfg.skillPlugins, {
      marketingskills: { lazyLoad: true, description: "Marketing playbooks" },
      othersskills: { lazyLoad: false, description: "" },
    });
  });

  it("treats skillPlugins as optional", () => {
    writeSlackAuth();
    writeConfig(minimalConfig());

    const cfg = loadConfig(configPath, true);

    assert.equal(cfg.skillPlugins, undefined);
  });

  it("throws when skillPlugins is not an object", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        skillPlugins: ["marketingskills"],
      }),
    );

    assert.throws(() => loadConfig(configPath, true), /Config 'skillPlugins' must be an object/);
  });

  it("throws when a skillPlugins entry is missing lazyLoad", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        skillPlugins: {
          marketingskills: { description: "Marketing playbooks" },
        },
      }),
    );

    assert.throws(
      () => loadConfig(configPath, true),
      /'skillPlugins\.marketingskills\.lazyLoad' must be a boolean/,
    );
  });

  it("throws when a skillPlugins entry has non-string description", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        skillPlugins: {
          marketingskills: { lazyLoad: false, description: 42 },
        },
      }),
    );

    assert.throws(
      () => loadConfig(configPath, true),
      /'skillPlugins\.marketingskills\.description' must be a string if provided/,
    );
  });

  it("throws when a skillPlugins entry is not an object", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        skillPlugins: { marketingskills: "lazy" },
      }),
    );

    assert.throws(
      () => loadConfig(configPath, true),
      /'skillPlugins\.marketingskills' must be an object/,
    );
  });

  it("throws when a lazy skillPlugins entry has no description", () => {
    writeSlackAuth();
    writeConfig(
      minimalConfig({
        skillPlugins: {
          marketingskills: { lazyLoad: true },
        },
      }),
    );

    assert.throws(
      () => loadConfig(configPath, true),
      /'skillPlugins\.marketingskills\.description' must be a non-empty string when lazyLoad is true/,
    );
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

// ---------------------------------------------------------------------------
// taskCards / getTaskCardMaxDetails
// ---------------------------------------------------------------------------

describe("taskCards config", () => {
  beforeEach(() => {
    writeSlackAuth();
  });

  afterEach(() => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true, force: true });
  });

  it("parses taskCards.maxDetailsPerGroup when set to a positive integer", () => {
    writeConfig(minimalConfig({ taskCards: { maxDetailsPerGroup: 8 } }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.taskCards?.maxDetailsPerGroup, 8);
    assert.equal(getTaskCardMaxDetails(), 8);
  });

  it("accepts maxDetailsPerGroup of 0 (header-only task cards)", () => {
    writeConfig(minimalConfig({ taskCards: { maxDetailsPerGroup: 0 } }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.taskCards?.maxDetailsPerGroup, 0);
    assert.equal(getTaskCardMaxDetails(), 0);
  });

  it("falls back to default when taskCards section is absent", () => {
    writeConfig(minimalConfig());
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.taskCards, undefined);
    assert.equal(getTaskCardMaxDetails(), DEFAULT_TASK_CARD_MAX_DETAILS);
  });

  it("falls back to default when maxDetailsPerGroup field is absent", () => {
    writeConfig(minimalConfig({ taskCards: {} }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.taskCards?.maxDetailsPerGroup, undefined);
    assert.equal(getTaskCardMaxDetails(), DEFAULT_TASK_CARD_MAX_DETAILS);
  });

  it("falls back to default when maxDetailsPerGroup is negative", () => {
    writeConfig(minimalConfig({ taskCards: { maxDetailsPerGroup: -1 } }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.taskCards?.maxDetailsPerGroup, undefined);
    assert.equal(getTaskCardMaxDetails(), DEFAULT_TASK_CARD_MAX_DETAILS);
  });

  it("falls back to default when maxDetailsPerGroup is a non-number", () => {
    writeConfig(minimalConfig({ taskCards: { maxDetailsPerGroup: "five" } }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.taskCards?.maxDetailsPerGroup, undefined);
    assert.equal(getTaskCardMaxDetails(), DEFAULT_TASK_CARD_MAX_DETAILS);
  });
});

// ---------------------------------------------------------------------------
// trivia.answersFormat + trivia.choices
// ---------------------------------------------------------------------------

describe("trivia.answersFormat config", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(tmpBase, { recursive: true });
    process.chdir(tmpBase);
    writeSlackAuth();
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("absent when trivia block is absent", () => {
    writeConfig(minimalConfig());
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia, undefined);
  });

  it("absent when trivia block lacks answersFormat", () => {
    writeConfig(minimalConfig({ trivia: {} }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.answersFormat, undefined);
  });

  it("parses a weighted mix", () => {
    writeConfig(minimalConfig({ trivia: { answersFormat: { boolean: 2, choice: 1 } } }));
    const cfg = loadConfig(configPath, true);
    assert.deepEqual(cfg.trivia?.answersFormat, { boolean: 2, choice: 1, freeform: 0 });
  });

  it("parses choice-only", () => {
    writeConfig(minimalConfig({ trivia: { answersFormat: { choice: 5 } } }));
    const cfg = loadConfig(configPath, true);
    assert.deepEqual(cfg.trivia?.answersFormat, { boolean: 0, choice: 5, freeform: 0 });
  });

  it("parses boolean-only", () => {
    writeConfig(minimalConfig({ trivia: { answersFormat: { boolean: 1 } } }));
    const cfg = loadConfig(configPath, true);
    assert.deepEqual(cfg.trivia?.answersFormat, { boolean: 1, choice: 0, freeform: 0 });
  });

  it("rejects all-zero weights", () => {
    writeConfig(minimalConfig({ trivia: { answersFormat: { boolean: 0, choice: 0 } } }));
    assert.throws(() => loadConfig(configPath, true), /at least one strictly positive weight/);
  });

  it("rejects unknown keys", () => {
    writeConfig(minimalConfig({ trivia: { answersFormat: { boolean: 1, essay: 1 } } }));
    assert.throws(() => loadConfig(configPath, true), /unknown key 'essay'/);
  });

  it("rejects negative weights", () => {
    writeConfig(minimalConfig({ trivia: { answersFormat: { boolean: -1, choice: 1 } } }));
    assert.throws(() => loadConfig(configPath, true), /non-negative integer/);
  });

  it("rejects non-integer weights", () => {
    writeConfig(minimalConfig({ trivia: { answersFormat: { boolean: 1.5, choice: 1 } } }));
    assert.throws(() => loadConfig(configPath, true), /non-negative integer/);
  });

  it("rejects non-object value", () => {
    writeConfig(minimalConfig({ trivia: { answersFormat: "boolean" } }));
    assert.throws(() => loadConfig(configPath, true), /must be an object/);
  });
});

describe("trivia.choices config", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(tmpBase, { recursive: true });
    process.chdir(tmpBase);
    writeSlackAuth();
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("absent when not configured", () => {
    writeConfig(minimalConfig({ trivia: {} }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.choices, undefined);
  });

  it("parses valid bounds", () => {
    writeConfig(minimalConfig({ trivia: { choices: { min: 3, max: 4 } } }));
    const cfg = loadConfig(configPath, true);
    assert.deepEqual(cfg.trivia?.choices, { min: 3, max: 4 });
  });

  it("fills in defaults for partial bounds", () => {
    writeConfig(minimalConfig({ trivia: { choices: { min: 3 } } }));
    const cfg = loadConfig(configPath, true);
    assert.deepEqual(cfg.trivia?.choices, { min: 3, max: 4 });
  });

  it("rejects min < 2", () => {
    writeConfig(minimalConfig({ trivia: { choices: { min: 1, max: 4 } } }));
    assert.throws(() => loadConfig(configPath, true), /min.*\[2, 4\]/);
  });

  it("rejects max > 4", () => {
    writeConfig(minimalConfig({ trivia: { choices: { min: 2, max: 5 } } }));
    assert.throws(() => loadConfig(configPath, true), /max.*\[2, 4\]/);
  });

  it("rejects min > max", () => {
    writeConfig(minimalConfig({ trivia: { choices: { min: 4, max: 2 } } }));
    assert.throws(() => loadConfig(configPath, true), /min.*> max/);
  });

  it("rejects non-integer bounds", () => {
    writeConfig(minimalConfig({ trivia: { choices: { min: 2.5, max: 4 } } }));
    assert.throws(() => loadConfig(configPath, true), /must be an integer/);
  });

  it("rejects non-object value", () => {
    writeConfig(minimalConfig({ trivia: { choices: [2, 4] } }));
    assert.throws(() => loadConfig(configPath, true), /must be an object/);
  });
});

describe("trivia.games config", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(tmpBase, { recursive: true });
    process.chdir(tmpBase);
    writeSlackAuth();
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("absent when not configured", () => {
    writeConfig(minimalConfig({ trivia: {} }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games, undefined);
  });

  it("empty array is preserved as empty array", () => {
    writeConfig(minimalConfig({ trivia: { games: [] } }));
    const cfg = loadConfig(configPath, true);
    assert.deepEqual(cfg.trivia?.games, []);
  });

  it("parses a valid single-game entry", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "ops-daily",
              channel: "C123",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "America/Montreal",
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.length, 1);
    assert.deepEqual(cfg.trivia?.games?.[0], {
      name: "ops-daily",
      channel: "C123",
      questionCron: "0 9 * * 1-5",
      revealCron: "0 15 * * 1-5",
      timezone: "America/Montreal",
      enabled: true,
    });
  });

  it("drops entries with invalid cron expressions", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "good",
              channel: "C1",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "UTC",
            },
            {
              name: "bad",
              channel: "C2",
              questionCron: "not a cron",
              revealCron: "0 15 * * *",
              timezone: "UTC",
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.length, 1);
    assert.equal(cfg.trivia?.games?.[0]?.name, "good");
  });

  it("drops entries with malformed channel", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "bad-channel",
              channel: "#general", // not a channel ID
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "UTC",
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.length, 0);
  });

  it("drops duplicate names but keeps the first", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "dup",
              channel: "C1",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "UTC",
            },
            {
              name: "dup",
              channel: "C2",
              questionCron: "0 10 * * 1-5",
              revealCron: "0 16 * * 1-5",
              timezone: "UTC",
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.length, 1);
    assert.equal(cfg.trivia?.games?.[0]?.channel, "C1");
  });

  it("drops entries with empty name", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "",
              channel: "C1",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "UTC",
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.length, 0);
  });

  it("drops entries with empty timezone", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "no-tz",
              channel: "C1",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "",
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.length, 0);
  });

  it("drops entries whose name has uppercase letters", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "Main",
              channel: "C1",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "UTC",
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.length, 0);
  });

  it("drops entries whose name has whitespace", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "has spaces",
              channel: "C1",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "UTC",
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.length, 0);
  });

  it("drops entries whose name has path-traversal characters", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "../etc",
              channel: "C1",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "UTC",
            },
            {
              name: "a/b",
              channel: "C2",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "UTC",
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.length, 0);
  });

  it("drops entries whose name exceeds 32 characters", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "a".repeat(33),
              channel: "C1",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "UTC",
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.length, 0);
  });

  it("accepts a 32-character name", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "a".repeat(32),
              channel: "C1",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "UTC",
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.length, 1);
  });

  it("defaults enabled to true when absent", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "default-enabled",
              channel: "C1",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "UTC",
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.[0]?.enabled, true);
  });

  it("respects an explicit enabled: false", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "retired",
              channel: "C1",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "UTC",
              enabled: false,
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.[0]?.enabled, false);
  });

  it("drops entries where enabled is non-boolean", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          games: [
            {
              name: "bad-enabled",
              channel: "C1",
              questionCron: "0 9 * * 1-5",
              revealCron: "0 15 * * 1-5",
              timezone: "UTC",
              enabled: "true", // string, not boolean
            },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.games?.length, 0);
  });
});

describe("trivia.offDays config", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(tmpBase, { recursive: true });
    process.chdir(tmpBase);
    writeSlackAuth();
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("absent when not configured", () => {
    writeConfig(minimalConfig({ trivia: {} }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.offDays, undefined);
  });

  it("empty array is preserved as empty array", () => {
    writeConfig(minimalConfig({ trivia: { offDays: [] } }));
    const cfg = loadConfig(configPath, true);
    assert.deepEqual(cfg.trivia?.offDays, []);
  });

  it("parses mixed YYYY-MM-DD and MM-DD entries", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          offDays: [
            { date: "12-25", label: "Christmas" },
            { date: "2026-04-03", label: "Good Friday 2026" },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.offDays?.length, 2);
    assert.deepEqual(cfg.trivia?.offDays?.[0], { date: "12-25", label: "Christmas" });
    assert.deepEqual(cfg.trivia?.offDays?.[1], { date: "2026-04-03", label: "Good Friday 2026" });
  });

  it("drops entries with unparseable date format", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          offDays: [
            { date: "December 25", label: "Christmas" },
            { date: "12-25", label: "Christmas (good)" },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.offDays?.length, 1);
    assert.equal(cfg.trivia?.offDays?.[0]?.label, "Christmas (good)");
  });

  it("drops entries with invalid calendar dates (recurring)", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          offDays: [
            { date: "02-30", label: "Imaginary" },
            { date: "13-01", label: "Bad month" },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.offDays?.length, 0);
  });

  it("drops entries with invalid calendar dates (exact)", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          offDays: [
            { date: "2025-02-29", label: "Not a leap year" },
            { date: "2026-13-01", label: "Bad month" },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.offDays?.length, 0);
  });

  it("accepts Feb 29 in recurring MM-DD form (leap-year semantics)", () => {
    writeConfig(
      minimalConfig({
        trivia: { offDays: [{ date: "02-29", label: "Leap day" }] },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.offDays?.length, 1);
  });

  it("drops entries with missing or empty label", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          offDays: [
            { date: "12-25" }, // no label
            { date: "01-01", label: "" }, // empty label
            { date: "07-01", label: "Canada Day" }, // good
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.offDays?.length, 1);
    assert.equal(cfg.trivia?.offDays?.[0]?.label, "Canada Day");
  });

  it("drops non-object entries", () => {
    writeConfig(
      minimalConfig({
        trivia: {
          offDays: [
            "12-25", // string, not object
            { date: "12-25", label: "Christmas" },
          ],
        },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.trivia?.offDays?.length, 1);
  });

  it("ignoring a non-array offDays value coerces to empty array", () => {
    writeConfig(
      minimalConfig({
        trivia: { offDays: "12-25" },
      }),
    );
    const cfg = loadConfig(configPath, true);
    assert.deepEqual(cfg.trivia?.offDays, []);
  });
});

describe("language config", () => {
  beforeEach(() => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(tmpBase, { recursive: true });
    process.chdir(tmpBase);
    writeSlackAuth();
  });

  afterEach(() => {
    process.chdir(resolve(tmpBase, ".."));
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  it("is undefined when the field is absent", () => {
    writeConfig(minimalConfig());
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.language, undefined);
  });

  it("accepts 'en'", () => {
    writeConfig(minimalConfig({ language: "en" }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.language, "en");
  });

  it("accepts 'fr'", () => {
    writeConfig(minimalConfig({ language: "fr" }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.language, "fr");
  });

  it("rejects an unsupported language code with a descriptive error", () => {
    writeConfig(minimalConfig({ language: "de" }));
    assert.throws(
      () => loadConfig(configPath, true),
      (err: unknown) =>
        err instanceof Error &&
        err.message.includes("language") &&
        err.message.includes("en") &&
        err.message.includes("fr"),
    );
  });

  it("rejects a non-string language with a descriptive error", () => {
    writeConfig(minimalConfig({ language: 42 }));
    assert.throws(
      () => loadConfig(configPath, true),
      (err: unknown) => err instanceof Error && err.message.includes("language"),
    );
  });
});

describe("submitResponse config", () => {
  beforeEach(() => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(tmpBase, { recursive: true });
    process.chdir(tmpBase);
    writeSlackAuth();
  });

  afterEach(() => {
    process.chdir(resolve(tmpBase, ".."));
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
  });

  it("defaults maxAdditionalMessages to 5 when the section is absent", () => {
    writeConfig(minimalConfig());
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.submitResponse?.maxAdditionalMessages, DEFAULT_MAX_ADDITIONAL_MESSAGES);
    assert.equal(DEFAULT_MAX_ADDITIONAL_MESSAGES, 5);
  });

  it("defaults maxAdditionalMessages to 5 when the section is empty", () => {
    writeConfig(minimalConfig({ submitResponse: {} }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.submitResponse?.maxAdditionalMessages, DEFAULT_MAX_ADDITIONAL_MESSAGES);
  });

  it("accepts a valid in-range integer (3)", () => {
    writeConfig(minimalConfig({ submitResponse: { maxAdditionalMessages: 3 } }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.submitResponse?.maxAdditionalMessages, 3);
  });

  it("accepts the boundary value 1", () => {
    writeConfig(minimalConfig({ submitResponse: { maxAdditionalMessages: 1 } }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.submitResponse?.maxAdditionalMessages, 1);
  });

  it("accepts the boundary value 10", () => {
    writeConfig(minimalConfig({ submitResponse: { maxAdditionalMessages: 10 } }));
    const cfg = loadConfig(configPath, true);
    assert.equal(cfg.submitResponse?.maxAdditionalMessages, 10);
  });

  it("rejects 0 (below range)", () => {
    writeConfig(minimalConfig({ submitResponse: { maxAdditionalMessages: 0 } }));
    assert.throws(
      () => loadConfig(configPath, true),
      (err: unknown) =>
        err instanceof Error && err.message.includes("submitResponse.maxAdditionalMessages"),
    );
  });

  it("rejects 11 (above range)", () => {
    writeConfig(minimalConfig({ submitResponse: { maxAdditionalMessages: 11 } }));
    assert.throws(
      () => loadConfig(configPath, true),
      (err: unknown) =>
        err instanceof Error && err.message.includes("submitResponse.maxAdditionalMessages"),
    );
  });

  it("rejects a non-integer (4.5)", () => {
    writeConfig(minimalConfig({ submitResponse: { maxAdditionalMessages: 4.5 } }));
    assert.throws(
      () => loadConfig(configPath, true),
      (err: unknown) => err instanceof Error && err.message.includes("integer"),
    );
  });

  it("rejects a string value", () => {
    writeConfig(minimalConfig({ submitResponse: { maxAdditionalMessages: "five" } }));
    assert.throws(
      () => loadConfig(configPath, true),
      (err: unknown) => err instanceof Error && err.message.includes("integer"),
    );
  });

  it("rejects a non-object submitResponse section", () => {
    writeConfig(minimalConfig({ submitResponse: "nope" }));
    assert.throws(
      () => loadConfig(configPath, true),
      (err: unknown) => err instanceof Error && err.message.includes("submitResponse"),
    );
  });
});
