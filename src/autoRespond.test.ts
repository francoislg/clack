import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addRule,
  updateRule,
  toggleRule,
  deleteRule,
  getRule,
  getRules,
  clearAutoRespondCache,
} from "./autoRespond.js";

const originalCwd = process.cwd;

describe("autoRespond — updateRule partial patch", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ar-test-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearAutoRespondCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null for unknown rule ID", async () => {
    const result = await updateRule("nope", { channels: ["C1"] });
    assert.equal(result, null);
  });

  it("preserves fields omitted from the patch", async () => {
    const rule = await addRule(["C1"], ["U1"], ["error", "crash"], "extra ctx", "pre ctx");

    const updated = await updateRule(rule.id, { channels: ["C2"] });

    assert.ok(updated);
    assert.deepEqual(updated.channels, ["C2"]);
    assert.deepEqual(updated.userFilters, ["U1"]);
    assert.deepEqual(updated.keywords, ["error", "crash"]);
    assert.equal(updated.extraContext, "extra ctx");
    assert.equal(updated.preAnalysisContext, "pre ctx");
  });

  it("clears extraContext when passed an empty string", async () => {
    const rule = await addRule(["C1"], undefined, undefined, "some context");
    const updated = await updateRule(rule.id, { extraContext: "" });
    assert.ok(updated);
    assert.equal(updated.extraContext, undefined);
    assert.equal("extraContext" in updated, false);
  });

  it("clears preAnalysisContext when passed an empty string", async () => {
    const rule = await addRule(["C1"], undefined, undefined, undefined, "pre ctx");
    const updated = await updateRule(rule.id, { preAnalysisContext: "" });
    assert.ok(updated);
    assert.equal(updated.preAnalysisContext, undefined);
    assert.equal("preAnalysisContext" in updated, false);
  });

  it("clears keywords when passed an empty array", async () => {
    const rule = await addRule(["C1"], undefined, ["error"]);
    const updated = await updateRule(rule.id, { keywords: [] });
    assert.ok(updated);
    assert.equal(updated.keywords, undefined);
    assert.equal("keywords" in updated, false);
  });

  it("clears userFilters when passed an empty array", async () => {
    const rule = await addRule(["C1"], ["U1"]);
    const updated = await updateRule(rule.id, { userFilters: [] });
    assert.ok(updated);
    assert.equal(updated.userFilters, undefined);
    assert.equal("userFilters" in updated, false);
  });

  it("trims whitespace in extraContext and clears when only whitespace", async () => {
    const rule = await addRule(["C1"], undefined, undefined, "original");
    const updated = await updateRule(rule.id, { extraContext: "   " });
    assert.ok(updated);
    assert.equal(updated.extraContext, undefined);
  });

  it("applies a full replacement patch (mirrors Home Tab modal submission)", async () => {
    const rule = await addRule(["C1"], ["U1"], ["k1"], "c1", "p1");
    const updated = await updateRule(rule.id, {
      channels: ["C2"],
      userFilters: ["U2"],
      keywords: ["k2"],
      extraContext: "c2",
      preAnalysisContext: "p2",
    });
    assert.ok(updated);
    assert.deepEqual(updated.channels, ["C2"]);
    assert.deepEqual(updated.userFilters, ["U2"]);
    assert.deepEqual(updated.keywords, ["k2"]);
    assert.equal(updated.extraContext, "c2");
    assert.equal(updated.preAnalysisContext, "p2");
  });

  it("persists updates to disk and cache", async () => {
    const rule = await addRule(["C1"]);
    await updateRule(rule.id, { extraContext: "persisted" });
    clearAutoRespondCache();
    const loaded = await getRule(rule.id);
    assert.ok(loaded);
    assert.equal(loaded.extraContext, "persisted");
  });
});

describe("autoRespond — existing CRUD still works", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ar-test-"));
    await mkdir(join(tempDir, "data", "state"), { recursive: true });
    process.cwd = () => tempDir;
    clearAutoRespondCache();
  });

  afterEach(async () => {
    process.cwd = originalCwd;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("addRule creates an enabled rule", async () => {
    const rule = await addRule(["C1"]);
    assert.equal(rule.enabled, true);
    assert.ok(rule.id);
  });

  it("toggleRule flips enabled", async () => {
    const rule = await addRule(["C1"]);
    const toggled = await toggleRule(rule.id);
    assert.ok(toggled);
    assert.equal(toggled.enabled, false);
    const again = await toggleRule(rule.id);
    assert.ok(again);
    assert.equal(again.enabled, true);
  });

  it("toggleRule returns null for unknown ID", async () => {
    const result = await toggleRule("nope");
    assert.equal(result, null);
  });

  it("deleteRule removes the rule and returns true", async () => {
    const rule = await addRule(["C1"]);
    const deleted = await deleteRule(rule.id);
    assert.equal(deleted, true);
    const remaining = await getRules();
    assert.equal(remaining.length, 0);
  });

  it("deleteRule returns false for unknown ID", async () => {
    const deleted = await deleteRule("nope");
    assert.equal(deleted, false);
  });
});
