import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deleteClackMessage, type AdminDeleteMessageDeps } from "./adminDeleteMessage.js";

const CLACK_BOT_ID = "B_CLACK";
const CHANNEL_ID = "C123ABC";
const MSG_TS = "1234567890.123456";
const THREAD_TS = "1234500000.000000";

// Valid top-level message permalink: channel=C123ABC, ts=1234567890.123456
// Slack encodes ts as p<digits without dot>, so p1234567890123456
const TOP_LEVEL_URL = `https://workspace.slack.com/archives/${CHANNEL_ID}/p1234567890123456`;

// Thread reply permalink includes ?thread_ts=...
const THREAD_REPLY_URL = `https://workspace.slack.com/archives/${CHANNEL_ID}/p1234567890123456?thread_ts=${THREAD_TS}&cid=${CHANNEL_ID}`;

function makeDeps(overrides: Partial<AdminDeleteMessageDeps> = {}): AdminDeleteMessageDeps {
  return {
    authTest: async () => ({ bot_id: CLACK_BOT_ID }),
    conversationsReplies: async () => ({
      messages: [{ ts: MSG_TS, bot_id: CLACK_BOT_ID }],
    }),
    conversationsHistory: async () => ({
      messages: [{ bot_id: CLACK_BOT_ID }],
    }),
    chatDelete: async () => undefined,
    ...overrides,
  };
}

