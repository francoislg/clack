import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  postStructuredMessage,
  notificationText,
  type MessagePostingClient,
} from "./messagePoster.js";
import type { SlackBlocks } from "./blocks.js";

interface PostCall {
  channel: string;
  text: string;
  blocks: SlackBlocks;
  thread_ts?: string;
  unfurl_links?: false;
  unfurl_media?: false;
}

interface LinkCall {
  channel: string;
  message_ts: string;
}

interface FakeClientOpts {
  postTs?: string;
  postError?: Error;
  permalink?: string;
  permalinkError?: Error;
}

interface FakeClient extends MessagePostingClient {
  postCalls: PostCall[];
  linkCalls: LinkCall[];
}

function makeClient(opts: FakeClientOpts = {}): FakeClient {
  const postCalls: PostCall[] = [];
  const linkCalls: LinkCall[] = [];
  return {
    postCalls,
    linkCalls,
    chat: {
      postMessage: async (args) => {
        postCalls.push(args);
        if (opts.postError) throw opts.postError;
        return { ts: opts.postTs };
      },
      getPermalink: async (args) => {
        linkCalls.push(args);
        if (opts.permalinkError) throw opts.permalinkError;
        return { permalink: opts.permalink };
      },
    },
  };
}

const sampleBlocks: SlackBlocks = [
  { type: "section", text: { type: "mrkdwn", text: "hello world" } },
];

describe("notificationText", () => {
  it("returns short block text unchanged", () => {
    assert.equal(notificationText(sampleBlocks), "hello world");
  });

  it("truncates strings longer than 500 chars with ellipsis", () => {
    const long = "a".repeat(800);
    const blocks: SlackBlocks = [{ type: "section", text: { type: "mrkdwn", text: long } }];
    const out = notificationText(blocks);
    assert.equal(out.length, 500);
    assert.ok(out.endsWith("..."));
  });

  it("does not truncate at exactly 500 chars", () => {
    const exact = "b".repeat(500);
    const blocks: SlackBlocks = [{ type: "section", text: { type: "mrkdwn", text: exact } }];
    assert.equal(notificationText(blocks), exact);
  });
});

describe("postStructuredMessage", () => {
  it("posts the message and returns the ts plus permalink", async () => {
    const client = makeClient({
      postTs: "1234.5678",
      permalink: "https://example.slack.com/archives/C1/p12345678",
    });
    const result = await postStructuredMessage(client, {
      channel: "C1",
      blocks: sampleBlocks,
    });
    assert.deepEqual(result, {
      ts: "1234.5678",
      permalink: "https://example.slack.com/archives/C1/p12345678",
    });

    assert.equal(client.postCalls.length, 1);
    assert.equal(client.postCalls[0].channel, "C1");
    assert.equal(client.postCalls[0].text, "hello world");
    assert.deepEqual(client.postCalls[0].blocks, sampleBlocks);
    assert.equal(client.postCalls[0].thread_ts, undefined);

    assert.equal(client.linkCalls.length, 1);
    assert.equal(client.linkCalls[0].channel, "C1");
    assert.equal(client.linkCalls[0].message_ts, "1234.5678");
  });

  it("includes thread_ts when provided", async () => {
    const client = makeClient({
      postTs: "1.0",
      permalink: "https://x.slack.com/p1",
    });
    await postStructuredMessage(client, {
      channel: "C1",
      blocks: sampleBlocks,
      threadTs: "9999.1",
    });
    assert.equal(client.postCalls[0].thread_ts, "9999.1");
  });

  it("propagates chat.postMessage failures", async () => {
    const client = makeClient({ postError: new Error("channel_not_found") });
    await assert.rejects(
      () => postStructuredMessage(client, { channel: "C1", blocks: sampleBlocks }),
      /channel_not_found/,
    );
    assert.equal(client.linkCalls.length, 0);
  });

  it("throws when postMessage returns no ts", async () => {
    const client = makeClient({ postTs: undefined });
    await assert.rejects(
      () => postStructuredMessage(client, { channel: "C1", blocks: sampleBlocks }),
      /returned no ts/,
    );
  });

  it("propagates chat.getPermalink failures", async () => {
    const client = makeClient({
      postTs: "1.0",
      permalinkError: new Error("message_not_found"),
    });
    await assert.rejects(
      () => postStructuredMessage(client, { channel: "C1", blocks: sampleBlocks }),
      /message_not_found/,
    );
  });

  it("throws when getPermalink returns no permalink", async () => {
    const client = makeClient({ postTs: "1.0", permalink: undefined });
    await assert.rejects(
      () => postStructuredMessage(client, { channel: "C1", blocks: sampleBlocks }),
      /returned no permalink/,
    );
  });

  it("derives the text fallback from blocks and caps at 500 chars", async () => {
    const long = "z".repeat(1000);
    const blocks: SlackBlocks = [{ type: "section", text: { type: "mrkdwn", text: long } }];
    const client = makeClient({ postTs: "1.0", permalink: "https://x/p" });
    await postStructuredMessage(client, { channel: "C1", blocks });
    assert.equal(client.postCalls[0].text.length, 500);
    assert.ok(client.postCalls[0].text.endsWith("..."));
  });

  it("omits unfurl_links and unfurl_media when suppressUnfurls is not set", async () => {
    const client = makeClient({ postTs: "1.0", permalink: "https://x/p" });
    await postStructuredMessage(client, { channel: "C1", blocks: sampleBlocks });
    assert.equal("unfurl_links" in client.postCalls[0], false);
    assert.equal("unfurl_media" in client.postCalls[0], false);
  });

  it("omits unfurl_links and unfurl_media when suppressUnfurls is false", async () => {
    const client = makeClient({ postTs: "1.0", permalink: "https://x/p" });
    await postStructuredMessage(client, {
      channel: "C1",
      blocks: sampleBlocks,
      suppressUnfurls: false,
    });
    assert.equal("unfurl_links" in client.postCalls[0], false);
    assert.equal("unfurl_media" in client.postCalls[0], false);
  });

  it("sets both unfurl_links and unfurl_media to false when suppressUnfurls is true", async () => {
    const client = makeClient({ postTs: "1.0", permalink: "https://x/p" });
    await postStructuredMessage(client, {
      channel: "C1",
      blocks: sampleBlocks,
      suppressUnfurls: true,
    });
    assert.equal(client.postCalls[0].unfurl_links, false);
    assert.equal(client.postCalls[0].unfurl_media, false);
  });
});
