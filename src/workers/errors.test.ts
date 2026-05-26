import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { AlreadyInFlight, Cancelled, DirtyWorkerQuarantined, PoolExhausted } from "./errors.js";

describe("PoolExhausted", () => {
  it("includes repo, queue depth, and max in the message", () => {
    const err = new PoolExhausted("my-repo", 5, 5);
    assert.equal(err.name, "PoolExhausted");
    assert.match(err.message, /my-repo/);
    assert.match(err.message, /5\/5/);
  });

  it("is throwable and catchable as Error", () => {
    let caught: Error | null = null;
    try {
      throw new PoolExhausted("r", 1, 1);
    } catch (e) {
      caught = e as Error;
    }
    assert.ok(caught instanceof Error);
    assert.ok(caught instanceof PoolExhausted);
  });
});

describe("DirtyWorkerQuarantined", () => {
  it("exposes workerId and dirtyFiles", () => {
    const err = new DirtyWorkerQuarantined("worker-3", ["src/a.ts", "package.json"]);
    assert.equal(err.name, "DirtyWorkerQuarantined");
    assert.equal(err.workerId, "worker-3");
    assert.deepEqual(err.dirtyFiles, ["src/a.ts", "package.json"]);
  });

  it("includes dirty file count in the message", () => {
    const err = new DirtyWorkerQuarantined("w", ["a", "b", "c"]);
    assert.match(err.message, /3 file/);
  });

  it("handles an empty dirty file list", () => {
    const err = new DirtyWorkerQuarantined("w", []);
    assert.equal(err.dirtyFiles.length, 0);
    assert.match(err.message, /0 file/);
  });
});

describe("AlreadyInFlight", () => {
  it("includes repo, branch, and claimedBy in the message", () => {
    const err = new AlreadyInFlight("my-repo", "feat/x", "sess-123");
    assert.equal(err.name, "AlreadyInFlight");
    assert.match(err.message, /my-repo/);
    assert.match(err.message, /feat\/x/);
    assert.match(err.message, /sess-123/);
  });
});

describe("Cancelled", () => {
  it("uses default message when reason is omitted", () => {
    const err = new Cancelled();
    assert.equal(err.name, "Cancelled");
    assert.equal(err.message, "Cancelled");
    assert.equal(err.reason, undefined);
  });

  it("includes reason in the message when provided", () => {
    const err = new Cancelled("user pressed stop");
    assert.equal(err.reason, "user pressed stop");
    assert.match(err.message, /user pressed stop/);
  });
});
