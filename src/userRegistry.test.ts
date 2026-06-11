import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import {
  loadRegistry,
  getUserRecord,
  listUserIdentities,
  getUserNamespace,
  upsertIdentity,
  mergeUserNamespace,
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
