import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import {
  loadRegistry,
  getUserRecord,
  listUserIdentities,
  getUserNamespace,
  upsertIdentity,
  mergeUserNamespace,
  mergeUserGithub,
  setUserDisplayName,
  clearRegistryCache,
  setUserRegistryDeps,
  resetUserRegistryDeps,
  type UserRecord,
} from "./userRegistry.js";

// In-memory backing store so tests never touch real disk.
let store: Map<string, string>;

function installStore(seed?: Record<string, string>): void {
  store = new Map(Object.entries(seed ?? {}));
  setUserRegistryDeps({
    readFile: async (path) => {
      const value = store.get(path);
      if (value === undefined) throw new Error("ENOENT");
      return value;
    },
    writeFile: async (path, data) => {
      store.set(path, data);
    },
    mkdir: async () => undefined,
    fileExists: async (path) => store.has(path),
  });
  clearRegistryCache();
}

function persistedRegistry(): Record<string, UserRecord> {
  const entry = [...store.entries()].find(([path]) => path.endsWith("users.json"));
  const parsed: Record<string, UserRecord> = entry ? JSON.parse(entry[1]) : {};
  return parsed;
}

beforeEach(() => installStore());
afterEach(() => {
  resetUserRegistryDeps();
  clearRegistryCache();
});

describe("userRegistry — identity", () => {
  it("upserts and reads back an identity, surviving a cache clear", async () => {
    await upsertIdentity("U1", "Alice", 1000);
    clearRegistryCache();
    const record = await getUserRecord("U1");
    assert.equal(record?.displayName, "Alice");
    assert.equal(record?.lastFetched, 1000);
  });

  it("listUserIdentities returns only core identity, never lastFetched or namespaces", async () => {
    await upsertIdentity("U1", "Alice", 1000);
    await mergeUserNamespace("trivia", "U1", { joinedAt: 5 });
    const list = await listUserIdentities();
    assert.deepEqual(list, [{ userId: "U1", displayName: "Alice" }]);
  });

  it("upsert preserves existing plugin namespaces", async () => {
    await mergeUserNamespace("trivia", "U1", { joinedAt: 5 });
    await upsertIdentity("U1", "Alice", 2000);
    const ns = await getUserNamespace("trivia", "U1");
    assert.deepEqual(ns, { joinedAt: 5 });
  });
});

describe("userRegistry — namespaces", () => {
  it("merges field-wise and isolates plugins from each other", async () => {
    await mergeUserNamespace("trivia", "U1", { joinedAt: 5 });
    await mergeUserNamespace("trivia", "U1", { cheatAttempts: 2 });
    await mergeUserNamespace("casual", "U1", { streak: 3 });
    assert.deepEqual(await getUserNamespace("trivia", "U1"), { joinedAt: 5, cheatAttempts: 2 });
    assert.deepEqual(await getUserNamespace("casual", "U1"), { streak: 3 });
  });

  it("creates a placeholder record when the user is unknown", async () => {
    await mergeUserNamespace("trivia", "UX", { joinedAt: 9 });
    const record = await getUserRecord("UX");
    assert.equal(record?.displayName, "");
    assert.equal(record?.lastFetched, 0);
    assert.deepEqual(record?.plugins?.trivia, { joinedAt: 9 });
  });

  it("getUserNamespace returns null for an absent namespace", async () => {
    await upsertIdentity("U1", "Alice", 0);
    assert.equal(await getUserNamespace("trivia", "U1"), null);
  });
});

describe("userRegistry — github", () => {
  it("sets github and preserves displayName, lastFetched, and plugins", async () => {
    await upsertIdentity("U1", "Alice", 1000);
    await mergeUserNamespace("trivia", "U1", { joinedAt: 5 });
    await mergeUserGithub("U1", { username: "alice-gh" });
    const record = await getUserRecord("U1");
    assert.deepEqual(record?.github, { username: "alice-gh" });
    assert.equal(record?.displayName, "Alice");
    assert.equal(record?.lastFetched, 1000);
    assert.deepEqual(record?.plugins?.trivia, { joinedAt: 5 });
  });

  it("clears github with null while preserving other fields", async () => {
    await upsertIdentity("U1", "Alice", 1000);
    await mergeUserGithub("U1", { username: "alice-gh" });
    await mergeUserGithub("U1", null);
    const record = await getUserRecord("U1");
    assert.equal(record?.github, undefined);
    assert.equal(record?.displayName, "Alice");
  });

  it("creates a placeholder record for an unknown user", async () => {
    await mergeUserGithub("UX", { username: "octo" });
    const record = await getUserRecord("UX");
    assert.deepEqual(record?.github, { username: "octo" });
    assert.equal(record?.displayName, "");
    assert.equal(record?.lastFetched, 0);
  });

  it("upsertIdentity (lazy Slack refresh) preserves github", async () => {
    await mergeUserGithub("U1", { username: "alice-gh" });
    await upsertIdentity("U1", "Alice Refreshed", 2000);
    const record = await getUserRecord("U1");
    assert.deepEqual(record?.github, { username: "alice-gh" });
    assert.equal(record?.displayName, "Alice Refreshed");
  });

  it("tolerates a malformed github field, dropping it but keeping the record", async () => {
    installStore({
      [`${process.cwd()}/data/state/users.json`]: JSON.stringify({
        U1: { userId: "U1", displayName: "Alice", lastFetched: 1, github: "not-an-object" },
      }),
    });
    const record = await getUserRecord("U1");
    assert.equal(record?.displayName, "Alice");
    assert.equal(record?.github, undefined);
  });

  it("setUserDisplayName overrides the name and preserves github", async () => {
    await mergeUserGithub("U1", { username: "alice-gh" });
    await setUserDisplayName("U1", "Manual Name");
    const record = await getUserRecord("U1");
    assert.equal(record?.displayName, "Manual Name");
    assert.deepEqual(record?.github, { username: "alice-gh" });
  });

  it("serializes concurrent github writes for the same user", async () => {
    await Promise.all([
      mergeUserGithub("U1", { username: "first" }),
      setUserDisplayName("U1", "Name"),
    ]);
    const record = persistedRegistry().U1;
    assert.deepEqual(record?.github, { username: "first" });
    assert.equal(record?.displayName, "Name");
  });
});

describe("userRegistry — resilience & concurrency", () => {
  it("treats a malformed file as empty without throwing", async () => {
    installStore({ [`${process.cwd()}/data/state/users.json`]: "{ not json" });
    const map = await loadRegistry();
    assert.deepEqual(map, {});
  });

  it("serializes concurrent merges so neither namespace is lost", async () => {
    await Promise.all([
      mergeUserNamespace("a", "U1", { x: 1 }),
      mergeUserNamespace("b", "U1", { y: 2 }),
    ]);
    const record = persistedRegistry().U1;
    assert.deepEqual(record?.plugins?.a, { x: 1 });
    assert.deepEqual(record?.plugins?.b, { y: 2 });
  });
});
