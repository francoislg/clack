import { describe, it, expect } from "vitest";
import { classify, planPull, planPush } from "./plan.js";

const inv = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("classify", () => {
  it.each([
    [undefined, "v", undefined, "vm-only"],
    ["l", undefined, undefined, "local-only"],
    ["x", "x", "old", "in-sync"],
    ["new", "base", "base", "changed-local"],
    ["base", "new", "base", "changed-vm"],
    ["l", "v", "base", "changed-both"],
    ["l", "v", undefined, "changed-both"],
  ] as const)("local=%s vm=%s base=%s → %s", (local, vm, base, expected) => {
    expect(classify(local, vm, base)).toBe(expected);
  });
});

describe("planPull", () => {
  it("creates VM-only files and records their hash", () => {
    const plan = planPull(inv({}), inv({ "data/a": "v" }), inv({}));
    expect(plan.create).toEqual(["data/a"]);
    expect(plan.agreed).toEqual(inv({ "data/a": "v" }));
  });

  it("replaces a VM-changed file without a backup", () => {
    const plan = planPull(inv({ "data/a": "b" }), inv({ "data/a": "v" }), inv({ "data/a": "b" }));
    expect(plan.replace).toEqual([{ path: "data/a", backup: false }]);
    expect(plan.agreed).toEqual(inv({ "data/a": "v" }));
  });

  it("backs up then replaces a file changed on both sides", () => {
    const plan = planPull(inv({ "data/a": "l" }), inv({ "data/a": "v" }), inv({ "data/a": "b" }));
    expect(plan.replace).toEqual([{ path: "data/a", backup: true }]);
  });

  it("treats a never-synced differing file as changed on both sides", () => {
    const plan = planPull(inv({ "data/a": "l" }), inv({ "data/a": "v" }), inv({}));
    expect(plan.replace).toEqual([{ path: "data/a", backup: true }]);
  });

  it("keeps a file changed only locally and records nothing for it", () => {
    const plan = planPull(inv({ "data/a": "l" }), inv({ "data/a": "b" }), inv({ "data/a": "b" }));
    expect(plan.pendingPush).toEqual(["data/a"]);
    expect(plan.replace).toEqual([]);
    expect(plan.agreed.has("data/a")).toBe(false);
  });

  it("reports local-only files without touching them", () => {
    const plan = planPull(inv({ "data/a": "l" }), inv({}), inv({}));
    expect(plan.localOnly).toEqual(["data/a"]);
    expect(plan.agreed.size).toBe(0);
  });

  it("records identical files as agreed", () => {
    const plan = planPull(inv({ "data/a": "x" }), inv({ "data/a": "x" }), inv({}));
    expect(plan.inSync).toEqual(["data/a"]);
    expect(plan.agreed).toEqual(inv({ "data/a": "x" }));
  });
});

describe("planPush", () => {
  it("creates local-only files and leaves every differing file alone without --overwrite", () => {
    const plan = planPush(
      inv({ "data/new": "n", "data/mine": "l", "data/theirs": "b2", "data/both": "l" }),
      inv({ "data/mine": "b", "data/theirs": "v", "data/both": "v" }),
      inv({ "data/mine": "b", "data/theirs": "b2", "data/both": "b" }),
      [],
    );
    expect(plan.create).toEqual(["data/new"]);
    expect(plan.replace).toEqual([]);
    expect(plan.skipped).toEqual([
      { path: "data/both", classification: "changed-both" },
      { path: "data/mine", classification: "changed-local" },
      { path: "data/theirs", classification: "changed-vm" },
    ]);
    expect(plan.refused).toEqual([]);
    expect(plan.agreed).toEqual(inv({ "data/new": "n" }));
  });

  it("replaces a named file only when the VM copy is unchanged since the last sync", () => {
    const plan = planPush(
      inv({ "data/config.json": "l" }),
      inv({ "data/config.json": "b" }),
      inv({ "data/config.json": "b" }),
      ["data/config.json"],
    );
    expect(plan.replace).toEqual(["data/config.json"]);
    expect(plan.agreed).toEqual(inv({ "data/config.json": "l" }));
  });

  it("refuses a named file that changed on the VM or was never synced", () => {
    const plan = planPush(
      inv({ "data/a": "b", "data/b": "l" }),
      inv({ "data/a": "v", "data/b": "v" }),
      inv({ "data/a": "b" }),
      ["data/a", "data/b"],
    );
    expect(plan.replace).toEqual([]);
    expect(plan.refused).toEqual([
      { path: "data/a", classification: "changed-vm" },
      { path: "data/b", classification: "changed-both" },
    ]);
  });

  it("applies a directory --overwrite to the local-only changes under it", () => {
    const plan = planPush(
      inv({ "data/dc/a.md": "l", "data/dc/b.md": "b", "data/other": "l" }),
      inv({ "data/dc/a.md": "b", "data/dc/b.md": "v", "data/other": "b" }),
      inv({ "data/dc/a.md": "b", "data/dc/b.md": "b", "data/other": "b" }),
      ["data/dc/"],
    );
    expect(plan.replace).toEqual(["data/dc/a.md"]);
    expect(plan.refused).toEqual([{ path: "data/dc/b.md", classification: "changed-vm" }]);
    expect(plan.skipped).toEqual([{ path: "data/other", classification: "changed-local" }]);
  });

  it("never touches VM-only files", () => {
    const plan = planPush(inv({}), inv({ "data/stale": "v" }), inv({}), []);
    expect(plan.vmOnly).toEqual(["data/stale"]);
    expect(plan.agreed.size).toBe(0);
  });

  it("throws when an --overwrite path matches no file", () => {
    expect(() =>
      planPush(inv({ "data/config.json": "l" }), inv({}), inv({}), ["data/confg.json"]),
    ).toThrow("--overwrite matches no file: data/confg.json");
  });

  it("does not treat a sibling with a shared prefix as under a named directory", () => {
    expect(() =>
      planPush(inv({ "data/plugins-extra/x": "l" }), inv({}), inv({}), ["data/plugins"]),
    ).toThrow("--overwrite matches no file: data/plugins");
  });
});
