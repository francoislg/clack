import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import {
  isChannelId,
  isUserId,
  openDmChannel,
  resolveChannelId,
  type ChannelResolverClient,
  type ResolveChannelContext,
} from "./channelResolver.js";

function buildCtx(client: ChannelResolverClient, userId = "U123"): ResolveChannelContext {
  return { client, userId };
}

describe("isChannelId", () => {
  it("accepts C/G/D prefixes", () => {
    assert.equal(isChannelId("C0123ABCDEF"), true);
    assert.equal(isChannelId("G0123ABCDEF"), true);
    assert.equal(isChannelId("D0123ABCDEF"), true);
  });

  it("rejects U prefix (user ID, not channel ID)", () => {
    assert.equal(isChannelId("U0123ABCDEF"), false);
  });

  it("rejects names", () => {
    assert.equal(isChannelId("general"), false);
    assert.equal(isChannelId("#general"), false);
  });

  it("rejects lowercase", () => {
    assert.equal(isChannelId("c0123abcdef"), false);
  });

  it("rejects empty and single-char", () => {
    assert.equal(isChannelId(""), false);
    assert.equal(isChannelId("C"), false);
  });
});

describe("isUserId", () => {
  it("accepts U prefix", () => {
    assert.equal(isUserId("U0123ABCDEF"), true);
  });

  it("rejects channel prefixes", () => {
    assert.equal(isUserId("C0123ABCDEF"), false);
    assert.equal(isUserId("D0123ABCDEF"), false);
    assert.equal(isUserId("G0123ABCDEF"), false);
  });

  it("rejects names", () => {
    assert.equal(isUserId("alice"), false);
  });

  it("is disjoint from isChannelId", () => {
    const samples = ["C0ABC123", "G0ABC123", "D0ABC123", "U0ABC123"];
    for (const s of samples) {
      assert.notEqual(
        isChannelId(s),
        isUserId(s),
        `${s} should be classified as exactly one of channel/user`,
      );
    }
  });
});

describe("openDmChannel", () => {
  it("returns the DM channel ID on success", async () => {
    const client: ChannelResolverClient = {
      conversations: {
        open: async () => ({ channel: { id: "D999" } }),
        list: async () => ({ channels: [] }),
      },
    };
    const result = await openDmChannel(client, "U123");
    assert.equal(result, "D999");
  });

  it("returns null when the response has no channel", async () => {
    const client: ChannelResolverClient = {
      conversations: {
        open: async () => ({}),
        list: async () => ({ channels: [] }),
      },
    };
    const result = await openDmChannel(client, "U123");
    assert.equal(result, null);
  });

  it("returns null and does not throw on API error", async () => {
    const client: ChannelResolverClient = {
      conversations: {
        open: async () => {
          throw new Error("user_not_found");
        },
        list: async () => ({ channels: [] }),
      },
    };
    const result = await openDmChannel(client, "Uxxx");
    assert.equal(result, null);
  });
});

describe("resolveChannelId", () => {
  function buildClient(
    overrides: Partial<ChannelResolverClient["conversations"]>,
  ): ChannelResolverClient {
    return {
      conversations: {
        open: async () => ({ channel: { id: "D999" } }),
        list: async () => ({ channels: [] }),
        ...overrides,
      },
    };
  }

  it("passes channel IDs through unchanged", async () => {
    const result = await resolveChannelId(buildCtx(buildClient({})), "C0123ABCDEF");
    assert.deepEqual(result, { ok: true, channelId: "C0123ABCDEF" });
  });

  it("passes DM channel IDs through unchanged", async () => {
    const result = await resolveChannelId(buildCtx(buildClient({})), "D0123ABCDEF");
    assert.deepEqual(result, { ok: true, channelId: "D0123ABCDEF" });
  });

  it("resolves a channel name via conversations.list", async () => {
    const client = buildClient({
      list: async () => ({ channels: [{ id: "C456", name: "engineering" }] }),
    });
    const result = await resolveChannelId(buildCtx(client), "#engineering");
    assert.deepEqual(result, { ok: true, channelId: "C456" });
  });

  it("strips leading # before name lookup", async () => {
    const client = buildClient({
      list: async () => ({ channels: [{ id: "C456", name: "engineering" }] }),
    });
    const result = await resolveChannelId(buildCtx(client), "engineering");
    assert.deepEqual(result, { ok: true, channelId: "C456" });
  });

  it("returns error when channel name is not found", async () => {
    const client = buildClient({
      list: async () => ({ channels: [] }),
    });
    const result = await resolveChannelId(buildCtx(client), "#nope");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Could not find channel/);
  });

  it("returns error when conversations.list throws", async () => {
    const client = buildClient({
      list: async () => {
        throw new Error("boom");
      },
    });
    const result = await resolveChannelId(buildCtx(client), "#engineering");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Failed to resolve channel name/);
  });

  it("opens a DM when the user ID matches ctx.userId", async () => {
    const client = buildClient({
      open: async () => ({ channel: { id: "D999" } }),
    });
    const result = await resolveChannelId(buildCtx(client, "U123"), "U123");
    assert.deepEqual(result, { ok: true, channelId: "D999" });
  });

  it("rejects a user ID that does not match ctx.userId", async () => {
    const openSpy = vi.fn(async (_args: { users: string }) => ({
      channel: { id: "DXXX" },
    }));
    const client: ChannelResolverClient = {
      conversations: {
        open: openSpy,
        list: async () => ({ channels: [] }),
      },
    };
    const result = await resolveChannelId(buildCtx(client, "U123"), "U999");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /can only DM the requesting user/);
    assert.equal(openSpy.mock.calls.length, 0);
  });

  it("returns error when opening the self-DM fails", async () => {
    const client = buildClient({
      open: async () => {
        throw new Error("boom");
      },
    });
    const result = await resolveChannelId(buildCtx(client, "U123"), "U123");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /Failed to open DM channel/);
  });
});
