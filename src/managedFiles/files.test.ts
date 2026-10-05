import { describe, it, expect, vi } from "vitest";

vi.mock("../config.js", () => ({
  getConfig: vi.fn(),
  getDownloadsDir: vi.fn(() => "/data/downloads"),
}));
vi.mock("./ledger.js", () => ({
  loadLedger: vi.fn(),
  updateLedger: vi.fn(),
}));
vi.mock("../logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { logger } from "../logger.js";
import type { FileLedgerEntry } from "./ledger.js";
import {
  createFile,
  ensureOwnerFolder,
  ensureSystemDownloadsDir,
  markUploaded,
  ownerFolder,
  reservePath,
  resolveOwnedFile,
  type FilesDeps,
} from "./files.js";
import type { ManagedRoot } from "./roots.js";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const MTIME = new Date("2026-10-01T08:00:00.000Z");
const downloads: ManagedRoot = { name: "downloads", dir: "/data/downloads" };
const recordings: ManagedRoot = { name: "recordings", dir: "/rec", fixedOwner: "tester" };

interface Harness {
  deps: { [K in keyof FilesDeps]: ReturnType<typeof vi.fn<FilesDeps[K]>> };
  ledger: () => FileLedgerEntry[];
}

function createHarness(initial: FileLedgerEntry[] = [], existing: string[] = []): Harness {
  let entries = initial;
  const deps = {
    mkdir: vi.fn<FilesDeps["mkdir"]>().mockResolvedValue(undefined),
    writeFile: vi.fn<FilesDeps["writeFile"]>().mockResolvedValue(undefined),
    stat: vi.fn<FilesDeps["stat"]>().mockResolvedValue({ mtime: MTIME }),
    exists: vi.fn<FilesDeps["exists"]>(async (p) => existing.includes(p)),
    now: vi.fn<FilesDeps["now"]>(() => NOW),
    getRoots: vi.fn<FilesDeps["getRoots"]>(() => [downloads, recordings]),
    loadLedger: vi.fn<FilesDeps["loadLedger"]>(async () => entries),
    updateLedger: vi.fn<FilesDeps["updateLedger"]>(async (mutate) => {
      entries = mutate(entries);
    }),
    realpath: vi.fn<FilesDeps["realpath"]>(async (p) => p),
  };
  return { deps, ledger: () => entries };
}

describe("ownerFolder / ensureOwnerFolder", () => {
  it("joins the root dir and owner", () => {
    expect(ownerFolder(downloads, "sess")).toBe("/data/downloads/sess");
  });

  it("creates the owner folder recursively", async () => {
    const h = createHarness();
    await expect(ensureOwnerFolder("downloads", "sess", h.deps)).resolves.toBe(
      "/data/downloads/sess",
    );
    expect(h.deps.mkdir).toHaveBeenCalledWith("/data/downloads/sess", { recursive: true });
  });

  it("throws on an unregistered root", async () => {
    const h = createHarness();
    h.deps.getRoots.mockReturnValue([downloads]);
    await expect(ensureOwnerFolder("recordings", "tester", h.deps)).rejects.toThrow(
      "Managed root 'recordings' is not registered",
    );
  });

  it("throws on an unsafe owner", async () => {
    const h = createHarness();
    await expect(ensureOwnerFolder("downloads", "..", h.deps)).rejects.toThrow(
      "Invalid managed file owner: ..",
    );
    expect(h.deps.mkdir).not.toHaveBeenCalled();
  });

  it("ensureSystemDownloadsDir creates the _system downloads folder", async () => {
    const h = createHarness();
    await expect(ensureSystemDownloadsDir(h.deps)).resolves.toBe("/data/downloads/_system");
    expect(h.deps.mkdir).toHaveBeenCalledWith("/data/downloads/_system", { recursive: true });
  });
});

describe("createFile", () => {
  it("writes the data, then records the ledger entry", async () => {
    const h = createHarness();
    const path = await createFile(
      { root: "downloads", owner: "sess", name: "out.csv", data: "a,b" },
      h.deps,
    );
    expect(path).toBe("/data/downloads/sess/out.csv");
    expect(h.deps.writeFile).toHaveBeenCalledWith("/data/downloads/sess/out.csv", "a,b");
    expect(h.deps.writeFile.mock.invocationCallOrder[0]).toBeLessThan(
      h.deps.updateLedger.mock.invocationCallOrder[0] ?? 0,
    );
    expect(h.ledger()).toEqual([
      { root: "downloads", path: "sess/out.csv", owner: "sess", createdAt: NOW.toISOString() },
    ]);
  });

  it("records nothing when the write fails", async () => {
    const h = createHarness();
    h.deps.writeFile.mockRejectedValue(new Error("disk full"));
    await expect(
      createFile({ root: "downloads", owner: "sess", name: "out.csv", data: "x" }, h.deps),
    ).rejects.toThrow("disk full");
    expect(h.deps.updateLedger).not.toHaveBeenCalled();
  });

  it("reduces a traversing name to its basename", async () => {
    const h = createHarness();
    const path = await createFile(
      { root: "downloads", owner: "sess", name: "../../state/roles.json", data: "{}" },
      h.deps,
    );
    expect(path).toBe("/data/downloads/sess/roles.json");
  });

  it("rejects a name that is empty after basename", async () => {
    const h = createHarness();
    await expect(
      createFile({ root: "downloads", owner: "sess", name: "..", data: "" }, h.deps),
    ).rejects.toThrow("Invalid managed file name: ..");
    expect(h.deps.writeFile).not.toHaveBeenCalled();
  });

  it("suffixes the name on collision", async () => {
    const h = createHarness([], ["/data/downloads/sess/out.csv", "/data/downloads/sess/out-1.csv"]);
    const path = await createFile(
      { root: "downloads", owner: "sess", name: "out.csv", data: "x" },
      h.deps,
    );
    expect(path).toBe("/data/downloads/sess/out-2.csv");
    expect(h.ledger()[0]?.path).toBe("sess/out-2.csv");
  });
});

describe("reservePath", () => {
  it("records the entry and writes nothing", async () => {
    const h = createHarness();
    const path = await reservePath(
      { root: "recordings", owner: "tester", name: "run.mp4" },
      h.deps,
    );
    expect(path).toBe("/rec/tester/run.mp4");
    expect(h.deps.writeFile).not.toHaveBeenCalled();
    expect(h.ledger()).toEqual([
      { root: "recordings", path: "tester/run.mp4", owner: "tester", createdAt: NOW.toISOString() },
    ]);
  });
});

describe("resolveOwnedFile", () => {
  it("rejects another session's folder", async () => {
    const h = createHarness();
    const result = await resolveOwnedFile({ owner: "sess", path: "../other/a.txt" }, h.deps);
    expect(result).toEqual({
      ok: false,
      error: "file_path must be inside this session's downloads folder",
    });
  });

  it("rejects a sibling-prefix absolute path", async () => {
    const h = createHarness();
    const result = await resolveOwnedFile(
      { owner: "sess", path: "/data/downloads/sess-x/a.txt" },
      h.deps,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects a symlink escaping the owner folder", async () => {
    const h = createHarness();
    h.deps.realpath.mockImplementation(async (p) =>
      p === "/data/downloads/sess/link" ? "/data/state/roles.json" : p,
    );
    const result = await resolveOwnedFile({ owner: "sess", path: "link" }, h.deps);
    expect(result.ok).toBe(false);
  });

  it("reports a missing file", async () => {
    const h = createHarness();
    h.deps.realpath.mockRejectedValue(new Error("ENOENT"));
    const result = await resolveOwnedFile({ owner: "sess", path: "gone.txt" }, h.deps);
    expect(result).toEqual({ ok: false, error: "File not found: gone.txt" });
  });

  it("tags an untagged file with its mtime", async () => {
    const h = createHarness();
    const result = await resolveOwnedFile({ owner: "sess", path: "a.txt" }, h.deps);
    expect(result).toEqual({ ok: true, path: "/data/downloads/sess/a.txt" });
    expect(h.deps.stat).toHaveBeenCalledWith("/data/downloads/sess/a.txt");
    expect(h.ledger()).toEqual([
      { root: "downloads", path: "sess/a.txt", owner: "sess", createdAt: MTIME.toISOString() },
    ]);
  });

  it("reports a file that vanishes before it can be tagged", async () => {
    const h = createHarness();
    h.deps.stat.mockRejectedValue(new Error("ENOENT"));
    const result = await resolveOwnedFile({ owner: "sess", path: "a.txt" }, h.deps);
    expect(result).toEqual({ ok: false, error: "File not found: a.txt" });
    expect(h.deps.updateLedger).not.toHaveBeenCalled();
  });

  it("leaves an already-tagged file alone", async () => {
    const existing: FileLedgerEntry = {
      root: "downloads",
      path: "sess/a.txt",
      owner: "sess",
      createdAt: NOW.toISOString(),
    };
    const h = createHarness([existing]);
    await resolveOwnedFile({ owner: "sess", path: "a.txt" }, h.deps);
    expect(h.deps.updateLedger).not.toHaveBeenCalled();
  });
});

describe("markUploaded", () => {
  const info = { fileId: "F1", permalink: "https://x/p", channel: "C1", threadTs: "1.2" };

  it("sets upload fields on an existing entry", async () => {
    const existing: FileLedgerEntry = {
      root: "downloads",
      path: "sess/a.txt",
      owner: "sess",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const h = createHarness([existing]);
    await markUploaded("/data/downloads/sess/a.txt", info, h.deps);
    expect(h.ledger()).toEqual([{ ...existing, ...info, uploadedAt: NOW.toISOString() }]);
  });

  it("creates a discovered entry when missing", async () => {
    const h = createHarness();
    await markUploaded("/rec/x/run.mp4", info, h.deps);
    expect(h.ledger()).toEqual([
      {
        root: "recordings",
        path: "x/run.mp4",
        owner: "tester",
        createdAt: MTIME.toISOString(),
        uploadedAt: NOW.toISOString(),
        ...info,
      },
    ]);
  });

  it("warns and skips a file outside every root", async () => {
    const h = createHarness();
    await markUploaded("/tmp/elsewhere.txt", info, h.deps);
    expect(h.deps.updateLedger).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
