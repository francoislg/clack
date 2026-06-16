import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setMemoryRegistryDeps,
  resetMemoryRegistryDeps,
  clearMemoryCache,
  clearBeforeExpireHooks,
  registerBeforeExpire,
  loadMemoryStore,
  getMemory,
  rememberCore,
  mergeMemoryNamespace,
  getMemoryNamespace,
  forgetMemory,
  pruneExpired,
  searchMemory,
  MemoryEntryNotFoundError,
  type MemoryRegistryDeps,
} from "./memoryRegistry.js";

/** In-memory file backing so the registry never touches disk and stays isolated per test. */
function inMemoryDeps(now: () => Date): { deps: MemoryRegistryDeps; files: Map<string, string> } {
  const files = new Map<string, string>();
  const deps: MemoryRegistryDeps = {
    async readFile(path) {
      const content = files.get(path);
      if (content === undefined) throw new Error("ENOENT");
      return content;
    },
    async writeFile(path, data) {
      files.set(path, data);
    },
    async mkdir() {
      return undefined;
    },
    async fileExists(path) {
      return files.has(path);
    },
    now,
  };
  return { deps, files };
}

let fixedNow = new Date("2026-06-16T12:00:00.000Z");

beforeEach(() => {
  clearMemoryCache();
  clearBeforeExpireHooks();
  const { deps } = inMemoryDeps(() => fixedNow);
  setMemoryRegistryDeps(deps);
});

afterEach(() => {
  resetMemoryRegistryDeps();
  clearMemoryCache();
  clearBeforeExpireHooks();
});

describe("memoryRegistry persistence", () => {
  it("returns the empty store when no file exists", async () => {
    expect(await loadMemoryStore()).toEqual({});
  });

  it("returns the empty store on malformed JSON rather than throwing", async () => {
    const { deps, files } = inMemoryDeps(() => fixedNow);
    files.set(`${process.cwd()}/data/state/memory.json`, "{ not json");
    clearMemoryCache();
    setMemoryRegistryDeps(deps);
    expect(await loadMemoryStore()).toEqual({});
  });

  it("remembers a core entry and reads it back, stamping timestamps", async () => {
    const entry = await rememberCore({ id: "note:a", what: "remember a", why: "because" });
    expect(entry.createdAt).toBe(fixedNow.toISOString());
    expect(entry.updatedAt).toBe(fixedNow.toISOString());
    const got = await getMemory("note:a");
    expect(got?.what).toBe("remember a");
  });

  it("preserves createdAt and plugin namespaces across a core update", async () => {
    await rememberCore({ id: "x", what: "v1" });
    await mergeMemoryNamespace("idler", "x", { priority: 5 });
    const created = (await getMemory("x"))?.createdAt;

    fixedNow = new Date("2026-06-17T12:00:00.000Z");
    await rememberCore({ id: "x", what: "v2" });
    const entry = await getMemory("x");
    expect(entry?.what).toBe("v2");
    expect(entry?.createdAt).toBe(created);
    expect(entry?.plugins?.idler).toEqual({ priority: 5 });
  });
});

describe("memoryRegistry namespace", () => {
  it("rejects a merge for an unknown id (core-first)", async () => {
    await expect(mergeMemoryNamespace("idler", "missing", { a: 1 })).rejects.toBeInstanceOf(
      MemoryEntryNotFoundError,
    );
  });

  it("field-merges the namespace slice", async () => {
    await rememberCore({ id: "x" });
    await mergeMemoryNamespace("idler", "x", { priority: 1, open: true });
    await mergeMemoryNamespace("idler", "x", { priority: 2 });
    expect(await getMemoryNamespace("idler", "x")).toEqual({ priority: 2, open: true });
  });

  it("serializes concurrent merges without losing updates", async () => {
    await rememberCore({ id: "x" });
    await Promise.all([
      mergeMemoryNamespace("idler", "x", { a: 1 }),
      mergeMemoryNamespace("trivia", "x", { b: 2 }),
    ]);
    const entry = await getMemory("x");
    expect(entry?.plugins?.idler).toEqual({ a: 1 });
    expect(entry?.plugins?.trivia).toEqual({ b: 2 });
  });
});

describe("memoryRegistry search", () => {
  beforeEach(async () => {
    fixedNow = new Date("2026-06-16T12:00:00.000Z");
    await rememberCore({ id: "note:login", what: "login crash on prod" });
    fixedNow = new Date("2026-06-16T13:00:00.000Z");
    await rememberCore({ id: "note:export", what: "export job slow" });
  });

  it("matches a keyword over core text and returns whole entries", async () => {
    const result = await searchMemory({ query: "login" });
    expect(result.total).toBe(1);
    expect(result.entries[0].id).toBe("note:login");
  });

  it("paginates and reports the full total", async () => {
    const result = await searchMemory({ limit: 1, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].id).toBe("note:export"); // newest updatedAt first
  });

  it("filters by updatedAt range", async () => {
    const result = await searchMemory({ from: "2026-06-16T12:30:00.000Z" });
    expect(result.total).toBe(1);
    expect(result.entries[0].id).toBe("note:export");
  });
});

describe("memoryRegistry expiry", () => {
  it("prunes an entry past its staleAfter.date", async () => {
    await rememberCore({ id: "old", staleAfter: { date: "2020-01-01T00:00:00.000Z" } });
    await rememberCore({ id: "fresh", staleAfter: { date: "2099-01-01T00:00:00.000Z" } });
    const deleted = await pruneExpired(fixedNow);
    expect(deleted).toEqual(["old"]);
    expect(await getMemory("old")).toBeNull();
    expect(await getMemory("fresh")).not.toBeNull();
  });

  it("never prunes an entry without a staleAfter.date", async () => {
    await rememberCore({ id: "permanent", staleAfter: { reason: "until X ships" } });
    expect(await pruneExpired(fixedNow)).toEqual([]);
    expect(await getMemory("permanent")).not.toBeNull();
  });

  it("consults the pre-expire hook only for entries carrying that plugin's slice", async () => {
    await rememberCore({ id: "with-slot", staleAfter: { date: "2020-01-01T00:00:00.000Z" } });
    await mergeMemoryNamespace("idler", "with-slot", { open: true });
    registerBeforeExpire("idler", () => ({ vetoed: true }));

    const deleted = await pruneExpired(fixedNow);
    expect(deleted).toEqual([]);
    expect(await getMemory("with-slot")).not.toBeNull();
  });

  it("treats a throwing hook as a veto (fail-safe)", async () => {
    await rememberCore({ id: "boom", staleAfter: { date: "2020-01-01T00:00:00.000Z" } });
    await mergeMemoryNamespace("idler", "boom", { open: true });
    registerBeforeExpire("idler", () => {
      throw new Error("hook bug");
    });
    const { deleted } = await forgetMemory("boom");
    expect(deleted).toBe(false);
    expect(await getMemory("boom")).not.toBeNull();
  });

  it("applies extendUntil from a hook and retains the entry", async () => {
    await rememberCore({ id: "extend", staleAfter: { date: "2020-01-01T00:00:00.000Z" } });
    await mergeMemoryNamespace("idler", "extend", { open: true });
    registerBeforeExpire("idler", () => ({
      vetoed: true,
      extendUntil: "2030-01-01T00:00:00.000Z",
    }));
    await forgetMemory("extend");
    const entry = await getMemory("extend");
    expect(entry?.staleAfter?.date).toBe("2030-01-01T00:00:00.000Z");
  });
});
