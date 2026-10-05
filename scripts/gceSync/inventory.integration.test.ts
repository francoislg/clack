import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localInventory } from "./inventory.js";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

describe("localInventory (integration)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "gce-sync-inventory-"));
    mkdirSync(join(root, "data/default_configuration/user"), { recursive: true });
    mkdirSync(join(root, "data/cache"), { recursive: true });
    writeFileSync(join(root, "data/config.json"), "{}");
    writeFileSync(join(root, "data/default_configuration/user/a.md"), "A");
    writeFileSync(join(root, "data/default_configuration/user/.DS_Store"), "x");
    writeFileSync(join(root, "data/default_configuration/user/._a.md"), "x");
    writeFileSync(join(root, "data/cache/blob"), "x");
    symlinkSync(join(root, "data/config.json"), join(root, "data/link.json"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("hashes regular files under the roots, skipping metadata files and symlinks", () => {
    expect(localInventory(root, ["data"], ["data/cache"])).toEqual(
      new Map([
        ["data/config.json", sha("{}")],
        ["data/default_configuration/user/a.md", sha("A")],
      ]),
    );
  });

  it("accepts a single file as a root and ignores roots that do not exist", () => {
    expect(localInventory(root, ["data/config.json", "data/missing"])).toEqual(
      new Map([["data/config.json", sha("{}")]]),
    );
  });
});