describe("deleteClackMessage", () => {
  describe("auth failure", () => {
    it("returns error when auth.test returns no bot_id", async () => {
      const result = await deleteClackMessage(
        TOP_LEVEL_URL,
        makeDeps({ authTest: async () => ({}) }),
      );
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.includes("auth.test returned no bot_id"));
    });

    it("returns error when auth.test throws", async () => {
      const result = await deleteClackMessage(
        TOP_LEVEL_URL,
        makeDeps({
          authTest: async () => {
            throw new Error("invalid_auth");
          },
        }),
      );
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.includes("Failed to verify Clack's identity"));
    });
  });

  describe("invalid URL", () => {
    it("returns error for a non-Slack URL", async () => {
      const result = await deleteClackMessage("https://example.com/not-slack", makeDeps());
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.includes("Could not parse the URL"));
    });

    it("returns error for a plain string", async () => {
      const result = await deleteClackMessage("not a url at all", makeDeps());
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.includes("Could not parse the URL"));
    });
  });

  describe("message not found", () => {
    it("returns error when conversations.history returns empty messages array", async () => {
      const result = await deleteClackMessage(
        TOP_LEVEL_URL,
        makeDeps({ conversationsHistory: async () => ({ messages: [] }) }),
      );
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.includes("Message not found"));
      assert.ok(!result.ok && result.error.includes("ephemeral"));
    });

    it("returns error when conversations.history returns undefined messages", async () => {
      const result = await deleteClackMessage(
        TOP_LEVEL_URL,
        makeDeps({ conversationsHistory: async () => ({}) }),
      );
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.includes("Message not found"));
    });

    it("returns error when thread reply ts is not found among replies", async () => {
      const result = await deleteClackMessage(
        THREAD_REPLY_URL,
        makeDeps({
          conversationsReplies: async () => ({
            messages: [{ ts: "9999999999.000000", bot_id: CLACK_BOT_ID }],
          }),
        }),
      );
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.includes("Message not found"));
    });
  });

  describe("not Clack's message", () => {
    it("returns error when bot_id does not match Clack's bot ID", async () => {
      const result = await deleteClackMessage(
        TOP_LEVEL_URL,
        makeDeps({
          conversationsHistory: async () => ({ messages: [{ bot_id: "B_OTHER_BOT" }] }),
        }),
      );
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.includes("not posted by Clack"));
    });

    it("returns error when message has no bot_id (human message)", async () => {
      const result = await deleteClackMessage(
        TOP_LEVEL_URL,
        makeDeps({
          conversationsHistory: async () => ({ messages: [{}] }),
        }),
      );
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.includes("not posted by Clack"));
    });
  });

  describe("not in channel", () => {
    it("returns error when conversations.history throws not_in_channel", async () => {
      const result = await deleteClackMessage(
        TOP_LEVEL_URL,
        makeDeps({
          conversationsHistory: async () => {
            throw new Error("An API error occurred: not_in_channel");
          },
        }),
      );
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.includes("not a member of that channel"));
    });

    it("returns error when conversations.replies throws not_in_channel", async () => {
      const result = await deleteClackMessage(
        THREAD_REPLY_URL,
        makeDeps({
          conversationsReplies: async () => {
            throw new Error("not_in_channel");
          },
        }),
      );
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.includes("not a member of that channel"));
    });

    it("surfaces generic fetch errors", async () => {
      const result = await deleteClackMessage(
        TOP_LEVEL_URL,
        makeDeps({
          conversationsHistory: async () => {
            throw new Error("channel_not_found");
          },
        }),
      );
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.includes("Failed to fetch message"));
    });
  });

  describe("already deleted", () => {
    it("returns error when chat.delete throws message_not_found", async () => {
      const result = await deleteClackMessage(
        TOP_LEVEL_URL,
        makeDeps({
          chatDelete: async () => {
            throw new Error("message_not_found");
          },
        }),
      );
      assert.equal(result.ok, false);
      assert.ok(!result.ok && result.error.includes("already deleted"));
    });
  });

  describe("successful deletion", () => {
    it("returns ok=true with channel and ts for a top-level message", async () => {
      const deleteCalls: Array<{ channel: string; ts: string }> = [];
      const result = await deleteClackMessage(
        TOP_LEVEL_URL,
        makeDeps({
          chatDelete: async (params) => {
            deleteCalls.push(params);
          },
        }),
      );
      assert.equal(result.ok, true);
      assert.ok(result.ok && result.channel === CHANNEL_ID);
      assert.ok(result.ok && result.ts === MSG_TS);
      assert.equal(deleteCalls.length, 1);
      assert.equal(deleteCalls[0]?.channel, CHANNEL_ID);
      assert.equal(deleteCalls[0]?.ts, MSG_TS);
    });

    it("uses conversations.history (not replies) for top-level messages", async () => {
      let historyCalled = false;
      let repliesCalled = false;
      const result = await deleteClackMessage(
        TOP_LEVEL_URL,
        makeDeps({
          conversationsHistory: async (params) => {
            historyCalled = true;
            assert.equal(params.channel, CHANNEL_ID);
            assert.equal(params.oldest, MSG_TS);
            assert.equal(params.latest, MSG_TS);
            assert.equal(params.inclusive, true);
            return { messages: [{ bot_id: CLACK_BOT_ID }] };
          },
          conversationsReplies: async () => {
            repliesCalled = true;
            return { messages: [] };
          },
        }),
      );
      assert.equal(result.ok, true);
      assert.equal(historyCalled, true);
      assert.equal(repliesCalled, false);
    });

    it("returns ok=true with correct ts for a thread reply", async () => {
      const deleteCalls: Array<{ channel: string; ts: string }> = [];
      const result = await deleteClackMessage(
        THREAD_REPLY_URL,
        makeDeps({
          conversationsReplies: async (params) => {
            assert.equal(params.channel, CHANNEL_ID);
            assert.equal(params.ts, THREAD_TS);
            return { messages: [{ ts: MSG_TS, bot_id: CLACK_BOT_ID }] };
          },
          chatDelete: async (params) => {
            deleteCalls.push(params);
          },
        }),
      );
      assert.equal(result.ok, true);
      assert.ok(result.ok && result.ts === MSG_TS);
      assert.equal(deleteCalls.length, 1);
      assert.equal(deleteCalls[0]?.ts, MSG_TS);
    });

    it("uses conversations.replies (not history) for thread replies", async () => {
      let historyCalled = false;
      let repliesCalled = false;
      await deleteClackMessage(
        THREAD_REPLY_URL,
        makeDeps({
          conversationsHistory: async () => {
            historyCalled = true;
            return { messages: [] };
          },
          conversationsReplies: async () => {
            repliesCalled = true;
            return { messages: [{ ts: MSG_TS, bot_id: CLACK_BOT_ID }] };
          },
        }),
      );
      assert.equal(repliesCalled, true);
      assert.equal(historyCalled, false);
    });
  });
});
