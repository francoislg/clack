import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { WorkerQueue } from "./queue.js";
import { Cancelled } from "./errors.js";
import type { Worker } from "./types.js";

function makeFakeWorker(repo: string, id: string): Worker {
  return {
    id,
    repo,
    worktreePath: `/tmp/${repo}/${id}`,
    currentBranch: null,
    status: "idle",
    setupComplete: true,
    setupVersionHash: null,
    claimedBy: null,
    lastUsedAt: new Date(),
    createdAt: new Date(),
  };
}

/**
 * Enqueue but swallow the eventual rejection so the test process doesn't see
 * unhandled-rejection warnings from entries we never resolve. Returns the
 * promise in case the test wants to assert on its settlement.
 */
function park(q: WorkerQueue, repo: string, branch: string, sessionId: string): Promise<Worker> {
  const p = q.enqueueAndWait(repo, branch, sessionId);
  p.catch(() => {});
  return p;
}

describe("WorkerQueue.depth and list", () => {
  it("starts empty", () => {
    const q = new WorkerQueue();
    assert.equal(q.depth("repo-a"), 0);
    assert.equal(q.list().length, 0);
    assert.equal(q.list("repo-a").length, 0);
  });

  it("tracks depth per repo independently", () => {
    const q = new WorkerQueue();
    park(q, "repo-a", "feat/1", "s1");
    park(q, "repo-a", "feat/2", "s2");
    park(q, "repo-b", "feat/3", "s3");
    assert.equal(q.depth("repo-a"), 2);
    assert.equal(q.depth("repo-b"), 1);
    assert.equal(q.depth("repo-c"), 0);
  });

  it("list() returns entries across all repos", () => {
    const q = new WorkerQueue();
    park(q, "repo-a", "x", "sx");
    park(q, "repo-b", "y", "sy");
    const all = q.list();
    assert.equal(all.length, 2);
    const repos = all.map((e) => e.repo).sort();
    assert.deepEqual(repos, ["repo-a", "repo-b"]);
  });

  it("list(repo) returns only the repo's entries", () => {
    const q = new WorkerQueue();
    park(q, "repo-a", "x", "sx");
    park(q, "repo-b", "y", "sy");
    const onlyA = q.list("repo-a");
    assert.equal(onlyA.length, 1);
    assert.equal(onlyA[0]!.branch, "x");
  });
});

describe("WorkerQueue.dequeue (FIFO)", () => {
  it("returns null when the repo's queue is empty", () => {
    const q = new WorkerQueue();
    assert.equal(q.dequeue("repo-a"), null);
  });

  it("returns entries in insertion order", () => {
    const q = new WorkerQueue();
    park(q, "repo-a", "first", "s1");
    park(q, "repo-a", "second", "s2");
    park(q, "repo-a", "third", "s3");

    assert.equal(q.dequeue("repo-a")?.branch, "first");
    assert.equal(q.dequeue("repo-a")?.branch, "second");
    assert.equal(q.dequeue("repo-a")?.branch, "third");
    assert.equal(q.dequeue("repo-a"), null);
  });

  it("draining the queue prunes the per-repo slot (depth=0, list empty)", () => {
    const q = new WorkerQueue();
    park(q, "repo-a", "only", "s1");
    q.dequeue("repo-a");
    assert.equal(q.depth("repo-a"), 0);
    assert.equal(q.list("repo-a").length, 0);
  });

  it("dequeues from one repo without affecting another", () => {
    const q = new WorkerQueue();
    park(q, "repo-a", "a1", "s1");
    park(q, "repo-b", "b1", "s2");

    assert.equal(q.dequeue("repo-a")?.branch, "a1");
    assert.equal(q.depth("repo-b"), 1);
  });
});

describe("WorkerQueue.enqueueAndWait", () => {
  it("resolves with the worker when the entry is dequeued and resolved", async () => {
    const q = new WorkerQueue();
    const promise = q.enqueueAndWait("repo-a", "feat/x", "s1");

    const entry = q.dequeue("repo-a");
    assert.ok(entry);
    entry!.resolve(makeFakeWorker("repo-a", "worker-1"));

    const worker = await promise;
    assert.equal(worker.id, "worker-1");
  });

  it("rejects with Cancelled when the entry is rejected with Cancelled", async () => {
    const q = new WorkerQueue();
    const promise = q.enqueueAndWait("repo-a", "feat/x", "s1");
    const entry = q.dequeue("repo-a");
    assert.ok(entry);
    entry!.reject(new Cancelled("user-stop"));

    await assert.rejects(promise, (err) => {
      return err instanceof Cancelled && err.message.includes("user-stop");
    });
  });

  it("stamps enqueuedAt on each entry", () => {
    const q = new WorkerQueue();
    const before = Date.now();
    park(q, "repo-a", "feat/x", "s1");
    const after = Date.now();
    const entry = q.list("repo-a")[0]!;
    assert.ok(entry.enqueuedAt.getTime() >= before);
    assert.ok(entry.enqueuedAt.getTime() <= after);
  });
});

describe("WorkerQueue cancel()", () => {
  it("removes the entry from the queue and rejects the awaiter", async () => {
    const q = new WorkerQueue();
    const promise = q.enqueueAndWait("repo-a", "feat/x", "s1");
    const entry = q.list("repo-a")[0]!;

    entry.cancel("user-stop");

    assert.equal(q.depth("repo-a"), 0);
    await assert.rejects(promise, (err) => err instanceof Cancelled);
  });

  it("cancel is a no-op when entry was already dequeued", () => {
    const q = new WorkerQueue();
    park(q, "repo-a", "feat/x", "s1");
    const entry = q.dequeue("repo-a")!;

    assert.doesNotThrow(() => entry.cancel());
    assert.equal(q.depth("repo-a"), 0);
  });

  it("cancel preserves FIFO order for remaining entries", async () => {
    const q = new WorkerQueue();
    const p1 = park(q, "repo-a", "a", "s1");
    const p2 = q.enqueueAndWait("repo-a", "b", "s2");
    const p3 = park(q, "repo-a", "c", "s3");
    // Detach p1 and p3 from unhandled-rejection tracking; we'll never resolve them.
    p1.catch(() => {});
    p3.catch(() => {});

    const middle = q.list("repo-a")[1]!;
    middle.cancel();

    await assert.rejects(p2, (err) => err instanceof Cancelled);
    assert.equal(q.depth("repo-a"), 2);
    assert.equal(q.dequeue("repo-a")?.branch, "a");
    assert.equal(q.dequeue("repo-a")?.branch, "c");
  });
});

describe("WorkerQueue.findBySession", () => {
  it("returns null when the session is not queued", () => {
    const q = new WorkerQueue();
    assert.equal(q.findBySession("missing"), null);
  });

  it("finds an entry across repos", () => {
    const q = new WorkerQueue();
    park(q, "repo-a", "x", "s-target");
    park(q, "repo-b", "y", "s-other");

    const entry = q.findBySession("s-target");
    assert.ok(entry);
    assert.equal(entry!.repo, "repo-a");
  });
});
