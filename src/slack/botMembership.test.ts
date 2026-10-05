import { beforeEach, describe, expect, it, vi } from "vitest";
import { isBotInConversation } from "./botMembership.js";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";

vi.mock("../logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

type InfoResponse = Awaited<ReturnType<MockSlackClient["conversations"]["info"]>>;
type InfoChannel = NonNullable<InfoResponse["channel"]>;

describe("isBotInConversation", () => {
  let client: MockSlackClient;

  beforeEach(() => {
    client = createSlackClientMock();
  });

  function programChannel(channel: InfoChannel): void {
    client.conversations.info.mockResolvedValue({ ok: true, channel });
  }

  it("is true for a channel the bot is a member of", async () => {
    programChannel({ id: "C1", is_member: true });
    expect(await isBotInConversation(client, "C1")).toBe(true);
    expect(client.conversations.info).toHaveBeenCalledWith({ channel: "C1" });
  });

  it("is true for a DM", async () => {
    programChannel({ id: "C1", is_im: true });
    expect(await isBotInConversation(client, "C1")).toBe(true);
  });

  it("is true for a group DM", async () => {
    programChannel({ id: "C1", is_mpim: true });
    expect(await isBotInConversation(client, "C1")).toBe(true);
  });

  it("is false for a channel the bot is not a member of", async () => {
    programChannel({ id: "C1", is_member: false });
    expect(await isBotInConversation(client, "C1")).toBe(false);
  });

  it("is false on a failed response", async () => {
    client.conversations.info.mockResolvedValue({ ok: false, error: "channel_not_found" });
    expect(await isBotInConversation(client, "C1")).toBe(false);
  });

  it("is false when the response carries no channel", async () => {
    client.conversations.info.mockResolvedValue({ ok: true });
    expect(await isBotInConversation(client, "C1")).toBe(false);
  });

  it("is false when is_member is not a boolean", async () => {
    // Wire data the typed response can't express: parsed JSON, as Slack would deliver it.
    const malformedChannel = JSON.parse('{"id":"C1","is_member":"yes"}');
    client.conversations.info.mockResolvedValue({ ok: true, channel: malformedChannel });
    expect(await isBotInConversation(client, "C1")).toBe(false);
  });

  it("is false when conversations.info rejects", async () => {
    client.conversations.info.mockRejectedValue(new Error("boom"));
    expect(await isBotInConversation(client, "C1")).toBe(false);
  });
});
