import { beforeEach, describe, expect, it } from "vitest";
import {
  isDirectConversation,
  isSlackHost,
  SLACK_FILE_ID_PATTERN,
  slackUrlSegments,
} from "./fileRef.js";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";

describe("SLACK_FILE_ID_PATTERN", () => {
  it("accepts a file id", () => {
    expect(SLACK_FILE_ID_PATTERN.test("F0456ABC")).toBe(true);
  });

  it("rejects a channel id", () => {
    expect(SLACK_FILE_ID_PATTERN.test("C0456ABC")).toBe(false);
  });

  it("rejects a lowercase id", () => {
    expect(SLACK_FILE_ID_PATTERN.test("f0456abc")).toBe(false);
  });
});

describe("isSlackHost", () => {
  it("accepts slack.com", () => {
    expect(isSlackHost("slack.com")).toBe(true);
  });

  it("accepts a workspace subdomain", () => {
    expect(isSlackHost("acme.slack.com")).toBe(true);
  });

  it("rejects a host that only starts with slack.com", () => {
    expect(isSlackHost("slack.com.evil.io")).toBe(false);
  });

  it("rejects a host that only ends with slack.com", () => {
    expect(isSlackHost("notslack.com")).toBe(false);
  });
});

describe("slackUrlSegments", () => {
  it("returns the path segments and the URL of a Slack URL", () => {
    const result = slackUrlSegments("https://acme.slack.com/docs/T0123/F0456ABC?x=1");

    expect(result?.segments).toEqual(["docs", "T0123", "F0456ABC"]);
    expect(result?.url.searchParams.get("x")).toBe("1");
  });

  it("is undefined for a non-URL", () => {
    expect(slackUrlSegments("F0456ABC")).toBeUndefined();
  });

  it("is undefined for a non-Slack host", () => {
    expect(slackUrlSegments("https://example.com/docs/T0123/F0456ABC")).toBeUndefined();
  });
});

describe("isDirectConversation", () => {
  let client: MockSlackClient;

  beforeEach(() => {
    client = createSlackClientMock();
  });

  it("is true for a DM", async () => {
    client.conversations.info.mockResolvedValue({ ok: true, channel: { id: "D1", is_im: true } });

    await expect(isDirectConversation(client, "D1")).resolves.toBe(true);
    expect(client.conversations.info).toHaveBeenCalledWith({ channel: "D1" });
  });

  it("is true for a group DM", async () => {
    client.conversations.info.mockResolvedValue({
      ok: true,
      channel: { id: "G1", is_mpim: true },
    });

    await expect(isDirectConversation(client, "G1")).resolves.toBe(true);
  });

  it("is false for a channel", async () => {
    client.conversations.info.mockResolvedValue({
      ok: true,
      channel: { id: "C1", is_channel: true, is_im: false, is_mpim: false },
    });

    await expect(isDirectConversation(client, "C1")).resolves.toBe(false);
  });
});
