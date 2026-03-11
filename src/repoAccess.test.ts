import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roleLevel, canReadRepo, canWriteRepo, getVisibleRepos, getWritableRepos } from "./repoAccess.js";
import type { RepositoryConfig } from "./config.js";

function makeRepo(overrides: Partial<RepositoryConfig> = {}): RepositoryConfig {
  return {
    name: "test-repo",
    url: "https://github.com/org/test-repo",
    description: "A test repo",
    branch: "main",
    ...overrides,
  };
}

describe("roleLevel", () => {
  it("returns ascending levels for member < dev < admin < owner", () => {
    assert.ok(roleLevel("member") < roleLevel("dev"));
    assert.ok(roleLevel("dev") < roleLevel("admin"));
    assert.ok(roleLevel("admin") < roleLevel("owner"));
  });
});

describe("canReadRepo", () => {
  it("allows any role when no access config is set", () => {
    const repo = makeRepo();
    assert.equal(canReadRepo("member", repo), true);
  });

  it("allows member when read is explicitly member", () => {
    const repo = makeRepo({ access: { read: "member" } });
    assert.equal(canReadRepo("member", repo), true);
  });

  it("blocks member when read requires dev", () => {
    const repo = makeRepo({ access: { read: "dev" } });
    assert.equal(canReadRepo("member", repo), false);
    assert.equal(canReadRepo("dev", repo), true);
    assert.equal(canReadRepo("admin", repo), true);
  });
});

describe("canWriteRepo", () => {
  it("denies write when no write access is configured", () => {
    const repo = makeRepo();
    assert.equal(canWriteRepo("owner", repo), false);
  });

  it("denies write when no access config at all", () => {
    const repo = makeRepo({ access: undefined });
    assert.equal(canWriteRepo("admin", repo), false);
  });

  it("allows write when role meets threshold", () => {
    const repo = makeRepo({ access: { read: "member", write: "dev" } });
    assert.equal(canWriteRepo("member", repo), false);
    assert.equal(canWriteRepo("dev", repo), true);
    assert.equal(canWriteRepo("admin", repo), true);
    assert.equal(canWriteRepo("owner", repo), true);
  });

  it("restricts write to admin+", () => {
    const repo = makeRepo({ access: { read: "member", write: "admin" } });
    assert.equal(canWriteRepo("dev", repo), false);
    assert.equal(canWriteRepo("admin", repo), true);
  });
});

describe("getVisibleRepos / getWritableRepos", () => {
  const repos: RepositoryConfig[] = [
    makeRepo({ name: "public", access: { read: "member" } }),
    makeRepo({ name: "dev-only", access: { read: "dev" } }),
    makeRepo({ name: "writable", access: { read: "member", write: "dev" } }),
  ];

  it("member sees only public repos", () => {
    const visible = getVisibleRepos("member", repos);
    assert.deepEqual(visible.map((r) => r.name), ["public", "writable"]);
  });

  it("dev sees all repos", () => {
    const visible = getVisibleRepos("dev", repos);
    assert.equal(visible.length, 3);
  });

  it("member has no writable repos", () => {
    assert.equal(getWritableRepos("member", repos).length, 0);
  });

  it("dev can write to writable repo", () => {
    const writable = getWritableRepos("dev", repos);
    assert.deepEqual(writable.map((r) => r.name), ["writable"]);
  });
});
