import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ReactionsAddResponse } from "@slack/web-api";
import { addDeliveryReactions, type ReactionsClient } from "./messageReactions.js";

interface AddCall {
  channel: string;
  timestamp: string;
  name: string;
}

function makeFakeClient(behavior: (call: AddCall) => Promise<void> | void = async () => {}): {
  client: ReactionsClient;
  calls: AddCall[];
} {
  const calls: AddCall[] = [];
  const client: ReactionsClient = {
    reactions: {
      add: async (args) => {
        calls.push(args);
        await behavior(args);
        const response: ReactionsAddResponse = { ok: true };
        return response;
      },
    },
  };
  return { client, calls };
}

describe("addDeliveryReactions", () => {
  it("adds each emoji as a reaction in order", async () => {
    const { client, calls } = makeFakeClient();
    await addDeliveryReactions(
      client,
      "C123",
      "1700000000.000100",
      ["white_check_mark", "thumbsup"],
      0,
    );
    assert.deepEqual(calls, [
      { channel: "C123", timestamp: "1700000000.000100", name: "white_check_mark" },
      { channel: "C123", timestamp: "1700000000.000100", name: "thumbsup" },
    ]);
  });

  it("is a no-op for an empty reactions array", async () => {
    const { client, calls } = makeFakeClient();
    await addDeliveryReactions(client, "C123", "1700000000.000100", [], 0);
    assert.deepEqual(calls, []);
  });

  it("silently ignores already_reacted errors and continues", async () => {
    const { client, calls } = makeFakeClient(({ name }) => {
      if (name === "thumbsup") throw new Error("already_reacted");
    });
    await addDeliveryReactions(
      client,
      "C123",
      "1700000000.000100",
      ["white_check_mark", "thumbsup", "tada"],
      0,
    );
    assert.equal(calls.length, 3);
    assert.deepEqual(
      calls.map((c) => c.name),
      ["white_check_mark", "thumbsup", "tada"],
    );
  });

  it("continues after a non-already_reacted failure (warn-logged, does not throw)", async () => {
    const { client, calls } = makeFakeClient(({ name }) => {
      if (name === "thumbsup") throw new Error("invalid_name");
    });
    await addDeliveryReactions(
      client,
      "C123",
      "1700000000.000100",
      ["white_check_mark", "thumbsup", "tada"],
      0,
    );
    assert.equal(calls.length, 3);
  });
});
