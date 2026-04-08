import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { getChannelInfo, clearChannelCache } from "./channelCache.js";

function makeClient(infoResult?: unknown) {
  return {
    conversations: {
      info: mock.fn(async () => infoResult ?? { ok: true, channel: { name: "general" } }),
    },
  } as unknown as import("@slack/bolt").App["client"];
}

describe("channelCache", () => {
  beforeEach(() => {
    clearChannelCache();
  });

  it("fetches channel info on cache miss", async () => {
    const client = makeClient({ ok: true, channel: { name: "backend-dev" } });
    const info = await getChannelInfo(client, "C123");

    assert.deepEqual(info, { id: "C123", name: "backend-dev" });
    assert.equal(
      (client.conversations.info as unknown as ReturnType<typeof mock.fn>).mock.calls.length,
      1,
    );
  });

  it("returns cached value on cache hit without API call", async () => {
    const client = makeClient({ ok: true, channel: { name: "backend-dev" } });

    await getChannelInfo(client, "C123");
    const info = await getChannelInfo(client, "C123");

    assert.deepEqual(info, { id: "C123", name: "backend-dev" });
    assert.equal(
      (client.conversations.info as unknown as ReturnType<typeof mock.fn>).mock.calls.length,
      1,
    );
  });

  it("returns undefined on API error", async () => {
    const client = {
      conversations: {
        info: mock.fn(async () => {
          throw new Error("channel_not_found");
        }),
      },
    } as unknown as import("@slack/bolt").App["client"];

    const info = await getChannelInfo(client, "CBAD");
    assert.equal(info, undefined);
  });

  it("does not cache failures", async () => {
    let callCount = 0;
    const client = {
      conversations: {
        info: mock.fn(async () => {
          callCount++;
          if (callCount === 1) throw new Error("transient");
          return { ok: true, channel: { name: "recovered" } };
        }),
      },
    } as unknown as import("@slack/bolt").App["client"];

    const first = await getChannelInfo(client, "C456");
    assert.equal(first, undefined);

    const second = await getChannelInfo(client, "C456");
    assert.deepEqual(second, { id: "C456", name: "recovered" });
  });

  it("returns undefined when API returns not ok", async () => {
    const client = makeClient({ ok: false, error: "not_found" });
    const info = await getChannelInfo(client, "CBAD");
    assert.equal(info, undefined);
  });
});
