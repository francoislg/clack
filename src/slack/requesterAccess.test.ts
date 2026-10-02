import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./botIdentity.js", () => ({
  getBotIdentity: vi.fn(),
}));
vi.mock("../sessions.js", () => ({
  addAccessGrant: vi.fn(),
}));

import {
  ACCESS_DENIED_MESSAGE,
  FILE_ACCESS_DENIED_MESSAGE,
  checkConversationAccess,
  clearRequesterAccessCache,
  type AccessRequest,
} from "./requesterAccess.js";
import { getBotIdentity } from "./botIdentity.js";
import { addAccessGrant } from "../sessions.js";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";
import {
  DM,
  GROUP_DM,
  GROUP_DM_BOT_IN,
  PRIVATE_BOT_IN,
  HOME_TEAM,
  NO_PRIVACY,
  PRIVATE,
  PUBLIC,
  makeRequest,
  setConversations,
  setDmUser,
  setMembers,
  setUser,
} from "./requesterAccess.testHelpers.js";

const NOT_MEMBER = { allowed: false, reason: "not_member" };
const NO_REQUESTER = { allowed: false, reason: "no_requester" };
const LOOKUP_FAILED = { allowed: false, reason: "lookup_failed" };
const UNKNOWN = { allowed: false, reason: "unknown_conversation" };

