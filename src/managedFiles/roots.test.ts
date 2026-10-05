import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  getDownloadsDir: vi.fn<() => string>(),
}));

import { getDownloadsDir } from "../config.js";
import {
  findRoot,
  getManagedRoots,
  isSafeSegment,
  ownerOf,
  pluginOwner,
  resolveInRoot,
  TESTER_OWNER,
  type ManagedRoot,
  type RootsDeps,
} from "./roots.js";

const downloads: ManagedRoot = { name: "downloads", dir: "/data/downloads" };

function identityRealpath(): RootsDeps {
  return { realpath: vi.fn<RootsDeps["realpath"]>(async (p) => p) };
}

describe("getManagedRoots", () => {
  beforeEach(() => {
    vi.mocked(getDownloadsDir).mockReturnValue("/data/downloads");
  });

  it("returns only downloads when no recordingsDir is configured", () => {
    expect(getManagedRoots({})).toEqual([{ name: "downloads", dir: "/data/downloads" }]);
    expect(getManagedRoots({ tester: { enabled: true, recordingsDir: "" } })).toHaveLength(1);
  });

  it.each([true, false])("adds recordings when recordingsDir is set (enabled=%s)", (enabled) => {
    const roots = getManagedRoots({ tester: { enabled, recordingsDir: "/rec" } });
    expect(roots).toEqual([
      { name: "downloads", dir: "/data/downloads" },
      { name: "recordings", dir: "/rec", fixedOwner: TESTER_OWNER },
    ]);
  });
});

describe("findRoot / pluginOwner / ownerOf", () => {
  it("finds a root by name", () => {
    expect(findRoot([downloads], "downloads")).toBe(downloads);
    expect(findRoot([downloads], "recordings")).toBeUndefined();
  });

  it("prefixes plugin owners", () => {
    expect(pluginOwner("trivia")).toBe("plugin:trivia");
  });

  it("uses the fixed owner or the first segment", () => {
    expect(ownerOf(downloads, "sess-1/a/b.txt")).toBe("sess-1");
    expect(ownerOf({ name: "recordings", dir: "/rec", fixedOwner: "tester" }, "x/y.mp4")).toBe(
      "tester",
    );
  });
});

describe("isSafeSegment", () => {
  it.each(["", ".", "..", "a/b", "a\\b", "a\0b"])("rejects %j", (s) => {
    expect(isSafeSegment(s)).toBe(false);
  });

  it("accepts a plain name", () => {
    expect(isSafeSegment("report.csv")).toBe(true);
  });
});

describe("resolveInRoot", () => {
  it("resolves a contained relative path", async () => {
    const deps = identityRealpath();
    const result = await resolveInRoot(downloads, "sess/a.txt", deps);
    expect(result).toEqual({
      ok: true,
      realPath: "/data/downloads/sess/a.txt",
      relPath: "sess/a.txt",
    });
    expect(deps.realpath).toHaveBeenCalledWith("/data/downloads/sess/a.txt");
    expect(deps.realpath).toHaveBeenCalledWith("/data/downloads");
  });

  it("keeps absolute paths absolute", async () => {
    const result = await resolveInRoot(downloads, "/data/downloads/s/b.txt", identityRealpath());
    expect(result).toEqual({ ok: true, realPath: "/data/downloads/s/b.txt", relPath: "s/b.txt" });
  });

  it("rejects .. traversal", async () => {
    const result = await resolveInRoot(downloads, "../state/roles.json", identityRealpath());
    expect(result).toEqual({
      ok: false,
      reason: "outside",
      error: "Path is outside the managed downloads folder",
    });
  });

  it("rejects the root itself", async () => {
    const result = await resolveInRoot(downloads, ".", identityRealpath());
    expect(result.ok).toBe(false);
  });

  it("rejects a sibling-prefix folder", async () => {
    const result = await resolveInRoot(downloads, "/data/downloads-x/a.txt", identityRealpath());
    expect(result).toEqual({
      ok: false,
      reason: "outside",
      error: "Path is outside the managed downloads folder",
    });
  });

  it("rejects a symlink escaping the root", async () => {
    const realpath = vi.fn<RootsDeps["realpath"]>(async (p) =>
      p === "/data/downloads/s/link" ? "/etc/passwd" : p,
    );
    const result = await resolveInRoot(downloads, "s/link", { realpath });
    expect(result).toEqual({
      ok: false,
      reason: "outside",
      error: "Path is outside the managed downloads folder",
    });
  });

  it("reports a missing file", async () => {
    const realpath = vi.fn<RootsDeps["realpath"]>().mockRejectedValue(new Error("ENOENT"));
    const result = await resolveInRoot(downloads, "s/missing.txt", { realpath });
    expect(result).toEqual({
      ok: false,
      reason: "missing",
      error: "File not found: s/missing.txt",
    });
  });
});
