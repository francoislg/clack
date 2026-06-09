import { describe, it, expect, vi } from "vitest";
import type { App } from "@slack/bolt";
import type { Block } from "@slack/types";
import { StreamingDelivery } from "./streamingDelivery.js";
import type { StreamerLike } from "./types.js";

function makeStreamerMock(overrides?: {
  hasFailed?: boolean;
  messageTs?: string;
  allMessageTss?: string[];
}) {
  const failed = overrides?.hasFailed ?? false;
  const mock = {
    start: vi.fn(async () => true),
    handleEvent: vi.fn(),
    stop: vi.fn(async () => {}),
    getMessageTs: vi.fn(() => overrides?.messageTs ?? "111.222"),
    getAllMessageTss: vi.fn(() => overrides?.allMessageTss ?? ["111.222"]),
    get hasFailed() {
      return failed;
    },
  };
  const streamer: StreamerLike = mock;
  return { streamer, mock };
}

interface PostArg {
  channel: string;
  thread_ts?: string;
  text?: string;
  blocks?: Block[];
}

function makeClient() {
  const postMessage = vi.fn(async (_arg: PostArg) => ({ ok: true, ts: "999.000" }));
  const remove = vi.fn(async (_arg: { channel: string; ts: string }) => ({ ok: true }));
  // Object.create(null) is `any`, so Object.assign yields a value assignable to the client
  // type without a cast — only the methods the handler touches need to exist.
  const client: App["client"] = Object.assign(Object.create(null), {
    chat: { postMessage, delete: remove },
  });
  return { client, postMessage, remove };
}

const SECTION: Block[] = [{ type: "section" }];

describe("StreamingDelivery", () => {
  it("windUp constructs and starts the streamer; handleEvent forwards", async () => {
    const { streamer, mock } = makeStreamerMock();
    const { client } = makeClient();
    const handler = new StreamingDelivery({
      client,
      targetChannel: "C1",
      targetThread: "T1",
      makeStreamer: async () => streamer,
    });

    await handler.windUp();
    expect(mock.start).toHaveBeenCalledTimes(1);

    handler.handleEvent({ type: "text", text: "hi" });
    expect(mock.handleEvent).toHaveBeenCalledTimes(1);
  });

  it("deliver finalizes the card in place and reports notified:false", async () => {
    const { streamer, mock } = makeStreamerMock({ messageTs: "abc.def" });
    const { client, postMessage } = makeClient();
    const handler = new StreamingDelivery({
      client,
      targetChannel: "C1",
      targetThread: "T1",
      makeStreamer: async () => streamer,
    });
    await handler.windUp();

    const res = await handler.deliver({ blocks: SECTION });
    expect(res).toEqual({ ok: true, ts: "abc.def", notified: false });
    expect(mock.stop).toHaveBeenCalledWith({ blocks: SECTION });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("deliver with markdownText finalizes the card in place with that text", async () => {
    const { streamer, mock } = makeStreamerMock({ messageTs: "md.1" });
    const { client } = makeClient();
    const handler = new StreamingDelivery({
      client,
      targetChannel: "C1",
      targetThread: "T1",
      makeStreamer: async () => streamer,
    });
    await handler.windUp();

    const res = await handler.deliver({ markdownText: "raw text" });
    expect(res).toEqual({ ok: true, ts: "md.1", notified: false });
    expect(mock.stop).toHaveBeenCalledWith({ markdownText: "raw text" });
  });

  it("windUp never throws when the streamer fails to open; deliver degrades to one-shot posting", async () => {
    const { client, postMessage } = makeClient();
    const handler = new StreamingDelivery({
      client,
      targetChannel: "C1",
      targetThread: "T1",
      makeStreamer: async () => {
        throw new Error("auth.test failed");
      },
    });

    await handler.windUp(); // must NOT throw
    const res = await handler.deliver({ blocks: SECTION });
    expect(res).toEqual({ ok: true, ts: "999.000", notified: true });
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it("deliver falls back to chat.postMessage (with thread_ts) when the streamer failed", async () => {
    const { streamer } = makeStreamerMock({ hasFailed: true });
    const { client, postMessage } = makeClient();
    const handler = new StreamingDelivery({
      client,
      targetChannel: "C1",
      targetThread: "T1",
      makeStreamer: async () => streamer,
    });
    await handler.windUp();

    const res = await handler.deliver({ blocks: SECTION });
    expect(res).toEqual({ ok: true, ts: "999.000", notified: true });
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage.mock.calls[0][0]).toMatchObject({ channel: "C1", thread_ts: "T1" });
  });

  it("windDown({ discard: true }) stops and removes every opened message", async () => {
    const { streamer, mock } = makeStreamerMock({ allMessageTss: ["1.1", "2.2"] });
    const { client, remove } = makeClient();
    const handler = new StreamingDelivery({
      client,
      targetChannel: "C1",
      targetThread: "T1",
      makeStreamer: async () => streamer,
    });
    await handler.windUp();

    await handler.windDown({ discard: true });
    expect(mock.stop).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(remove.mock.calls.map((c) => c[0].ts)).toEqual(["1.1", "2.2"]);
  });

  it("windDown() without discard stops but removes nothing (freeze)", async () => {
    const { streamer, mock } = makeStreamerMock({ allMessageTss: ["1.1"] });
    const { client, remove } = makeClient();
    const handler = new StreamingDelivery({
      client,
      targetChannel: "C1",
      targetThread: "T1",
      makeStreamer: async () => streamer,
    });
    await handler.windUp();

    await handler.windDown();
    expect(mock.stop).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
