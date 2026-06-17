import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setMemoryRegistryDeps,
  resetMemoryRegistryDeps,
  clearMemoryCache,
  clearBeforeExpireHooks,
  registerBeforeExpire,
  loadArchiveStore,
  rememberCore,
  mergeMemoryNamespace,
  getMemory,
  getArchived,
  archive,
  pruneArchive,
  searchMemory,
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

const ARCHIVE_PATH = `${process.cwd()}/data/state/memory-archive.json`;

let currentNow = new Date("2026-06-16T12:00:00.000Z");

beforeEach(() => {
  clearMemoryCache();
  clearBeforeExpireHooks();
  currentNow = new Date("2026-06-16T12:00:00.000Z");
  const { deps } = inMemoryDeps(() => currentNow);
  setMemoryRegistryDeps(deps);
});

afterEach(() => {
  resetMemoryRegistryDeps();
  clearMemoryCache();
  clearBeforeExpireHooks();
});

describe("archive persistence", () => {
  it("returns the empty store when no archive file exists", async () => {
    expect(await loadArchiveStore()).toEqual({});
  });

  it("returns the empty store on malformed archive JSON rather than throwing", async () => {
    const { deps, files } = inMemoryDeps(() => currentNow);
    files.set(ARCHIVE_PATH, "{ not json");
    clearMemoryCache();
    setMemoryRegistryDeps(deps);
    expect(await loadArchiveStore()).toEqual({});
  });
});

describe("getArchived", () => {
  it("returns null for any id when the archive file does not yet exist", async () => {
    expect(await getArchived("anything:1")).toBeNull();
  });

  it("returns null for an id that was never archived", async () => {
    expect(await getArchived("sentry:9999")).toBeNull();
  });

  it("returns the lean record after archiving", async () => {
    await rememberCore({ id: "sentry:1234", what: "Login crash" });
    await archive("sentry:1234", { summary: "Login crash", outcome: "Fixed in PR #123" });

    const record = await getArchived("sentry:1234");
    expect(record).toMatchObject({
      id: "sentry:1234",
      summary: "Login crash",
      outcome: "Fixed in PR #123",
      archivedAt: "2026-06-16T12:00:00.000Z",
    });
    expect(record?.link).toBeUndefined();
  });
});

describe("archive", () => {
  it("writes the lean record and removes the active entry", async () => {
    await rememberCore({ id: "sentry:1234", what: "Login crash", why: "users blocked" });

    const result = await archive("sentry:1234", {
      summary: "Login crash",
      outcome: "Fixed in PR #123, merged 2026-06-10",
      link: "https://github.com/o/r/pull/123",
    });

    expect(result).toEqual({ archived: true });
    expect(await getMemory("sentry:1234")).toBeNull();
    expect(await getArchived("sentry:1234")).toMatchObject({
      outcome: "Fixed in PR #123, merged 2026-06-10",
      link: "https://github.com/o/r/pull/123",
    });
  });

  it("removes every plugin namespace slice along with the active entry", async () => {
    await rememberCore({ id: "sentry:1234", what: "Login crash" });
    await mergeMemoryNamespace("idler", "sentry:1234", { priority: 350 });

    await archive("sentry:1234", { summary: "Login crash", outcome: "Fixed" });

    expect(await getMemory("sentry:1234")).toBeNull();
  });

  it("returns archived:false for an id with no active entry and writes nothing", async () => {
    const result = await archive("sentry:9999", { summary: "x", outcome: "y" });
    expect(result).toEqual({ archived: false });
    expect(await getArchived("sentry:9999")).toBeNull();
  });

  it("archives an entry with no plugin slices (the veto-hook loop is skipped)", async () => {
    await rememberCore({ id: "sentry:1234", what: "Login crash" });
    // A hook is registered, but the entry has no plugins.idler slice, so it is never consulted.
    registerBeforeExpire("idler", () => ({ vetoed: true }));

    const result = await archive("sentry:1234", { summary: "Login crash", outcome: "Fixed" });

    expect(result).toEqual({ archived: true });
    expect(await getMemory("sentry:1234")).toBeNull();
    expect(await getArchived("sentry:1234")).not.toBeNull();
  });

  it("applies extendUntil from a vetoing hook, retaining the entry with the extended date", async () => {
    await rememberCore({ id: "sentry:1234", what: "Login crash" });
    await mergeMemoryNamespace("idler", "sentry:1234", { priority: 1 });
    registerBeforeExpire("idler", () => ({
      vetoed: true,
      extendUntil: "2030-01-01T00:00:00.000Z",
    }));

    const result = await archive("sentry:1234", { summary: "Login crash", outcome: "Fixed" });

    expect(result).toEqual({ archived: false });
    expect((await getMemory("sentry:1234"))?.staleAfter?.date).toBe("2030-01-01T00:00:00.000Z");
    expect(await getArchived("sentry:1234")).toBeNull();
  });

  it("retains the active entry and writes no archive record when a plugin vetoes", async () => {
    await rememberCore({ id: "sentry:1234", what: "Login crash" });
    await mergeMemoryNamespace("idler", "sentry:1234", { priority: 1 });
    registerBeforeExpire("idler", () => ({ vetoed: true }));

    const result = await archive("sentry:1234", { summary: "Login crash", outcome: "Fixed" });

    expect(result).toEqual({ archived: false });
    expect(await getMemory("sentry:1234")).not.toBeNull();
    expect(await getArchived("sentry:1234")).toBeNull();
  });

  it("treats a throwing pre-expire hook as a veto (fail-safe)", async () => {
    await rememberCore({ id: "sentry:1234", what: "Login crash" });
    await mergeMemoryNamespace("idler", "sentry:1234", { priority: 1 });
    registerBeforeExpire("idler", () => {
      throw new Error("boom");
    });

    const result = await archive("sentry:1234", { summary: "Login crash", outcome: "Fixed" });

    expect(result).toEqual({ archived: false });
    expect(await getMemory("sentry:1234")).not.toBeNull();
  });
});

