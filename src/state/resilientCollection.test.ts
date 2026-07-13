import { describe, it, beforeEach, afterEach, expect, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import {
  parseResilientCollection,
  serializeResilientCollection,
  loadResilientCollection,
  writeResilientCollection,
  retryQuarantinedEntry,
  deleteQuarantinedEntry,
  summarizeQuarantine,
  isFrozen,
  clearFreeze,
  type QuarantineReport,
} from "./resilientCollection.js";

const entryZod = z.object({ id: z.string(), n: z.number() });
type Entry = z.infer<typeof entryZod>;
const good = (id: string, n = 1) => ({ id, n });
const readUtf8 = (p: string): Promise<string> => readFile(p, "utf-8");

describe("parseResilientCollection", () => {
  it("array: keeps valid entries and quarantines the invalid one", () => {
    const result = parseResilientCollection(
      { rules: [good("a"), { id: "bad" }, good("b")] },
      { entrySchema: entryZod, kind: "array", collectionKey: "rules" },
    );
    expect(result).not.toBe("unusable");
    if (result === "unusable") return;
    expect((result.valid as Entry[]).map((e) => e.id)).toEqual(["a", "b"]);
    expect(result.newly).toHaveLength(1);
    expect(result.newly[0].key).toBe("bad");
    expect(result.newly[0].field).toBe("n");
  });

  it("array: carries a legacy quarantine key verbatim without re-notifying", () => {
    const result = parseResilientCollection(
      { jobs: [good("a")], quarantinedJobs: [{ id: "old" }] },
      {
        entrySchema: entryZod,
        kind: "array",
        collectionKey: "jobs",
        legacyQuarantineKey: "quarantinedJobs",
      },
    );
    if (result === "unusable") throw new Error("unexpected");
    expect(result.newly).toHaveLength(0);
    expect(result.quarantine).toHaveLength(1);
    expect(result.quarantine[0].raw).toEqual({ id: "old" });
  });

  it("record: quarantines the bad value under its key, keeps the rest", () => {
    const result = parseResilientCollection(
      { U1: good("a"), U2: { id: "bad" }, U3: good("c") },
      { entrySchema: entryZod, kind: "record" },
    );
    if (result === "unusable") throw new Error("unexpected");
    expect(Object.keys(result.valid as Record<string, Entry>).sort()).toEqual(["U1", "U3"]);
    expect(result.newly.map((e) => e.key)).toEqual(["U2"]);
  });

  it("record: reads the wrapped { entries, quarantined } shape", () => {
    const result = parseResilientCollection(
      { entries: { U1: good("a") }, quarantined: { U2: { id: "bad" } } },
      { entrySchema: entryZod, kind: "record" },
    );
    if (result === "unusable") throw new Error("unexpected");
    expect(Object.keys(result.valid as Record<string, Entry>)).toEqual(["U1"]);
    expect(result.newly).toHaveLength(0);
    expect(result.quarantine[0].key).toBe("U2");
  });

  it("returns 'unusable' for a non-object top level", () => {
    for (const bad of [null, "str", 42, [1, 2]]) {
      expect(parseResilientCollection(bad, { entrySchema: entryZod, kind: "record" })).toBe(
        "unusable",
      );
    }
  });
});

describe("serializeResilientCollection", () => {
  it("array: round-trips and omits quarantined when empty", () => {
    expect(
      serializeResilientCollection([good("a")], [], { kind: "array", collectionKey: "rules" }),
    ).toEqual({ rules: [good("a")] });
    expect(
      serializeResilientCollection([good("a")], [{ key: "x", raw: { id: "bad" } }], {
        kind: "array",
        collectionKey: "rules",
      }),
    ).toEqual({ rules: [good("a")], quarantined: [{ id: "bad" }] });
  });

  it("record: writes the wrapped shape, quarantine keyed", () => {
    expect(
      serializeResilientCollection({ U1: good("a") }, [{ key: "U2", raw: { id: "bad" } }], {
        kind: "record",
      }),
    ).toEqual({ entries: { U1: good("a") }, quarantined: { U2: { id: "bad" } } });
  });
});

describe("retry / removal / summarize", () => {
  const quarantine = [
    { key: "fixable", raw: good("fixable") },
    { key: "broken", raw: { id: "broken" } },
  ];

  it("retry restores a now-valid entry and prunes it", () => {
    const outcome = retryQuarantinedEntry(quarantine, "fixable", entryZod);
    expect(outcome.ok).toBe(true);
    expect(outcome.entry?.id).toBe("fixable");
    expect(outcome.remaining?.map((q) => q.key)).toEqual(["broken"]);
  });

  it("retry keeps a still-invalid entry and reports the error", () => {
    const outcome = retryQuarantinedEntry(quarantine, "broken", entryZod);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBeTruthy();
  });

  it("removal prunes by key, null when absent", () => {
    expect(deleteQuarantinedEntry(quarantine, "broken")?.map((q) => q.key)).toEqual(["fixable"]);
    expect(deleteQuarantinedEntry(quarantine, "nope")).toBeNull();
  });

  it("summarize marks a now-valid entry as revalidated", () => {
    const summaries = summarizeQuarantine(quarantine, entryZod);
    expect(summaries.find((s) => s.key === "fixable")?.error).toMatch(/revalidated/);
    expect(summaries.find((s) => s.key === "broken")?.field).toBe("n");
  });
});

describe("loadResilientCollection + freeze lifecycle", () => {
  let tempDir: string;
  let reports: QuarantineReport[];
  const path = () => join(tempDir, "store.json");

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "resilient-"));
    reports = [];
    clearFreeze(join(tempDir, "store.json"));
  });
  afterEach(async () => {
    clearFreeze(join(tempDir, "store.json"));
    await rm(tempDir, { recursive: true, force: true });
  });

  const load = (readImpl: (p: string) => Promise<string>) =>
    loadResilientCollection<Entry>({
      path: path(),
      source: "test store",
      kind: "array",
      collectionKey: "rules",
      entrySchema: entryZod,
      readFile: readImpl,
      onQuarantine: (r) => reports.push(r),
    });

  it("quarantines a bad entry and notifies the owner", async () => {
    await writeFile(path(), JSON.stringify({ rules: [good("a"), { id: "bad" }] }));
    const result = await load(readUtf8);
    expect((result.valid as Entry[]).map((e) => e.id)).toEqual(["a"]);
    expect(result.frozen).toBe(false);
    expect(reports).toHaveLength(1);
    expect(reports[0].source).toBe("test store");
    expect(reports[0].quarantined).toHaveLength(1);
  });

  it("freezes + snapshots + notifies on a total parse failure, and a save refuses to overwrite", async () => {
    await writeFile(path(), "{ not json");
    const result = await load(readUtf8);
    expect(result.frozen).toBe(true);
    expect(isFrozen(path())).toBe(true);
    expect(reports.some((r) => r.frozen)).toBe(true);

    const files = await readdir(tempDir);
    expect(files.some((f) => f.includes(".corrupt-"))).toBe(true);

    const wrote = await writeResilientCollection(path(), { rules: [] });
    expect(wrote).toBe(false);
    expect(await readFile(path(), "utf-8")).toBe("{ not json");
  });

  it("freezes on an unusable (non-object) top level", async () => {
    await writeFile(path(), JSON.stringify([1, 2, 3]));
    const result = await load(readUtf8);
    expect(result.frozen).toBe(true);
  });

  it("still freezes even when the snapshot content is unwritable", async () => {
    await writeFile(path(), "corrupt");
    const badReader = vi.fn(async () => "corrupt-not-json{");
    const result = await load(badReader);
    expect(result.frozen).toBe(true);
    expect(isFrozen(path())).toBe(true);
  });

  it("clears the freeze on a later clean load and resumes writes", async () => {
    await writeFile(path(), "broken");
    await load(readUtf8);
    expect(isFrozen(path())).toBe(true);

    await writeFile(path(), JSON.stringify({ rules: [good("a")] }));
    const result = await load(readUtf8);
    expect(isFrozen(path())).toBe(false);
    expect((result.valid as Entry[]).map((e) => e.id)).toEqual(["a"]);

    const wrote = await writeResilientCollection(path(), { rules: [good("a")] });
    expect(wrote).toBe(true);
  });
});