describe("requesterAccess: conversations", () => {
  let client: MockSlackClient;

  function request(overrides: Partial<Omit<AccessRequest, "client">> = {}): AccessRequest {
    return makeRequest(client, overrides);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clearRequesterAccessCache();
    client = createSlackClientMock();
    setConversations(client);
    vi.mocked(getBotIdentity).mockResolvedValue({
      botUserId: "U_BOT",
      botId: "B_BOT",
      teamId: HOME_TEAM,
    });
    vi.mocked(addAccessGrant).mockResolvedValue(null);
    setUser(client, { team_id: HOME_TEAM });
    setMembers(client);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports fixed denial messages that name no conversation or file", () => {
    expect(ACCESS_DENIED_MESSAGE).toBe(
      "The requester does not have access to that Slack conversation, so it cannot be read on their behalf.",
    );
    expect(FILE_ACCESS_DENIED_MESSAGE).toBe(
      "The requester does not have access to that Slack file, so it cannot be used on their behalf.",
    );
  });

  describe("requester identity", () => {
    it("evaluates access for the context's user id", async () => {
      setMembers(client, "U_BOB");

      const verdict = await checkConversationAccess(request({ userId: "U_BOB" }), PRIVATE);

      expect(verdict).toEqual({ allowed: true });
      expect(client.conversations.members).toHaveBeenCalledWith({ channel: PRIVATE, limit: 1000 });
    });

    // Interactive runs, user cron jobs and investigation rounds all reach the check as a
    // non-system role with the human's id in `userId`.
    it.each(["member", "dev", "admin"] as const)(
      "evaluates a %s-role run for its user",
      async (role) => {
        setMembers(client, "U_OTHER");

        expect(await checkConversationAccess(request({ role }), PRIVATE)).toEqual(NOT_MEMBER);
        expect(client.conversations.members).toHaveBeenCalledTimes(1);
      },
    );

    it("treats a system-role run as having no requester", async () => {
      const verdict = await checkConversationAccess(
        request({ role: "system", userId: "plugin:idler" }),
        PRIVATE,
      );

      expect(verdict).toEqual(NO_REQUESTER);
      expect(client.conversations.members).not.toHaveBeenCalled();
      expect(client.users.info).not.toHaveBeenCalled();
    });

    it("denies the owner a private channel they are not a member of", async () => {
      setMembers(client, "U_OTHER");

      expect(await checkConversationAccess(request({ role: "owner" }), PRIVATE)).toEqual(
        NOT_MEMBER,
      );
    });
  });

  describe("conversation access rule", () => {
    it("allows a full member a public channel without a membership lookup", async () => {
      expect(await checkConversationAccess(request(), PUBLIC)).toEqual({ allowed: true });
      expect(client.conversations.info).toHaveBeenCalledWith({ channel: PUBLIC });
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("allows a member of a private channel without classifying them", async () => {
      setMembers(client, "U_OTHER", "U_ALICE");

      expect(await checkConversationAccess(request(), PRIVATE)).toEqual({ allowed: true });
      expect(client.users.info).not.toHaveBeenCalled();
    });

    it("denies a non-member of a private channel", async () => {
      setMembers(client, "U_OTHER");

      expect(await checkConversationAccess(request(), PRIVATE)).toEqual(NOT_MEMBER);
    });

    it("denies a non-member of a group DM", async () => {
      setMembers(client, "U_OTHER", "U_THIRD");

      expect(await checkConversationAccess(request(), GROUP_DM)).toEqual(NOT_MEMBER);
    });

    it("allows a member of a group DM", async () => {
      setMembers(client, "U_OTHER", "U_ALICE");

      expect(await checkConversationAccess(request(), GROUP_DM)).toEqual({ allowed: true });
    });

    it("requires membership when the channel's privacy is unknown", async () => {
      setMembers(client, "U_OTHER");

      expect(await checkConversationAccess(request(), NO_PRIVACY)).toEqual(NOT_MEMBER);
      expect(client.conversations.members).toHaveBeenCalledTimes(1);
    });

    it("allows a member of a channel whose privacy is unknown", async () => {
      setMembers(client, "U_OTHER", "U_ALICE");

      expect(await checkConversationAccess(request(), NO_PRIVACY)).toEqual({ allowed: true });
      expect(client.conversations.members).toHaveBeenCalledWith({
        channel: NO_PRIVACY,
        limit: 1000,
      });
    });

    it("allows the DM's own user from a single conversations.info call", async () => {
      setDmUser(client, "U_ALICE");

      expect(await checkConversationAccess(request(), DM)).toEqual({ allowed: true });
      expect(client.conversations.info).toHaveBeenCalledTimes(1);
      expect(client.conversations.info).toHaveBeenCalledWith({ channel: DM });
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("denies someone else's DM", async () => {
      setDmUser(client, "U_OTHER");

      expect(await checkConversationAccess(request(), DM)).toEqual(NOT_MEMBER);
    });

    it("denies a DM that reports no user", async () => {
      expect(await checkConversationAccess(request(), DM)).toEqual(NOT_MEMBER);
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("denies a DM when its info lookup throws", async () => {
      client.conversations.info.mockRejectedValue(new Error("channel_not_found"));

      expect(await checkConversationAccess(request(), DM)).toEqual(UNKNOWN);
    });

    it("allows a run with no requester a public channel", async () => {
      expect(await checkConversationAccess(request({ role: "system" }), PUBLIC)).toEqual({
        allowed: true,
      });
      expect(client.users.info).not.toHaveBeenCalled();
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("denies a run with no requester a private channel the bot is not in", async () => {
      expect(await checkConversationAccess(request({ role: "system" }), PRIVATE)).toEqual(
        NO_REQUESTER,
      );
    });

    it("allows a run with no requester a private channel and a group DM the bot is in", async () => {
      const req = request({ role: "system" });

      expect(await checkConversationAccess(req, PRIVATE_BOT_IN)).toEqual({ allowed: true });
      expect(await checkConversationAccess(req, GROUP_DM_BOT_IN)).toEqual({ allowed: true });
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("does not let the bot's own membership stand in for a requester's", async () => {
      expect(await checkConversationAccess(request(), PRIVATE_BOT_IN)).toEqual(NOT_MEMBER);
    });

    it("denies a run with no requester a group DM the bot is not in and a DM", async () => {
      const req = request({ role: "system" });

      expect(await checkConversationAccess(req, GROUP_DM)).toEqual(NO_REQUESTER);
      expect(await checkConversationAccess(req, DM)).toEqual(NO_REQUESTER);
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("denies when Slack reports the conversation lookup as failed", async () => {
      client.conversations.info.mockResolvedValue({ ok: false, error: "channel_not_found" });

      expect(await checkConversationAccess(request(), PUBLIC)).toEqual(UNKNOWN);
      expect(await checkConversationAccess(request({ role: "system" }), PUBLIC)).toEqual(UNKNOWN);
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("denies when the conversation lookup returns no channel", async () => {
      client.conversations.info.mockResolvedValue({ ok: true });

      expect(await checkConversationAccess(request(), PUBLIC)).toEqual(UNKNOWN);
      expect(await checkConversationAccess(request({ role: "system" }), PUBLIC)).toEqual(UNKNOWN);
    });

    it("denies when the conversation lookup throws", async () => {
      client.conversations.info.mockRejectedValue(new Error("boom"));

      expect(await checkConversationAccess(request(), PUBLIC)).toEqual(UNKNOWN);
      expect(await checkConversationAccess(request({ role: "system" }), PUBLIC)).toEqual(UNKNOWN);
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("denies when the membership lookup throws", async () => {
      client.conversations.members.mockRejectedValue(new Error("ratelimited"));

      expect(await checkConversationAccess(request(), PRIVATE)).toEqual(LOOKUP_FAILED);
    });

    it("paginates membership and stops at the first page holding the requester", async () => {
      client.conversations.members
        .mockResolvedValueOnce({
          ok: true,
          members: ["U_1"],
          response_metadata: { next_cursor: "page2" },
        })
        .mockResolvedValueOnce({
          ok: true,
          members: ["U_ALICE"],
          response_metadata: { next_cursor: "page3" },
        });

      expect(await checkConversationAccess(request(), PRIVATE)).toEqual({ allowed: true });
      expect(client.conversations.members).toHaveBeenCalledTimes(2);
      expect(client.conversations.members).toHaveBeenNthCalledWith(2, {
        channel: PRIVATE,
        limit: 1000,
        cursor: "page2",
      });
    });

    it("reads every page before denying a non-member", async () => {
      client.conversations.members
        .mockResolvedValueOnce({
          ok: true,
          members: ["U_1"],
          response_metadata: { next_cursor: "page2" },
        })
        .mockResolvedValueOnce({
          ok: true,
          members: ["U_2"],
          response_metadata: { next_cursor: "" },
        });

      expect(await checkConversationAccess(request(), PRIVATE)).toEqual(NOT_MEMBER);
      expect(client.conversations.members).toHaveBeenCalledTimes(2);
    });
  });

  describe("guest and external requesters", () => {
    it("allows a guest a public channel they joined", async () => {
      setUser(client, { team_id: HOME_TEAM, is_restricted: true });
      setMembers(client, "U_ALICE");

      expect(await checkConversationAccess(request(), PUBLIC)).toEqual({ allowed: true });
      expect(client.users.info).toHaveBeenCalledWith({ user: "U_ALICE" });
      expect(client.conversations.members).toHaveBeenCalledTimes(1);
    });

    it("denies a guest a public channel they have not joined", async () => {
      setUser(client, { team_id: HOME_TEAM, is_restricted: true });
      setMembers(client, "U_OTHER");

      expect(await checkConversationAccess(request(), PUBLIC)).toEqual(NOT_MEMBER);
    });

    it.each([
      ["ultra-restricted", { team_id: HOME_TEAM, is_ultra_restricted: true }],
      ["a stranger", { team_id: HOME_TEAM, is_stranger: true }],
      ["on another team", { team_id: "T_ELSEWHERE" }],
    ])("requires public-channel membership of a requester who is %s", async (_label, user) => {
      setUser(client, user);
      setMembers(client, "U_OTHER");

      expect(await checkConversationAccess(request(), PUBLIC)).toEqual(NOT_MEMBER);
    });

    it("does not read a missing requester team id as another team", async () => {
      setUser(client, {});

      expect(await checkConversationAccess(request(), PUBLIC)).toEqual({ allowed: true });
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("does not read a missing bot team id as another team", async () => {
      setUser(client, { team_id: "T_ELSEWHERE" });
      vi.mocked(getBotIdentity).mockResolvedValue({
        botUserId: "U_BOT",
        botId: "B_BOT",
        teamId: undefined,
      });

      expect(await checkConversationAccess(request(), PUBLIC)).toEqual({ allowed: true });
      expect(getBotIdentity).toHaveBeenCalledWith(client);
    });

    it("treats a requester whose user lookup throws as a guest", async () => {
      client.users.info.mockRejectedValue(new Error("user_not_found"));
      setMembers(client, "U_OTHER");

      expect(await checkConversationAccess(request(), PUBLIC)).toEqual(NOT_MEMBER);
      expect(client.conversations.members).toHaveBeenCalledTimes(1);
    });

    it("treats a requester whose user lookup returns no user as a guest", async () => {
      client.users.info.mockResolvedValue({ ok: false, error: "user_not_found" });
      setMembers(client, "U_ALICE");

      expect(await checkConversationAccess(request(), PUBLIC)).toEqual({ allowed: true });
      expect(client.conversations.members).toHaveBeenCalledTimes(1);
    });
  });
});
