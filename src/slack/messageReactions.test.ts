import { describe, it, beforeEach, vi } from "vitest";
import assert from "node:assert/strict";
import { logger } from "../logger.js";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";
import { addDeliveryReactions, removeDeliveryReaction } from "./messageReactions.js";

describe("addDeliveryReactions", () => {
  let client: MockSlackClient;

  beforeEach(() => {
    client = createSlackClientMock();
  });

  it("adds each emoji as a reaction in order", async () => {
    await addDeliveryReactions(
      client,
      "C123",
      "1700000000.000100",
      ["white_check_mark", "thumbsup"],
      0,
    );
    assert.deepEqual(
      client.reactions.add.mock.calls.map((c) => c[0]),
      [
        { channel: "C123", timestamp: "1700000000.000100", name: "white_check_mark" },
        { channel: "C123", timestamp: "1700000000.000100", name: "thumbsup" },
      ],
    );
  });

  it("is a no-op for an empty reactions array", async () => {
    await addDeliveryReactions(client, "C123", "1700000000.000100", [], 0);
    assert.equal(client.reactions.add.mock.calls.length, 0);
  });

  it("silently ignores already_reacted errors and continues", async () => {
    client.reactions.add.mockImplementation(async ({ name }) => {
      if (name === "thumbsup") throw new Error("already_reacted");
      return { ok: true };
    });
    await addDeliveryReactions(
      client,
      "C123",
      "1700000000.000100",
      ["white_check_mark", "thumbsup", "tada"],
      0,
    );
    assert.deepEqual(
      client.reactions.add.mock.calls.map((c) => c[0].name),
      ["white_check_mark", "thumbsup", "tada"],
    );
  });

  it("continues after a non-already_reacted failure (warn-logged, does not throw)", async () => {
    client.reactions.add.mockImplementation(async ({ name }) => {
      if (name === "thumbsup") throw new Error("invalid_name");
      return { ok: true };
    });
    await addDeliveryReactions(
      client,
      "C123",
      "1700000000.000100",
      ["white_check_mark", "thumbsup", "tada"],
      0,
    );
    assert.equal(client.reactions.add.mock.calls.length, 3);
  });
});

describe("removeDeliveryReaction", () => {
  let client: MockSlackClient;

  beforeEach(() => {
    client = createSlackClientMock();
  });

  it("calls reactions.remove with { channel, timestamp, name }", async () => {
    await removeDeliveryReaction(client, "C123", "1700000000.000100", "eyes");
    assert.deepEqual(client.reactions.remove.mock.calls[0][0], {
      channel: "C123",
      timestamp: "1700000000.000100",
      name: "eyes",
    });
  });

  it("resolves and does not warn on a no_reaction error", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    client.reactions.remove.mockRejectedValue(new Error("no_reaction"));
    await removeDeliveryReaction(client, "C123", "1700000000.000100", "eyes");
    assert.equal(warn.mock.calls.length, 0);
  });

  it("resolves and warns on any other error", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
    client.reactions.remove.mockRejectedValue(new Error("invalid_name"));
    await removeDeliveryReaction(client, "C123", "1700000000.000100", "eyes");
    assert.equal(warn.mock.calls.length, 1);
  });
});
