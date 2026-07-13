import { describe, it, beforeEach, afterEach, expect } from "vitest";
import { z } from "zod";

import { createArrayStore, createRecordStore, type ResilientStoreDeps } from "./resilientStore.js";
import {
  getQuarantineStore,
  clearQuarantineStores,
  setStateQuarantineSink,
} from "./stateQuarantineRegistry.js";
import { clearFreeze, type QuarantineReport } from "./resilientCollection.js";

const entryZod = z.object({ id: z.string(), n: z.number() });
type Entry = z.infer<typeof entryZod>;
const good = (id: string, n = 1): Entry => ({ id, n });

// In-memory fake fs so the factory never touches disk.
function makeFakeFs(seed: Record<string, string> = {}): {
  deps: ResilientStoreDeps;
  files: Map<string, string>;
} {
  const files = new Map(Object.entries(seed));
  return {
    files,
    deps: {
      readFile: async (path) => {
        const content = files.get(path);
        if (content === undefined) throw new Error("ENOENT");
        return content;
      },
      writeFile: async (path, data) => {
        files.set(path, data);
      },
      fileExists: async (path) => files.has(path),
      mkdir: async () => undefined,
    },
  };
}

const PATH = "/fake/store.json";
let reports: QuarantineReport[];

beforeEach(() => {
  reports = [];
  clearQuarantineStores();
  clearFreeze(PATH);
  setStateQuarantineSink((r) => reports.push(r));
});
afterEach(() => {
  clearQuarantineStores();
  clearFreeze(PATH);
  setStateQuarantineSink(null);
});

describe("createArrayStore", () => {
  it("loads valid entries, quarantines the bad one, and persists the move", async () => {
    const { deps, files } = makeFakeFs({
      [PATH]: JSON.stringify({ rules: [good("a"), { id: "bad" }, good("b")] }),
    });
    const store = createArrayStore<Entry>({
      storeId: "s1",
      label: "store one",
      getPath: () => PATH,
      collectionKey: "rules",
      entrySchema: entryZod,
      deps,
    });

    expect((await store.load()).map((e) => e.id)).toEqual(["a", "b"]);
    // The quarantine move was persisted so a later load carries it silently.
    const onDisk = JSON.parse(files.get(PATH)!);
    expect(onDisk.rules.map((r: Entry) => r.id)).toEqual(["a", "b"]);
    expect(onDisk.quarantined).toHaveLength(1);
    // Owner notified once with the source label.
    expect(reports.filter((r) => r.quarantined.length > 0)).toHaveLength(1);
    expect(reports[0].source).toBe("store one");
  });

  it("registry retry restores a repaired entry; remove drops it", async () => {
    const { deps } = makeFakeFs({
      [PATH]: JSON.stringify({ rules: [good("a")], quarantined: [good("fixed"), { id: "bad" }] }),
    });
    createArrayStore<Entry>({
      storeId: "s2",
      label: "store two",
      getPath: () => PATH,
      collectionKey: "rules",
      entrySchema: entryZod,
      deps,
    });
    const descriptor = getQuarantineStore("s2")!;

    const summaries = await descriptor.getSummaries();
    expect(summaries.map((s) => s.key).sort()).toEqual(["bad", "fixed"]);

    expect((await descriptor.retry("fixed")).ok).toBe(true);
    expect((await descriptor.retry("bad")).ok).toBe(false);
    expect(await descriptor.remove("bad")).toBe(true);
    expect(await descriptor.getSummaries()).toHaveLength(0);
  });
});

describe("createRecordStore", () => {
  it("quarantines a bad value under its key and reads the wrapped shape on save", async () => {
    const { deps, files } = makeFakeFs({
      [PATH]: JSON.stringify({ U1: good("a"), U2: { id: "bad" } }),
    });
    const store = createRecordStore<Entry>({
      storeId: "r1",
      label: "record store",
      getPath: () => PATH,
      entrySchema: entryZod,
      deps,
    });

    expect(Object.keys(await store.load())).toEqual(["U1"]);
    const onDisk = JSON.parse(files.get(PATH)!);
    expect(onDisk.entries).toEqual({ U1: good("a") });
    expect(onDisk.quarantined.U2).toEqual({ id: "bad" });
  });

  it("reads a legacy bare record and rewrites it wrapped", async () => {
    const { deps, files } = makeFakeFs({
      [PATH]: JSON.stringify({ U1: good("a"), U2: good("b") }),
    });
    const store = createRecordStore<Entry>({
      storeId: "r2",
      label: "record store 2",
      getPath: () => PATH,
      entrySchema: entryZod,
      deps,
    });

    expect(Object.keys(await store.load()).sort()).toEqual(["U1", "U2"]);
    await store.save({ U1: good("a"), U2: good("b"), U3: good("c") });
    const onDisk = JSON.parse(files.get(PATH)!);
    expect(Object.keys(onDisk.entries).sort()).toEqual(["U1", "U2", "U3"]);
    expect(onDisk).not.toHaveProperty("U1");
  });
});
