import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createPushableAsyncIterable } from "./pushableIterable.js";

describe("createPushableAsyncIterable", () => {
  it("yields buffered items in push order", async () => {
    const stream = createPushableAsyncIterable<string>();
    stream.push("a");
    stream.push("b");
    stream.end();

    const collected: string[] = [];
    for await (const item of stream) collected.push(item);
    assert.deepEqual(collected, ["a", "b"]);
  });

  it("waits for items pushed after iteration starts", async () => {
    const stream = createPushableAsyncIterable<number>();

    const collected: number[] = [];
    const iter = stream[Symbol.asyncIterator]();

    // Start a pending next() before any push
    const firstPromise = iter.next();
    stream.push(1);
    const first = await firstPromise;
    assert.equal(first.done, false);
    assert.equal(first.value, 1);
    collected.push(first.value);

    // Push then end
    stream.push(2);
    const second = await iter.next();
    collected.push(second.value!);

    stream.end();
    const third = await iter.next();
    assert.equal(third.done, true);

    assert.deepEqual(collected, [1, 2]);
  });

  it("end() resolves pending waiters with done", async () => {
    const stream = createPushableAsyncIterable<string>();
    const iter = stream[Symbol.asyncIterator]();
    const pending = iter.next();
    stream.end();
    const result = await pending;
    assert.equal(result.done, true);
  });

  it("push after end throws", () => {
    const stream = createPushableAsyncIterable<string>();
    stream.end();
    assert.throws(() => stream.push("x"), /ended/);
  });

  it("ended flag reflects state", () => {
    const stream = createPushableAsyncIterable<string>();
    assert.equal(stream.ended, false);
    stream.end();
    assert.equal(stream.ended, true);
  });

  it("end is idempotent", () => {
    const stream = createPushableAsyncIterable<string>();
    stream.end();
    stream.end();
    assert.equal(stream.ended, true);
  });

  it("iterator return() ends the stream", async () => {
    const stream = createPushableAsyncIterable<string>();
    const iter = stream[Symbol.asyncIterator]();
    if (iter.return) {
      await iter.return();
    }
    assert.equal(stream.ended, true);
  });
});
