import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  isChangesEnabledForTrigger,
  findChangeEnabledRepo,
  getChangeEnabledRepos,
} from "./detection.js";
import { findRepoByName } from "../config.js";
import type { Config, RepositoryConfig } from "../config.js";

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    repositories: [],
    reactions: { trigger: "eyes" },
    directMessages: { enabled: true },
    mentions: { enabled: true },
    ...overrides,
  } as Config;
}

function makeRepo(overrides: Partial<RepositoryConfig> = {}): RepositoryConfig {
  return {
    name: "test-repo",
    url: "https://github.com/org/test-repo",
    description: "A test repo",
    branch: "main",
    ...overrides,
  };
}

describe("isChangesEnabledForTrigger", () => {
  it("returns false when global changesWorkflow is not enabled", () => {
    const config = makeConfig();
    assert.equal(isChangesEnabledForTrigger("reactions", config), false);
  });

  it("returns false when global is enabled but trigger is not", () => {
    const config = makeConfig({
      changesWorkflow: { enabled: true },
      reactions: { trigger: "eyes" },
    });
    assert.equal(isChangesEnabledForTrigger("reactions", config), false);
  });

  it("returns true when both global and trigger are enabled", () => {
    const config = makeConfig({
      changesWorkflow: { enabled: true },
      reactions: { trigger: "eyes", changesWorkflow: { enabled: true } },
    });
    assert.equal(isChangesEnabledForTrigger("reactions", config), true);
  });

  it("works independently for each trigger type", () => {
    const config = makeConfig({
      changesWorkflow: { enabled: true },
      reactions: { trigger: "eyes", changesWorkflow: { enabled: true } },
      directMessages: { enabled: true },
      mentions: { enabled: true },
    });
    assert.equal(isChangesEnabledForTrigger("reactions", config), true);
    assert.equal(isChangesEnabledForTrigger("directMessages", config), false);
    assert.equal(isChangesEnabledForTrigger("mentions", config), false);
  });
});

describe("findChangeEnabledRepo", () => {
  it("returns null when no repos are writable", () => {
    const config = makeConfig({
      repositories: [makeRepo({ access: { read: "member" } })],
    });
    assert.equal(findChangeEnabledRepo(config), null);
  });

  it("returns the single writable repo", () => {
    const config = makeConfig({
      repositories: [makeRepo({ name: "my-repo", access: { read: "member", write: "dev" } })],
    });
    const repo = findChangeEnabledRepo(config, "dev");
    assert.equal(repo?.name, "my-repo");
  });

  it("returns null when multiple repos are writable", () => {
    const config = makeConfig({
      repositories: [
        makeRepo({ name: "repo-a", access: { read: "member", write: "dev" } }),
        makeRepo({ name: "repo-b", access: { read: "member", write: "dev" } }),
      ],
    });
    assert.equal(findChangeEnabledRepo(config, "dev"), null);
  });
});

describe("getChangeEnabledRepos", () => {
  it("returns empty array when no repos are writable", () => {
    const config = makeConfig({
      repositories: [makeRepo({ access: { read: "member" } })],
    });
    assert.deepEqual(getChangeEnabledRepos(config), []);
  });

  it("returns name and description of writable repos", () => {
    const config = makeConfig({
      repositories: [
        makeRepo({
          name: "repo-a",
          description: "First repo",
          access: { read: "member", write: "dev" },
        }),
        makeRepo({ name: "repo-b", description: "Second repo", access: { read: "member" } }),
      ],
    });
    const repos = getChangeEnabledRepos(config, "dev");
    assert.equal(repos.length, 1);
    assert.deepEqual(repos[0], { name: "repo-a", description: "First repo" });
  });

  it("defaults to dev role", () => {
    const config = makeConfig({
      repositories: [
        makeRepo({ name: "admin-only", access: { read: "member", write: "admin" } }),
        makeRepo({ name: "dev-writable", access: { read: "member", write: "dev" } }),
      ],
    });
    // Default role is dev, so only dev-writable should be returned
    const repos = getChangeEnabledRepos(config);
    assert.equal(repos.length, 1);
    assert.equal(repos[0].name, "dev-writable");
  });

  it("returns all writable repos for owner role", () => {
    const config = makeConfig({
      repositories: [
        makeRepo({ name: "repo-a", description: "A", access: { read: "member", write: "admin" } }),
        makeRepo({ name: "repo-b", description: "B", access: { read: "member", write: "dev" } }),
      ],
    });
    const repos = getChangeEnabledRepos(config, "owner");
    assert.equal(repos.length, 2);
  });
});

describe("findRepoByName", () => {
  const config = makeConfig({
    repositories: [makeRepo({ name: "My-Repo" }), makeRepo({ name: "other-repo" })],
  });

  it("finds repo by exact name", () => {
    assert.equal(findRepoByName("My-Repo", config)?.name, "My-Repo");
  });

  it("finds repo case-insensitively", () => {
    assert.equal(findRepoByName("my-repo", config)?.name, "My-Repo");
    assert.equal(findRepoByName("MY-REPO", config)?.name, "My-Repo");
  });

  it("returns undefined for non-existent repo", () => {
    assert.equal(findRepoByName("no-such-repo", config), undefined);
  });
});
