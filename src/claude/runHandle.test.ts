import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRunHandle } from "./runHandle.js";

interface DriverHarness {
  pushed: string[];
  readonly closeCount: number;
  driver: ReturnType<typeof createRunHandle>;
}

function makeDriver(opts: { onTerminal?: () => void } = {}): DriverHarness {
  const pushed: string[] = [];
  let closeCount = 0;
  const driver = createRunHandle({
    push: (text) => {
      pushed.push(text);
    },
    closeInput: () => {
      closeCount++;
    },
    ...(opts.onTerminal && { onTerminal: opts.onTerminal }),
  });
  return {
    pushed,
    get closeCount() {
      return closeCount;
    },
    driver,
  };
}

describe("createRunHandle — sendUpdate", () => {
  it("calls the push callback with the text", async () => {
    const h = makeDriver();
    await h.driver.sendUpdate("hello");
    await h.driver.sendUpdate("world");
    assert.deepEqual(h.pushed, ["hello", "world"]);
  });

  it("rejects after settle", async () => {
    const h = makeDriver();
    h.driver.settle({ success: true, answer: "done" });
    await assert.rejects(h.driver.sendUpdate("late"), /settled/);
  });

  it("rejects after stop", async () => {
    const h = makeDriver();
    await h.driver.stop("user");
    await assert.rejects(h.driver.sendUpdate("late"), /stopped/);
  });

  it("rejects after fail", async () => {
    const h = makeDriver();
    h.driver.fail(new Error("boom"));
    await assert.rejects(h.driver.sendUpdate("late"), /settled/);
  });
});

describe("createRunHandle — settle", () => {
  it("resolves futureResponse with the provided response", async () => {
    const h = makeDriver();
    const response = { success: true, answer: "ok" };
    h.driver.settle(response);
    const result = await h.driver.futureResponse;
    assert.deepEqual(result, response);
    assert.equal(h.driver.status, "settled");
  });

  it("calls closeInput exactly once", () => {
    const h = makeDriver();
    h.driver.settle({ success: true, answer: "ok" });
    h.driver.settle({ success: true, answer: "again" });
    assert.equal(h.closeCount, 1);
  });

  it("is idempotent — second settle does not change futureResponse", async () => {
    const h = makeDriver();
    h.driver.settle({ success: true, answer: "first" });
    h.driver.settle({ success: true, answer: "second" });
    const result = await h.driver.futureResponse;
    assert.equal(result.answer, "first");
  });

  it("fires onTerminal exactly once", () => {
    let count = 0;
    const h = makeDriver({ onTerminal: () => count++ });
    h.driver.settle({ success: true, answer: "ok" });
    h.driver.settle({ success: true, answer: "again" });
    assert.equal(count, 1);
  });
});

describe("createRunHandle — stop", () => {
  it("resolves futureResponse with cancelled=true and the reason", async () => {
    const h = makeDriver();
    await h.driver.stop("user requested");
    const result = await h.driver.futureResponse;
    assert.equal(result.cancelled, true);
    assert.equal(result.error, "user requested");
    assert.equal(h.driver.status, "stopped");
  });

  it("aborts the AbortController", async () => {
    const h = makeDriver();
    assert.equal(h.driver.abortController.signal.aborted, false);
    await h.driver.stop();
    assert.equal(h.driver.abortController.signal.aborted, true);
  });

  it("is idempotent after settle (no transition)", async () => {
    const h = makeDriver();
    h.driver.settle({ success: true, answer: "done" });
    await h.driver.stop("late");
    const result = await h.driver.futureResponse;
    assert.equal(result.success, true);
    assert.equal(h.driver.status, "settled");
  });

  it("fires onTerminal exactly once", async () => {
    let count = 0;
    const h = makeDriver({ onTerminal: () => count++ });
    await h.driver.stop();
    await h.driver.stop();
    assert.equal(count, 1);
  });
});

describe("createRunHandle — fail", () => {
  it("maps abort errors to cancelled responses", async () => {
    const h = makeDriver();
    h.driver.abortController.abort();
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    h.driver.fail(abortError);
    const result = await h.driver.futureResponse;
    assert.equal(result.cancelled, true);
  });

  it("maps non-abort errors to error responses", async () => {
    const h = makeDriver();
    h.driver.fail(new Error("broken"));
    const result = await h.driver.futureResponse;
    assert.equal(result.success, false);
    assert.equal(result.cancelled, undefined);
    assert.match(result.error ?? "", /broken/);
  });

  it("is idempotent", async () => {
    const h = makeDriver();
    h.driver.fail(new Error("first"));
    h.driver.fail(new Error("second"));
    const result = await h.driver.futureResponse;
    assert.match(result.error ?? "", /first/);
  });

  it("calls closeInput exactly once", () => {
    const h = makeDriver();
    h.driver.fail(new Error("boom"));
    h.driver.fail(new Error("again"));
    assert.equal(h.closeCount, 1);
  });
});
