import { describe, it, expect } from "vitest";
import { isUnder, parseManifest, selectRoots, unpushableEntries } from "./manifest.js";

describe("parseManifest", () => {
  it("drops comments, blanks, surrounding whitespace, and trailing slashes", () => {
    const text =
      "# header\n\n  data/config.json  \ndata/default_configuration/\n# data/plugins/x\n";
    expect(parseManifest(text)).toEqual(["data/config.json", "data/default_configuration"]);
  });
});

describe("isUnder", () => {
  it("matches the root itself and its descendants only", () => {
    expect(isUnder("data/state", "data/state")).toBe(true);
    expect(isUnder("data/state/cron.json", "data/state")).toBe(true);
    expect(isUnder("data/statement.md", "data/state")).toBe(false);
  });
});

describe("unpushableEntries", () => {
  it("accepts ordinary config paths", () => {
    expect(unpushableEntries(["data/config.json", "data/plugins/my-gifs"])).toEqual([]);
  });

  it("rejects runtime-owned paths and their descendants", () => {
    expect(unpushableEntries(["data/state", "data/sessions/abc.json"])).toEqual([
      "data/state: overlaps data/state, which the running bot owns",
      "data/sessions/abc.json: overlaps data/sessions, which the running bot owns",
    ]);
  });

  it("rejects the managed downloads folder", () => {
    expect(unpushableEntries(["data/downloads/S1/export.csv"])).toEqual([
      "data/downloads/S1/export.csv: overlaps data/downloads, which the running bot owns",
    ]);
  });

  it("rejects paths outside data/, the data root itself, and '..' segments", () => {
    expect(unpushableEntries(["src/index.ts", "data", "data/../etc"])).toEqual([
      "src/index.ts: must be a path under data/",
      "data: must be a path under data/",
      "data/../etc: must not contain '..'",
    ]);
  });
});

describe("selectRoots", () => {
  const manifest = ["data/config.json", "data/default_configuration"];

  it("returns the whole manifest when nothing is selected", () => {
    expect(selectRoots(manifest, [])).toEqual(manifest);
  });

  it("narrows to selections inside manifest entries", () => {
    expect(selectRoots(manifest, ["data/default_configuration/user/"])).toEqual([
      "data/default_configuration/user",
    ]);
  });

  it("rejects a selection outside the manifest", () => {
    expect(() => selectRoots(manifest, ["data/state"])).toThrow(
      "--path outside the manifest: data/state",
    );
  });
});
