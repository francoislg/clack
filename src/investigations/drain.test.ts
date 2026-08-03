import { describe, expect, it } from "vitest";
import { drainFollowedThreads, type DrainClient, type DrainMessage } from "./drain.js";
import type { FollowedThread } from "./types.js";

function fakeClient(byChannel: Record<string, DrainMessage[]>): DrainClient {
  return {
    conversations: {
      replies: ({ channel, oldest }) => {
        const all = byChannel[channel] ?? [];
        // Slack's `oldest` is inclusive.
        const messages = oldest ? all.filter((m) => m.ts != null && m.ts >= oldest) : all;
        return Promise.resolve({ messages });
      },
    },
  };
}

function thread(over: Partial<FollowedThread> = {}): FollowedThread {
  return {
    channel: "C1",
    threadTs: "100.000000",
    mode: "followAndInteract",
    lastInjectedTs: "0",
    pendingCount: 0,
    addedBy: "U1",
    ...over,
  };
}

const MESSAGES: DrainMessage[] = [
  { ts: "100.000000", user: "U1", text: "root question" },
  { ts: "101.000000", user: "U2", text: "hello" },
  { ts: "102.000000", bot_id: "B1", text: "beep boop" },
  { ts: "103.000000", user: "U3", text: "world" },
];

describe("drainFollowedThreads", () => {
  it("drains full history from cursor 0, excluding the root and bot messages", async () => {
    const client = fakeClient({ C1: MESSAGES });
    const result = await drainFollowedThreads(client, [thread()], { botUserId: "BOT" });
    expect(result.drainedAny).toBe(true);
    expect(result.injectedContext).toContain("hello");
    expect(result.injectedContext).toContain("world");
    expect(result.injectedContext).not.toContain("beep boop");
    expect(result.injectedContext).not.toContain("root question");
    expect(result.updatedThreads[0].lastInjectedTs).toBe("103.000000");
    expect(result.updatedThreads[0].pendingCount).toBe(0);
  });

  it("only injects messages strictly newer than the cursor", async () => {
    const client = fakeClient({ C1: MESSAGES });
    const result = await drainFollowedThreads(
      client,
      [thread({ lastInjectedTs: "101.000000" })],
      {},
    );
    expect(result.injectedContext).toContain("world");
    expect(result.injectedContext).not.toContain("hello");
    expect(result.updatedThreads[0].lastInjectedTs).toBe("103.000000");
  });

  it("advances the cursor but injects nothing when only bot messages are new", async () => {
    const client = fakeClient({
      C1: [
        { ts: "100.000000", user: "U1", text: "root" },
        { ts: "104.000000", bot_id: "B1", text: "beep" },
      ],
    });
    const result = await drainFollowedThreads(client, [thread({ pendingCount: 2 })], {});
    expect(result.drainedAny).toBe(false);
    expect(result.injectedContext).toBe("");
    expect(result.updatedThreads[0].lastInjectedTs).toBe("104.000000");
    // pendingCount is untouched when nothing human was injected.
    expect(result.updatedThreads[0].pendingCount).toBe(2);
  });

  it("skips the bot's own user id", async () => {
    const client = fakeClient({
      C1: [
        { ts: "100.000000", user: "U1", text: "root" },
        { ts: "105.000000", user: "BOT", text: "i am the bot" },
        { ts: "106.000000", user: "U2", text: "human here" },
      ],
    });
    const result = await drainFollowedThreads(client, [thread()], { botUserId: "BOT" });
    expect(result.injectedContext).toContain("human here");
    expect(result.injectedContext).not.toContain("i am the bot");
  });

  it("drains multiple threads into one context block", async () => {
    const client = fakeClient({
      C1: [
        { ts: "100.000000", user: "U1", text: "root a" },
        { ts: "101.000000", user: "U2", text: "alpha" },
      ],
      C2: [
        { ts: "200.000000", user: "U1", text: "root b" },
        { ts: "201.000000", user: "U3", text: "bravo" },
      ],
    });
    const threads = [
      thread({ channel: "C1", threadTs: "100.000000" }),
      thread({ channel: "C2", threadTs: "200.000000" }),
    ];
    const result = await drainFollowedThreads(client, threads, {});
    expect(result.injectedContext).toContain("alpha");
    expect(result.injectedContext).toContain("bravo");
    expect(result.updatedThreads).toHaveLength(2);
  });
});
