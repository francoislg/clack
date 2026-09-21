import { describe, it, beforeEach } from "vitest";
import assert from "node:assert/strict";
import { getChannelInfo, clearChannelCache } from "./channelCache.js";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";

type ChannelInfoResponse = Awaited<ReturnType<MockSlackClient["conversations"]["info"]>>;

function makeClient(infoResult: ChannelInfoResponse = { ok: true, channel: { name: "general" } }) {
  const client = createSlackClientMock();
  client.conversations.info.mockResolvedValue(infoResult);
  return client;
}

describe("channelCache", () => {
  beforeEach(() => {
    clearChannelCache();
  });

  it("fetches channel info on cache miss", async () => {
    const client = makeClient({ ok: true, channel: { name: "backend-dev" } });
    const info = await getChannelInfo(client, "C123");

    assert.deepEqual(info, { id: "C123", name: "backend-dev" });
    assert.equal(client.conversations.info.mock.calls.length, 1);
  });

  it("returns cached value on cache hit without API call", async () => {
    const client = makeClient({ ok: true, channel: { name: "backend-dev" } });

    await getChannelInfo(client, "C123");
    const info = await getChannelInfo(client, "C123");

    assert.deepEqual(info, { id: "C123", name: "backend-dev" });
    assert.equal(client.conversations.info.mock.calls.length, 1);
  });

  it("returns undefined for a channelless sentinel without an API call", async () => {
    const client = makeClient();
    const result = await getChannelInfo(client, "channelless:37db6a68-4c9");

    assert.equal(result, undefined);
    assert.equal(client.conversations.info.mock.calls.length, 0);
  });

  it("returns undefined on API error", async () => {
    const client = createSlackClientMock();
    client.conversations.info.mockRejectedValue(new Error("channel_not_found"));

    const info = await getChannelInfo(client, "CBAD");
    assert.equal(info, undefined);
  });

  it("does not cache failures", async () => {
    const client = createSlackClientMock();
    client.conversations.info
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue({ ok: true, channel: { name: "recovered" } });

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

  it("captures is_private=true from the Slack API", async () => {
    const client = makeClient({
      ok: true,
      channel: { name: "secret-room", is_private: true },
    });
    const info = await getChannelInfo(client, "C777");
    assert.deepEqual(info, { id: "C777", name: "secret-room", isPrivate: true });
  });

  it("captures is_private=false from the Slack API", async () => {
    const client = makeClient({
      ok: true,
      channel: { name: "town-square", is_private: false },
    });
    const info = await getChannelInfo(client, "C888");
    assert.deepEqual(info, { id: "C888", name: "town-square", isPrivate: false });
  });

  it("captures a non-empty purpose from the Slack API", async () => {
    const client = makeClient({
      ok: true,
      channel: { name: "memes", purpose: { value: "Post your best memes" } },
    });
    const info = await getChannelInfo(client, "C999");
    assert.deepEqual(info, { id: "C999", name: "memes", purpose: "Post your best memes" });
  });

  it("omits purpose when the Slack API returns an empty string", async () => {
    const client = makeClient({
      ok: true,
      channel: { name: "general", purpose: { value: "" } },
    });
    const info = await getChannelInfo(client, "C111");
    assert.deepEqual(info, { id: "C111", name: "general" });
  });

  it("omits purpose when the Slack API omits it", async () => {
    const client = makeClient();
    const info = await getChannelInfo(client, "C222");
    assert.deepEqual(info, { id: "C222", name: "general" });
  });
});
