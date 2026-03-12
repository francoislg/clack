import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { roleLevel, canReadRepo, canWriteRepo, getVisibleRepos, getWritableRepos } from "./repoAccess.js";
import type { RepositoryConfig } from "./config.js";
import type { UserRole } from "./roles.js";

const ALL_ROLES: UserRole[] = ["member", "dev", "admin", "owner"];

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

  it("returns a consistent value for each role", () => {
    for (const role of ALL_ROLES) {
      assert.equal(roleLevel(role), roleLevel(role));
    }
  });

  it("returns distinct values for each role", () => {
    const levels = ALL_ROLES.map(roleLevel);
    assert.equal(new Set(levels).size, ALL_ROLES.length);
  });
});

describe("canReadRepo", () => {
  it("allows any role when no access config is set", () => {
    const repo = makeRepo();
    for (const role of ALL_ROLES) {
      assert.equal(canReadRepo(role, repo), true);
    }
  });

  it("allows any role when access object exists but read is undefined", () => {
    const repo = makeRepo({ access: {} });
    for (const role of ALL_ROLES) {
      assert.equal(canReadRepo(role, repo), true);
    }
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
    assert.equal(canReadRepo("owner", repo), true);
  });

  it("blocks member and dev when read requires admin", () => {
    const repo = makeRepo({ access: { read: "admin" } });
    assert.equal(canReadRepo("member", repo), false);
    assert.equal(canReadRepo("dev", repo), false);
    assert.equal(canReadRepo("admin", repo), true);
    assert.equal(canReadRepo("owner", repo), true);
  });

  it("blocks everyone except owner when read requires owner", () => {
    const repo = makeRepo({ access: { read: "owner" } });
    assert.equal(canReadRepo("member", repo), false);
    assert.equal(canReadRepo("dev", repo), false);
    assert.equal(canReadRepo("admin", repo), false);
    assert.equal(canReadRepo("owner", repo), true);
  });

  it("ignores write config when checking read access", () => {
    const repo = makeRepo({ access: { write: "owner" } });
    // read defaults to member when undefined, so everyone can read
    assert.equal(canReadRepo("member", repo), true);
  });
});

describe("canWriteRepo", () => {
  it("denies write when no access config at all", () => {
    const repo = makeRepo();
    for (const role of ALL_ROLES) {
      assert.equal(canWriteRepo(role, repo), false);
    }
  });

  it("denies write when access is explicitly undefined", () => {
    const repo = makeRepo({ access: undefined });
    for (const role of ALL_ROLES) {
      assert.equal(canWriteRepo(role, repo), false);
    }
  });

  it("denies write when access object exists but write is undefined", () => {
    const repo = makeRepo({ access: { read: "member" } });
    for (const role of ALL_ROLES) {
      assert.equal(canWriteRepo(role, repo), false);
    }
  });

  it("denies write when access is empty object", () => {
    const repo = makeRepo({ access: {} });
    for (const role of ALL_ROLES) {
      assert.equal(canWriteRepo(role, repo), false);
    }
  });

  it("allows write when role meets dev threshold", () => {
    const repo = makeRepo({ access: { read: "member", write: "dev" } });
    assert.equal(canWriteRepo("member", repo), false);
    assert.equal(canWriteRepo("dev", repo), true);
    assert.equal(canWriteRepo("admin", repo), true);
    assert.equal(canWriteRepo("owner", repo), true);
  });

  it("restricts write to admin+", () => {
    const repo = makeRepo({ access: { read: "member", write: "admin" } });
    assert.equal(canWriteRepo("member", repo), false);
    assert.equal(canWriteRepo("dev", repo), false);
    assert.equal(canWriteRepo("admin", repo), true);
    assert.equal(canWriteRepo("owner", repo), true);
  });

  it("restricts write to owner only", () => {
    const repo = makeRepo({ access: { read: "member", write: "owner" } });
    assert.equal(canWriteRepo("member", repo), false);
    assert.equal(canWriteRepo("dev", repo), false);
    assert.equal(canWriteRepo("admin", repo), false);
    assert.equal(canWriteRepo("owner", repo), true);
  });

  it("allows all roles when write threshold is member", () => {
    const repo = makeRepo({ access: { read: "member", write: "member" } });
    for (const role of ALL_ROLES) {
      assert.equal(canWriteRepo(role, repo), true);
    }
  });
});

describe("getVisibleRepos", () => {
  it("returns empty array when no repos provided", () => {
    assert.deepEqual(getVisibleRepos("owner", []), []);
  });

  it("filters repos based on read access", () => {
    const repos: RepositoryConfig[] = [
      makeRepo({ name: "public", access: { read: "member" } }),
      makeRepo({ name: "dev-only", access: { read: "dev" } }),
      makeRepo({ name: "admin-only", access: { read: "admin" } }),
      makeRepo({ name: "owner-only", access: { read: "owner" } }),
    ];

    assert.deepEqual(
      getVisibleRepos("member", repos).map((r) => r.name),
      ["public"],
    );
    assert.deepEqual(
      getVisibleRepos("dev", repos).map((r) => r.name),
      ["public", "dev-only"],
    );
    assert.deepEqual(
      getVisibleRepos("admin", repos).map((r) => r.name),
      ["public", "dev-only", "admin-only"],
    );
    assert.deepEqual(
      getVisibleRepos("owner", repos).map((r) => r.name),
      ["public", "dev-only", "admin-only", "owner-only"],
    );
  });

  it("includes repos with no access config (defaults to member)", () => {
    const repos: RepositoryConfig[] = [
      makeRepo({ name: "no-access-config" }),
      makeRepo({ name: "empty-access", access: {} }),
    ];

    const visible = getVisibleRepos("member", repos);
    assert.equal(visible.length, 2);
  });

  it("preserves original repo objects", () => {
    const repo = makeRepo({ name: "test", description: "special" });
    const visible = getVisibleRepos("member", [repo]);
    assert.equal(visible[0], repo); // same reference
  });
});

describe("getWritableRepos", () => {
  it("returns empty array when no repos provided", () => {
    assert.deepEqual(getWritableRepos("owner", []), []);
  });

  it("returns empty array when no repos have write access configured", () => {
    const repos: RepositoryConfig[] = [
      makeRepo({ name: "read-only-1" }),
      makeRepo({ name: "read-only-2", access: { read: "member" } }),
    ];
    assert.equal(getWritableRepos("owner", repos).length, 0);
  });

  it("filters repos based on write access threshold", () => {
    const repos: RepositoryConfig[] = [
      makeRepo({ name: "dev-writable", access: { read: "member", write: "dev" } }),
      makeRepo({ name: "admin-writable", access: { read: "member", write: "admin" } }),
      makeRepo({ name: "read-only", access: { read: "member" } }),
    ];

    assert.deepEqual(
      getWritableRepos("member", repos).map((r) => r.name),
      [],
    );
    assert.deepEqual(
      getWritableRepos("dev", repos).map((r) => r.name),
      ["dev-writable"],
    );
    assert.deepEqual(
      getWritableRepos("admin", repos).map((r) => r.name),
      ["dev-writable", "admin-writable"],
    );
    assert.deepEqual(
      getWritableRepos("owner", repos).map((r) => r.name),
      ["dev-writable", "admin-writable"],
    );
  });

  it("preserves original repo objects", () => {
    const repo = makeRepo({ name: "test", access: { write: "member" } });
    const writable = getWritableRepos("member", [repo]);
    assert.equal(writable[0], repo); // same reference
  });
});
