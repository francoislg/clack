import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebClient } from "@slack/web-api";

vi.mock("../roles.js", () => ({ loadRoles: vi.fn() }));
vi.mock("./app.js", () => ({ getSlackClient: vi.fn() }));
vi.mock("./channelResolver.js", () => ({ openDmChannel: vi.fn() }));

import { getOwnerUserId, sendOwnerDm } from "./ownerDm.js";
import { loadRoles } from "../roles.js";
import { getSlackClient } from "./app.js";
import { openDmChannel } from "./channelResolver.js";

const loadRolesMock = vi.mocked(loadRoles);
const getSlackClientMock = vi.mocked(getSlackClient);
const openDmChannelMock = vi.mocked(openDmChannel);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getOwnerUserId", () => {
  it("returns the configured owner", async () => {
    loadRolesMock.mockResolvedValue({ owner: "U_OWNER", admins: [], devs: [] });
    expect(await getOwnerUserId()).toBe("U_OWNER");
  });

  it("returns null when no owner is configured", async () => {
    loadRolesMock.mockResolvedValue({ owner: null, admins: [], devs: [] });
    expect(await getOwnerUserId()).toBeNull();
  });

  it("returns null (never throws) when roles fail to load", async () => {
    loadRolesMock.mockRejectedValue(new Error("disk gone"));
    expect(await getOwnerUserId()).toBeNull();
  });
});

describe("sendOwnerDm", () => {
  it("returns false when no Slack client is available", async () => {
    getSlackClientMock.mockReturnValue(null);
    expect(await sendOwnerDm("U_OWNER", "hi")).toBe(false);
    expect(openDmChannelMock).not.toHaveBeenCalled();
  });

  it("returns false when the DM channel can't be opened", async () => {
    getSlackClientMock.mockReturnValue(new WebClient());
    openDmChannelMock.mockResolvedValue(null);
    expect(await sendOwnerDm("U_OWNER", "hi")).toBe(false);
  });

  it("returns false (never throws) when postMessage fails", async () => {
    const client = new WebClient();
    vi.spyOn(client.chat, "postMessage").mockRejectedValue(new Error("rate limited"));
    getSlackClientMock.mockReturnValue(client);
    openDmChannelMock.mockResolvedValue("D_OWNER");
    expect(await sendOwnerDm("U_OWNER", "hi")).toBe(false);
  });

  it("posts to the opened DM channel and returns true on success", async () => {
    const client = new WebClient();
    const postSpy = vi.spyOn(client.chat, "postMessage").mockResolvedValue({ ok: true });
    getSlackClientMock.mockReturnValue(client);
    openDmChannelMock.mockResolvedValue("D_OWNER");
    expect(await sendOwnerDm("U_OWNER", "diagnostic", { suppressUnfurls: true })).toBe(true);
    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "D_OWNER", text: "diagnostic" }),
    );
  });
});