describe("pruneArchive", () => {
  it("drops records past the retention horizon and keeps recent ones", async () => {
    await rememberCore({ id: "old:1", what: "old" });
    await archive("old:1", { summary: "old", outcome: "done" });

    currentNow = new Date("2027-06-16T12:00:00.000Z"); // ~365 days later
    await rememberCore({ id: "recent:1", what: "recent" });
    await archive("recent:1", { summary: "recent", outcome: "done" });

    // A year + a day after the old record was archived.
    const pruned = await pruneArchive(new Date("2027-06-17T12:00:00.000Z"));

    expect(pruned).toEqual(["old:1"]);
    expect(await getArchived("old:1")).toBeNull();
    expect(await getArchived("recent:1")).not.toBeNull();
  });

  it("returns an empty list when nothing is past the horizon", async () => {
    await rememberCore({ id: "recent:1", what: "recent" });
    await archive("recent:1", { summary: "recent", outcome: "done" });

    expect(await pruneArchive()).toEqual([]);
    expect(await getArchived("recent:1")).not.toBeNull();
  });

  it("honors an overridden retentionDays", async () => {
    await rememberCore({ id: "a:1", what: "a" });
    await archive("a:1", { summary: "a", outcome: "done" });

    currentNow = new Date("2026-06-26T12:00:00.000Z"); // 10 days later
    const pruned = await pruneArchive(currentNow, 7);
    expect(pruned).toEqual(["a:1"]);
  });

  it("never prunes records with an empty archivedAt (age unknown)", async () => {
    const { deps, files } = inMemoryDeps(() => currentNow);
    files.set(
      ARCHIVE_PATH,
      JSON.stringify({ "old:1": { id: "old:1", summary: "s", outcome: "o", archivedAt: "" } }),
    );
    clearMemoryCache();
    setMemoryRegistryDeps(deps);

    const pruned = await pruneArchive(new Date("2099-01-01T00:00:00.000Z"));
    expect(pruned).toEqual([]);
    expect(await getArchived("old:1")).not.toBeNull();
  });
});

describe("archive isolation from recall", () => {
  it("removes an archived entry from the active keyword search surface", async () => {
    await rememberCore({ id: "sentry:1234", what: "Login crash on token refresh" });

    // Before archiving, recall finds it.
    expect((await searchMemory({ query: "login crash" })).total).toBe(1);

    await archive("sentry:1234", { summary: "Login crash", outcome: "Fixed" });

    // After archiving, the active store no longer has it — recall returns nothing.
    expect((await searchMemory({ query: "login crash" })).total).toBe(0);
    // But it is still retrievable by exact id from the archive.
    expect(await getArchived("sentry:1234")).not.toBeNull();
  });
});
