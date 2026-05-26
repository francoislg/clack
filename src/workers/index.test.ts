import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { createPool, getPool, lazyDefaultPool, resetPool, setPool } from "./index.js";
import { DisposablePool } from "./disposablePool.js";
import { ReusablePool } from "./reusablePool.js";
import type { Config } from "../config.js";
import type { WorkerPool } from "./types.js";

/**
 * A full Config skeleton — the factory only inspects `changesWorkflow.reusableFolders`,
 * but the type requires the rest to be present.
 */
function makeConfig(reusable?: { enabled: boolean }): Config {
  return {
    slack: {
      botToken: "xoxb-test",
      appToken: "xapp-test",
      signingSecret: "secret",
      fetchAndStoreUsername: false,
      sendErrorsAsDM: false,
    },
    reactions: { trigger: "robot_face" },
    directMessages: { enabled: false },
    mentions: { enabled: false },
    repositories: [],
    git: { pullIntervalMinutes: 60, shallowClone: true, cloneDepth: 1 },
    sessions: { cleanupIntervalMinutes: 60 },
    claudeCode: { model: "sonnet" },
    changesWorkflow: reusable
      ? { enabled: true, reusableFolders: { enabled: reusable.enabled } }
      : { enabled: true },
  };
}

function makeStubPool(): WorkerPool {
  return {
    acquire: async () => {
      throw new Error("not used");
    },
    release: async () => {},
    findByBranch: () => null,
    list: () => [],
    ensureMinimum: async () => {},
  };
}

beforeEach(() => {
  resetPool();
});

describe("createPool", () => {
  it("returns DisposablePool when changesWorkflow has no reusableFolders block", () => {
    const pool = createPool(makeConfig());
    assert.ok(pool instanceof DisposablePool);
  });

  it("returns DisposablePool when reusableFolders.enabled is false", () => {
    const pool = createPool(makeConfig({ enabled: false }));
    assert.ok(pool instanceof DisposablePool);
  });

  it("returns ReusablePool when reusableFolders.enabled is true", () => {
    const pool = createPool(makeConfig({ enabled: true }));
    assert.ok(pool instanceof ReusablePool);
  });
});

describe("getPool (singleton)", () => {
  it("caches the constructed pool across calls", () => {
    const cfg = makeConfig();
    const a = getPool(cfg);
    const b = getPool(cfg);
    assert.strictEqual(a, b);
  });

  it("resetPool clears the cache so the next getPool reconstructs", () => {
    const a = getPool(makeConfig());
    resetPool();
    const b = getPool(makeConfig());
    assert.notStrictEqual(a, b);
  });

  it("setPool overrides the cache (used by tests)", () => {
    const stub = makeStubPool();
    setPool(stub);
    assert.strictEqual(getPool(makeConfig()), stub);
  });
});

describe("lazyDefaultPool proxy", () => {
  it("returns a WorkerPool-shaped object", () => {
    // The proxy itself is a one-line passthrough to getPool(getConfig()).method(...).
    // Integration coverage of the full flow lives in workflow.test.ts and monitor.test.ts.
    // Here we just verify the shape — that every WorkerPool method exists on the proxy.
    const proxy = lazyDefaultPool();
    assert.equal(typeof proxy.acquire, "function");
    assert.equal(typeof proxy.release, "function");
    assert.equal(typeof proxy.findByBranch, "function");
    assert.equal(typeof proxy.list, "function");
    assert.equal(typeof proxy.ensureMinimum, "function");
  });
});
