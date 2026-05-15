import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeSetupVersionHash, getSentinelHash } from "./setupVersion.js";

let tmpRoot: string;
let originalCwd: string;

function writeOverrideInstructions(repo: string, content: string): void {
  const dir = join(tmpRoot, "data", "configuration", repo);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "worktree_setup_instructions.md"), content);
}

before(() => {
  originalCwd = process.cwd();
});

after(() => {
  process.chdir(originalCwd);
});

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "setup-version-"));
  mkdirSync(join(tmpRoot, "data"), { recursive: true });
  process.chdir(tmpRoot);
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("computeSetupVersionHash", () => {
  it("returns sentinel when no instructions file exists", () => {
    assert.equal(computeSetupVersionHash("missing-repo"), getSentinelHash());
  });

  it("hashes the instructions file content", () => {
    writeOverrideInstructions("my-repo", "do thing A");
    const hashA = computeSetupVersionHash("my-repo");

    writeOverrideInstructions("my-repo", "do thing B");
    const hashB = computeSetupVersionHash("my-repo");

    assert.notEqual(hashA, hashB);
    assert.notEqual(hashA, getSentinelHash());
  });

  it("produces a stable hash for identical content", () => {
    writeOverrideInstructions("my-repo", "fixed content");
    const hash1 = computeSetupVersionHash("my-repo");
    const hash2 = computeSetupVersionHash("my-repo");
    assert.equal(hash1, hash2);
  });
});
