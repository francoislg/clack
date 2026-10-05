import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../config.js", () => ({
  getConfig: vi.fn(),
  getDownloadsDir: vi.fn(() => "/data/downloads"),
  getFileLedgerPath: vi.fn(() => "/data/state/file-ledger.json"),
}));
vi.mock("./ledger.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./ledger.js")>()),
  loadLedger: vi.fn(),
  updateLedger: vi.fn(),
}));
vi.mock("../sessions.js", () => ({ getSession: vi.fn() }));
vi.mock("../slack/activeRuns.js", () => ({ getByThread: vi.fn() }));
vi.mock("../tester/concurrency.js", () => ({ getActiveTesterRuns: vi.fn() }));
vi.mock("../logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import type { ClaudeRunHandle } from "../claude/runHandle.js";
import { getConfig, type Config } from "../config.js";
import type { SessionContext } from "../sessions.js";
import { getSession } from "../sessions.js";
import { getByThread } from "../slack/activeRuns.js";
import { getActiveTesterRuns } from "../tester/concurrency.js";
import { stub } from "../testStubs.js";
import type { FileLedgerEntry } from "./ledger.js";
import type { ManagedRoot } from "./roots.js";
import { defaultSweepDeps, sweepManagedFiles, type SweepDeps } from "./sweep.js";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const downloads: ManagedRoot = { name: "downloads", dir: "/data/downloads" };
const recordings: ManagedRoot = { name: "recordings", dir: "/rec", fixedOwner: "tester" };

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

interface HarnessOptions {
  ledger?: FileLedgerEntry[];
  /** Absolute paths of files on disk. */
  files?: string[];
  /** Root dirs that exist; defaults to every root. */
  rootDirs?: string[];
}

function createHarness(opts: HarnessOptions = {}) {
  let entries = opts.ledger ?? [];
  const files = opts.files ?? [];
  const roots = [downloads, recordings];
  const rootDirs = opts.rootDirs ?? roots.map((r) => r.dir);
  const deps = {
    roots,
    retention: {
      downloads: { keepUploadedHours: 168, keepUnuploadedHours: 24 },
      recordings: { keepUploadedHours: 336, keepUnuploadedHours: 48 },
    },
    now: vi.fn<SweepDeps["now"]>(() => NOW),
    isOwnerLive: vi.fn<SweepDeps["isOwnerLive"]>().mockResolvedValue(false),
    listFiles: vi.fn<SweepDeps["listFiles"]>(async (dir) =>
      files.filter((f) => f.startsWith(`${dir}/`)),
    ),
    stat: vi.fn<SweepDeps["stat"]>().mockResolvedValue({ mtime: new Date(hoursAgo(1)) }),
    unlink: vi.fn<SweepDeps["unlink"]>().mockResolvedValue(undefined),
    exists: vi.fn<SweepDeps["exists"]>(async (p) => files.includes(p) || rootDirs.includes(p)),
    removeEmptyDirs: vi.fn<SweepDeps["removeEmptyDirs"]>().mockResolvedValue(undefined),
    realpath: vi.fn<SweepDeps["realpath"]>(async (p) => p),
    loadLedger: vi.fn<SweepDeps["loadLedger"]>(async () => entries),
    updateLedger: vi.fn<SweepDeps["updateLedger"]>(async (mutate) => {
      entries = mutate(entries);
    }),
    logger: {
      info: vi.fn<SweepDeps["logger"]["info"]>(),
      warn: vi.fn<SweepDeps["logger"]["warn"]>(),
    },
  } satisfies SweepDeps;
  return { deps, ledger: () => entries };
}

function entry(overrides: Partial<FileLedgerEntry> & { path: string }): FileLedgerEntry {
  return {
    root: "downloads",
    owner: overrides.path.split("/")[0] ?? "",
    createdAt: hoursAgo(1),
    ...overrides,
  };
}

describe("sweepManagedFiles", () => {
  it("skips an untagged file it can't stat and tags the rest", async () => {
    const h = createHarness({
      files: ["/data/downloads/s1/gone.txt", "/data/downloads/s1/b.txt"],
    });
    h.deps.stat.mockImplementation(async (p) => {
      if (p === "/data/downloads/s1/gone.txt") throw new Error("ENOENT");
      return { mtime: new Date(hoursAgo(1)) };
    });

    const result = await sweepManagedFiles(h.deps);

    expect(result.tagged).toBe(1);
    expect(h.ledger().map((e) => e.path)).toEqual(["s1/b.txt"]);
    expect(h.deps.logger.warn).toHaveBeenCalledWith(
      "managed-files: skipping /data/downloads/s1/gone.txt: ENOENT",
    );
  });

  it("still sweeps the other roots when one root fails", async () => {
    const e = entry({
      root: "recordings",
      owner: "tester",
      path: "old.mp4",
      createdAt: hoursAgo(100),
    });
    const h = createHarness({ ledger: [e], files: ["/rec/old.mp4"] });
    h.deps.listFiles.mockImplementation(async (dir) => {
      if (dir === "/data/downloads") throw new Error("EACCES");
      return dir === "/rec" ? ["/rec/old.mp4"] : [];
    });

    const result = await sweepManagedFiles(h.deps);

    expect(h.deps.logger.warn).toHaveBeenCalledWith(
      "managed-files: sweep of downloads failed: EACCES",
    );
    expect(result.deleted).toEqual(["recordings/old.mp4"]);
  });

  it("deletes an uploaded file past keepUploadedHours", async () => {
    const e = entry({ path: "s1/a.txt", createdAt: hoursAgo(200), uploadedAt: hoursAgo(170) });
    const h = createHarness({ ledger: [e], files: ["/data/downloads/s1/a.txt"] });

    const result = await sweepManagedFiles(h.deps);

    expect(h.deps.unlink).toHaveBeenCalledWith("/data/downloads/s1/a.txt");
    expect(result.deleted).toEqual(["downloads/s1/a.txt"]);
    expect(h.ledger()).toEqual([]);
    expect(h.deps.logger.info).toHaveBeenCalledWith(
      "managed-files: deleted downloads/s1/a.txt (uploaded, older than 168h)",
    );
    expect(h.deps.removeEmptyDirs).toHaveBeenCalledWith("/data/downloads");
  });

  it("keeps an uploaded file within keepUploadedHours", async () => {
    const e = entry({ path: "s1/a.txt", createdAt: hoursAgo(200), uploadedAt: hoursAgo(100) });
    const h = createHarness({ ledger: [e], files: ["/data/downloads/s1/a.txt"] });

    const result = await sweepManagedFiles(h.deps);

    expect(h.deps.unlink).not.toHaveBeenCalled();
    expect(result.deleted).toEqual([]);
    expect(h.ledger()).toEqual([e]);
  });

  it("deletes a never-uploaded file older than keepUnuploadedHours", async () => {
    const e = entry({ path: "s1/a.txt", createdAt: hoursAgo(30) });
    const h = createHarness({ ledger: [e], files: ["/data/downloads/s1/a.txt"] });

    const result = await sweepManagedFiles(h.deps);

    expect(h.deps.unlink).toHaveBeenCalledWith("/data/downloads/s1/a.txt");
    expect(result.deleted).toEqual(["downloads/s1/a.txt"]);
    expect(h.ledger()).toEqual([]);
  });

  it("keeps an entry whose dates are unparseable", async () => {
    const e = entry({ path: "s1/a.txt", createdAt: "not-a-date" });
    const h = createHarness({ ledger: [e], files: ["/data/downloads/s1/a.txt"] });

    await sweepManagedFiles(h.deps);

    expect(h.deps.unlink).not.toHaveBeenCalled();
    expect(h.ledger()).toEqual([e]);
  });

  it("keeps a live owner's files and asks isOwnerLive once per owner", async () => {
    const ledger = [
      entry({ path: "live/a.txt", createdAt: hoursAgo(30) }),
      entry({ path: "live/b.txt", createdAt: hoursAgo(30) }),
      entry({ path: "dead/c.txt", createdAt: hoursAgo(30) }),
    ];
    const h = createHarness({
      ledger,
      files: [
        "/data/downloads/live/a.txt",
        "/data/downloads/live/b.txt",
        "/data/downloads/dead/c.txt",
      ],
    });
    h.deps.isOwnerLive.mockImplementation(async (_root, owner) => owner === "live");

    const result = await sweepManagedFiles(h.deps);

    expect(h.deps.isOwnerLive).toHaveBeenCalledTimes(2);
    expect(h.deps.isOwnerLive).toHaveBeenCalledWith(downloads, "live");
    expect(h.deps.isOwnerLive).toHaveBeenCalledWith(downloads, "dead");
    expect(result.deleted).toEqual(["downloads/dead/c.txt"]);
    expect(h.ledger()).toEqual([ledger[0], ledger[1]]);
  });

  it("tags untracked files with their mtime and owner, in one ledger update per root", async () => {
    const mtime = new Date(hoursAgo(2));
    const h = createHarness({
      files: ["/data/downloads/sess/a.txt", "/data/downloads/sess/b.txt", "/rec/vid.mp4"],
    });
    h.deps.stat.mockResolvedValue({ mtime });

    const result = await sweepManagedFiles(h.deps);

    expect(result.tagged).toBe(3);
    expect(h.deps.updateLedger).toHaveBeenCalledTimes(2);
    expect(h.ledger()).toEqual([
      { root: "downloads", path: "sess/a.txt", owner: "sess", createdAt: mtime.toISOString() },
      { root: "downloads", path: "sess/b.txt", owner: "sess", createdAt: mtime.toISOString() },
      { root: "recordings", path: "vid.mp4", owner: "tester", createdAt: mtime.toISOString() },
    ]);
    expect(h.deps.unlink).not.toHaveBeenCalled();
  });

  it("drops a missing file's entry once past keepUnuploadedHours, keeps a younger one", async () => {
    const old = entry({ path: "s1/old.txt", createdAt: hoursAgo(30) });
    const young = entry({ path: "s1/young.txt", createdAt: hoursAgo(2) });
    const h = createHarness({ ledger: [old, young] });

    const result = await sweepManagedFiles(h.deps);

    expect(result.dropped).toBe(1);
    expect(h.ledger()).toEqual([young]);
    expect(h.deps.unlink).not.toHaveBeenCalled();
  });

  it("never unlinks a path that resolves outside the root", async () => {
    const e = entry({ path: "s1/link.txt", createdAt: hoursAgo(30) });
    const h = createHarness({ ledger: [e], files: ["/data/downloads/s1/link.txt"] });
    h.deps.realpath.mockImplementation(async (p) =>
      p === "/data/downloads/s1/link.txt" ? "/etc/passwd" : p,
    );

    const result = await sweepManagedFiles(h.deps);

    expect(h.deps.unlink).not.toHaveBeenCalled();
    expect(result.deleted).toEqual([]);
    expect(result.tagged).toBe(0);
    expect(h.ledger()).toEqual([e]);
    expect(h.deps.logger.warn).toHaveBeenCalledWith(
      "managed-files: refusing to unlink downloads/s1/link.txt: Path is outside the managed downloads folder",
    );
  });

  it("keeps the entry and warns when unlink fails", async () => {
    const e = entry({ path: "s1/a.txt", createdAt: hoursAgo(30) });
    const h = createHarness({ ledger: [e], files: ["/data/downloads/s1/a.txt"] });
    h.deps.unlink.mockRejectedValue(new Error("EACCES"));

    const result = await sweepManagedFiles(h.deps);

    expect(result.deleted).toEqual([]);
    expect(h.ledger()).toEqual([e]);
    expect(h.deps.logger.warn).toHaveBeenCalledWith(
      "managed-files: failed to unlink downloads/s1/a.txt: EACCES",
    );
  });

  it("skips a root whose dir does not exist", async () => {
    const e = entry({ path: "s1/old.txt", createdAt: hoursAgo(30) });
    const h = createHarness({ ledger: [e], rootDirs: ["/rec"] });

    const result = await sweepManagedFiles(h.deps);

    expect(h.deps.listFiles).not.toHaveBeenCalledWith("/data/downloads");
    expect(h.deps.removeEmptyDirs).not.toHaveBeenCalledWith("/data/downloads");
    expect(result.dropped).toBe(0);
    expect(h.ledger()).toEqual([e]);
  });

  it("applies the recordings root's own retention windows", async () => {
    const dl = entry({ path: "s1/a.txt", createdAt: hoursAgo(250), uploadedAt: hoursAgo(200) });
    const recUploaded = entry({
      root: "recordings",
      owner: "tester",
      path: "up.mp4",
      createdAt: hoursAgo(250),
      uploadedAt: hoursAgo(200),
    });
    const recFresh = entry({
      root: "recordings",
      owner: "tester",
      path: "fresh.mp4",
      createdAt: hoursAgo(30),
    });
    const h = createHarness({
      ledger: [dl, recUploaded, recFresh],
      files: ["/data/downloads/s1/a.txt", "/rec/up.mp4", "/rec/fresh.mp4"],
    });

    const result = await sweepManagedFiles(h.deps);

    expect(result.deleted).toEqual(["downloads/s1/a.txt"]);
    expect(h.ledger()).toEqual([recUploaded, recFresh]);
  });
});

describe("defaultSweepDeps().isOwnerLive", () => {
  beforeEach(() => {
    vi.mocked(getConfig).mockReturnValue(stub<Config>({ tester: undefined }));
  });

  it("treats the system and plugin owners as not live", async () => {
    const deps = defaultSweepDeps();
    await expect(deps.isOwnerLive(downloads, "_system")).resolves.toBe(false);
    await expect(deps.isOwnerLive(downloads, "plugin:trivia")).resolves.toBe(false);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("is not live when the session is unknown", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    await expect(defaultSweepDeps().isOwnerLive(downloads, "sess")).resolves.toBe(false);
    expect(getSession).toHaveBeenCalledWith("sess");
  });

  it("is live when the session's thread has an active run", async () => {
    vi.mocked(getSession).mockResolvedValue(
      stub<SessionContext>({ channelId: "C1", threadTs: "1.2" }),
    );
    vi.mocked(getByThread).mockReturnValue(stub<ClaudeRunHandle>({}));
    await expect(defaultSweepDeps().isOwnerLive(downloads, "sess")).resolves.toBe(true);
    expect(getByThread).toHaveBeenCalledWith("C1", "1.2");
  });

  it("is not live when the session's thread has no active run", async () => {
    vi.mocked(getSession).mockResolvedValue(
      stub<SessionContext>({ channelId: "C1", threadTs: "1.2" }),
    );
    vi.mocked(getByThread).mockReturnValue(undefined);
    await expect(defaultSweepDeps().isOwnerLive(downloads, "sess")).resolves.toBe(false);
  });

  it("is live for recordings while any tester run is active", async () => {
    vi.mocked(getActiveTesterRuns).mockReturnValue([
      { sessionId: "s", repo: "r", branch: "b", startedAt: NOW },
    ]);
    await expect(defaultSweepDeps().isOwnerLive(recordings, "tester")).resolves.toBe(true);
    vi.mocked(getActiveTesterRuns).mockReturnValue([]);
    await expect(defaultSweepDeps().isOwnerLive(recordings, "tester")).resolves.toBe(false);
  });
});
