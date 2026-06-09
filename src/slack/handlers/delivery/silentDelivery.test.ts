import { describe, it, expect, vi } from "vitest";
import type { App } from "@slack/bolt";
import type { Block } from "@slack/types";
import { SilentDelivery } from "./silentDelivery.js";

interface PostArg {
  channel: string;
  thread_ts?: string;
  text?: string;
  blocks?: Block[];
}

function makeClient() {
  const postMessage = vi.fn(async (_arg: PostArg) => ({ ok: true, ts: "555.000" }));
  const client: App["client"] = Object.assign(Object.create(null), {
    chat: { postMessage },
  });
  return { client, postMessage };
}

const SECTION: Block[] = [{ type: "section" }];

describe("SilentDelivery", () => {
  it("deliver posts with no thread_ts, reports notified:true, and records responseTs for blocks", async () => {
    const { client, postMessage } = makeClient();
    const recordResponseTs = vi.fn(async () => {});
    const handler = new SilentDelivery({ client, targetChannel: "C1", recordResponseTs });

    const res = await handler.deliver({ blocks: SECTION });
    expect(res).toEqual({ ok: true, ts: "555.000", notified: true });
    const arg = postMessage.mock.calls[0][0];
    expect(arg.channel).toBe("C1");
    expect(arg.thread_ts).toBeUndefined();
    expect(recordResponseTs).toHaveBeenCalledWith("555.000");
  });

  it("a raw-text delivery does not record responseTs", async () => {
    const { client } = makeClient();
    const recordResponseTs = vi.fn(async () => {});
    const handler = new SilentDelivery({ client, targetChannel: "C1", recordResponseTs });

    await handler.deliver({ markdownText: "just text" });
    expect(recordResponseTs).not.toHaveBeenCalled();
  });

  it("windUp / handleEvent / windDown are no-ops (no Slack calls)", async () => {
    const { client, postMessage } = makeClient();
    const handler = new SilentDelivery({
      client,
      targetChannel: "C1",
      recordResponseTs: async () => {},
    });

    await handler.windUp();
    handler.handleEvent();
    await handler.windDown();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
