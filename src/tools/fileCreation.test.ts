import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { permalinkOrUndefined, shareWithSessionChannel } from "./fileCreation.js";
import { createSlackClientMock, type MockSlackClient } from "../slack/testSlackClient.js";

type ShareOpts = Parameters<typeof shareWithSessionChannel>[0];

describe("shareWithSessionChannel", () => {
  let client: MockSlackClient;
  let isDirectConversation: Mock<ShareOpts["isDirectConversation"]>;
  let share: Mock<ShareOpts["share"]>;
  let errorMessage: Mock<ShareOpts["errorMessage"]>;

  beforeEach(() => {
    client = createSlackClientMock();
    isDirectConversation = vi.fn<ShareOpts["isDirectConversation"]>().mockResolvedValue(false);
    share = vi.fn<ShareOpts["share"]>().mockResolvedValue(undefined);
    errorMessage = vi.fn<ShareOpts["errorMessage"]>().mockReturnValue("share went wrong");
  });

  function run(channelId: string): ReturnType<typeof shareWithSessionChannel> {
    return shareWithSessionChannel({
      client,
      fileId: "F1",
      channelId,
      isDirectConversation,
      share,
      errorMessage,
    });
  }

  it("makes no call without a session channel", async () => {
    expect(await run("")).toEqual({});
    expect(isDirectConversation).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
  });

  it("does not share into a DM", async () => {
    isDirectConversation.mockResolvedValue(true);

    expect(await run("D1")).toEqual({});
    expect(isDirectConversation).toHaveBeenCalledWith(client, "D1");
    expect(share).not.toHaveBeenCalled();
  });

  it("shares with a channel", async () => {
    expect(await run("C1")).toEqual({ sharedWith: "C1" });
    expect(share).toHaveBeenCalledWith(client, "F1", "C1");
  });

  it("reports a share failure as a warning from errorMessage", async () => {
    const failure = new Error("boom");
    share.mockRejectedValue(failure);

    expect(await run("C1")).toEqual({ warning: "share went wrong" });
    expect(errorMessage).toHaveBeenCalledWith("share", failure);
  });

  it("names the channel check when it is the step that fails", async () => {
    const failure = new Error("boom");
    isDirectConversation.mockRejectedValue(failure);

    await run("C1");

    expect(errorMessage).toHaveBeenCalledWith("check the channel before sharing", failure);
    expect(share).not.toHaveBeenCalled();
  });
});

describe("permalinkOrUndefined", () => {
  it("returns the looked-up permalink", async () => {
    const lookup = vi.fn<() => Promise<string | undefined>>().mockResolvedValue("https://x/F1");

    expect(await permalinkOrUndefined(lookup, "create_x F1")).toBe("https://x/F1");
  });

  it("returns undefined when the lookup throws", async () => {
    const lookup = vi.fn<() => Promise<string | undefined>>().mockRejectedValue(new Error("nope"));

    expect(await permalinkOrUndefined(lookup, "create_x F1")).toBeUndefined();
  });
});
