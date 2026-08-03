import { describe, expect, it } from "vitest";
import { buildInvestigationDeliveryContext } from "./deliveryContext.js";
import type { FollowedThread } from "./types.js";

function thread(over: Partial<FollowedThread> = {}): FollowedThread {
  return {
    channel: "C1",
    threadTs: "100.0",
    mode: "followAndInteract",
    lastInjectedTs: "0",
    pendingCount: 0,
    addedBy: "U1",
    ...over,
  };
}

describe("buildInvestigationDeliveryContext", () => {
  it("describes the channel write surface", () => {
    const ctx = buildInvestigationDeliveryContext({ surface: "channel", followedThreads: [] });
    expect(ctx).toContain("investigation channel thread");
    expect(ctx).toContain("only surface you write to");
  });

  it("describes the DM write surface", () => {
    const ctx = buildInvestigationDeliveryContext({ surface: "dm", followedThreads: [] });
    expect(ctx).toContain("direct-message investigation thread");
  });

  it("enumerates followed threads with their modes and names the lifecycle tools", () => {
    const ctx = buildInvestigationDeliveryContext({
      surface: "channel",
      followedThreads: [thread({ channel: "CSIDE", mode: "followAndInteract" })],
    });
    expect(ctx).toContain("<#CSIDE>");
    expect(ctx).toContain("[followAndInteract]");
    expect(ctx).toContain("NEVER post");
    expect(ctx).toContain("follow_thread");
    expect(ctx).toContain("close_investigation");
  });

  it("surfaces the pending count for a follow-mode thread", () => {
    const ctx = buildInvestigationDeliveryContext({
      surface: "channel",
      followedThreads: [thread({ mode: "follow", pendingCount: 3 })],
    });
    expect(ctx).toContain("3 new message(s) available to read");
  });

  it("omits a pending hint when there is nothing pending", () => {
    const ctx = buildInvestigationDeliveryContext({
      surface: "channel",
      followedThreads: [thread({ mode: "follow", pendingCount: 0 })],
    });
    expect(ctx).not.toContain("available to read");
  });

  it("includes the subject when provided", () => {
    const ctx = buildInvestigationDeliveryContext({
      surface: "channel",
      followedThreads: [],
      subject: "flaky deploy",
    });
    expect(ctx).toContain("Subject: flaky deploy");
  });
});
