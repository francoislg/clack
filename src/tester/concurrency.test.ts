import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import type { Config } from "../config.js";
import { tryAcquireTesterSlot, releaseTesterSlot, getActiveTesterRuns } from "./concurrency.js";

const getConfigMock = vi.hoisted(() => vi.fn());
vi.mock("../config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../config.js")>();
  return { ...original, getConfig: () => getConfigMock() };
});

function configWithCap(maxConcurrent?: number): Partial<Config> {
  return {
    tester: {
      enabled: true,
      sidecarUrl: "http://sidecar/mcp",
      recordingsDir: "/recordings",
      ...(maxConcurrent !== undefined && { maxConcurrent }),
    },
  };
}

describe("tester concurrency slots", () => {
  beforeEach(() => {
    for (const run of getActiveTesterRuns()) {
      releaseTesterSlot(run.sessionId);
    }
    getConfigMock.mockReturnValue(configWithCap());
  });

  it("caps at 1 by default and rejects the second run", () => {
    assert.equal(tryAcquireTesterSlot({ sessionId: "s1", repo: "r", branch: "b1" }), true);
    assert.equal(tryAcquireTesterSlot({ sessionId: "s2", repo: "r", branch: "b2" }), false);
  });

  it("frees the slot on release", () => {
    tryAcquireTesterSlot({ sessionId: "s1", repo: "r", branch: "b1" });
    releaseTesterSlot("s1");
    assert.equal(tryAcquireTesterSlot({ sessionId: "s2", repo: "r", branch: "b2" }), true);
  });

  it("honors a configured cap above 1", () => {
    getConfigMock.mockReturnValue(configWithCap(2));
    assert.equal(tryAcquireTesterSlot({ sessionId: "s1", repo: "r", branch: "b1" }), true);
    assert.equal(tryAcquireTesterSlot({ sessionId: "s2", repo: "r", branch: "b2" }), true);
    assert.equal(tryAcquireTesterSlot({ sessionId: "s3", repo: "r", branch: "b3" }), false);
  });

  it("exposes active runs for the Home Tab", () => {
    tryAcquireTesterSlot({ sessionId: "s1", repo: "my-repo", branch: "feature/x" });
    const runs = getActiveTesterRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].repo, "my-repo");
    assert.equal(runs[0].branch, "feature/x");
    assert.ok(runs[0].startedAt instanceof Date);
  });
});
