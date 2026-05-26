import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { PerThreadContextStore, type ContextStoreArgs } from "./assistantContextStore.js";

type BoltPayload = ContextStoreArgs["payload"];

function threadChangedPayload(
  channel: string,
  thread: string,
  viewing: string | undefined,
): BoltPayload {
  return {
    type: "assistant_thread_context_changed",
    assistant_thread: {
      user_id: "U_TEST",
      context: viewing ? { channel_id: viewing } : {},
      channel_id: channel,
      thread_ts: thread,
    },
    event_ts: "1700000000.000001",
  };
}

function messagePayload(channel: string, thread: string): BoltPayload {
  return {
    type: "message",
    subtype: undefined,
    event_ts: "1700000000.000002",
    channel,
    user: "U_TEST",
    ts: "1700000000.000002",
    channel_type: "im",
    thread_ts: thread,
  };
}

function threadArgs(
  channel: string,
  thread: string,
  viewing: string | undefined,
): ContextStoreArgs {
  return { payload: threadChangedPayload(channel, thread, viewing) };
}

function messageArgs(channel: string, thread: string): ContextStoreArgs {
  return { payload: messagePayload(channel, thread) };
}

describe("PerThreadContextStore", () => {
  it("returns empty context for an unknown thread", async () => {
    const store = new PerThreadContextStore();
    const ctx = await store.get(messageArgs("D001", "1"));
    assert.deepEqual(ctx, {});
  });

  it("returns the context saved for the same thread", async () => {
    const store = new PerThreadContextStore();
    await store.save(threadArgs("D001", "1", "C-VIEWING"));
    const ctx = await store.get(messageArgs("D001", "1"));
    assert.deepEqual(ctx, { channel_id: "C-VIEWING" });
  });

  it("isolates contexts across different threads (regression: cross-user bleed)", async () => {
    const store = new PerThreadContextStore();
    await store.save(threadArgs("D-FRANCOIS", "10", "C-CHANNEL-A"));
    await store.save(threadArgs("D-JONATHAN", "20", "C-CHANNEL-B"));

    const francois = await store.get(messageArgs("D-FRANCOIS", "10"));
    const jonathan = await store.get(messageArgs("D-JONATHAN", "20"));

    assert.deepEqual(francois, { channel_id: "C-CHANNEL-A" });
    assert.deepEqual(jonathan, { channel_id: "C-CHANNEL-B" });
  });

  it("updates context for the same thread without touching others", async () => {
    const store = new PerThreadContextStore();
    await store.save(threadArgs("D-A", "1", "C-OLD"));
    await store.save(threadArgs("D-B", "2", "C-OTHER"));
    await store.save(threadArgs("D-A", "1", "C-NEW"));

    assert.deepEqual(await store.get(messageArgs("D-A", "1")), {
      channel_id: "C-NEW",
    });
    assert.deepEqual(await store.get(messageArgs("D-B", "2")), {
      channel_id: "C-OTHER",
    });
  });

  it("keys threads by both channel and thread_ts", async () => {
    const store = new PerThreadContextStore();
    await store.save(threadArgs("D-A", "1", "C-FIRST"));
    await store.save(threadArgs("D-A", "2", "C-SECOND"));

    assert.deepEqual(await store.get(messageArgs("D-A", "1")), {
      channel_id: "C-FIRST",
    });
    assert.deepEqual(await store.get(messageArgs("D-A", "2")), {
      channel_id: "C-SECOND",
    });
  });
});
