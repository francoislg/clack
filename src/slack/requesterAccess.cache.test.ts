import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./botIdentity.js", () => ({
  getBotIdentity: vi.fn(),
}));
vi.mock("../sessions.js", () => ({
  addAccessGrant: vi.fn(),
}));

import {
  ALLOW_VERDICT_TTL_MS,
  CLASSIFICATION_TTL_MS,
  DENY_VERDICT_TTL_MS,
  checkConversationAccess,
  clearRequesterAccessCache,
  type AccessRequest,
} from "./requesterAccess.js";
import { getBotIdentity } from "./botIdentity.js";
import { addAccessGrant } from "../sessions.js";
import { logger } from "../logger.js";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";
import {
  HOME_TEAM,
  PRIVATE,
  PUBLIC,
  PUBLIC_2,
  makeRequest,
  setConversations,
  makeSession,
  setMembers,
  setUser,
} from "./requesterAccess.testHelpers.js";

const NOT_MEMBER = { allowed: false, reason: "not_member" };

describe("requesterAccess: caches and session grants", () => {
  let client: MockSlackClient;

  function request(overrides: Partial<Omit<AccessRequest, "client">> = {}): AccessRequest {
    return makeRequest(client, overrides);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
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

  describe("verdict cache", () => {
    it("runs the membership lookup once for repeated checks within the allow TTL", async () => {
      setMembers(client, "U_ALICE");

      await checkConversationAccess(request(), PRIVATE);
      vi.advanceTimersByTime(ALLOW_VERDICT_TTL_MS - 1);
      const second = await checkConversationAccess(request(), PRIVATE);

      expect(second).toEqual({ allowed: true });
      expect(client.conversations.members).toHaveBeenCalledTimes(1);
    });

    it("runs the conversation lookup once for repeated checks within the allow TTL", async () => {
      await checkConversationAccess(request(), PUBLIC);
      vi.advanceTimersByTime(ALLOW_VERDICT_TTL_MS - 1);
      const second = await checkConversationAccess(request(), PUBLIC);

      expect(second).toEqual({ allowed: true });
      expect(client.conversations.info).toHaveBeenCalledTimes(1);
      expect(client.conversations.info).toHaveBeenCalledWith({ channel: PUBLIC });
    });

    it("performs a fresh membership lookup once the allow TTL has elapsed", async () => {
      setMembers(client, "U_ALICE");
      await checkConversationAccess(request(), PRIVATE);

      vi.advanceTimersByTime(ALLOW_VERDICT_TTL_MS);
      setMembers(client, "U_OTHER");
      const second = await checkConversationAccess(request(), PRIVATE);

      expect(second).toEqual(NOT_MEMBER);
      expect(client.conversations.members).toHaveBeenCalledTimes(2);
    });

    it("reuses a denial within the deny TTL", async () => {
      setMembers(client, "U_OTHER");
      await checkConversationAccess(request(), PRIVATE);

      vi.advanceTimersByTime(DENY_VERDICT_TTL_MS - 1);
      setMembers(client, "U_ALICE");
      const second = await checkConversationAccess(request(), PRIVATE);

      expect(second).toEqual(NOT_MEMBER);
      expect(client.conversations.members).toHaveBeenCalledTimes(1);
    });

    it("recomputes a denial once the deny TTL has elapsed, before the allow TTL", async () => {
      expect(DENY_VERDICT_TTL_MS).toBeLessThan(ALLOW_VERDICT_TTL_MS);
      setMembers(client, "U_OTHER");
      await checkConversationAccess(request(), PRIVATE);

      vi.advanceTimersByTime(DENY_VERDICT_TTL_MS);
      setMembers(client, "U_ALICE");
      const second = await checkConversationAccess(request(), PRIVATE);

      expect(second).toEqual({ allowed: true });
      expect(client.conversations.members).toHaveBeenCalledTimes(2);
    });

    it("keeps verdicts apart per requester", async () => {
      setMembers(client, "U_ALICE");

      expect(await checkConversationAccess(request(), PRIVATE)).toEqual({ allowed: true });
      expect(await checkConversationAccess(request({ userId: "U_BOB" }), PRIVATE)).toEqual(
        NOT_MEMBER,
      );
      expect(client.conversations.members).toHaveBeenCalledTimes(2);
    });

    it("shares one membership lookup between concurrent checks", async () => {
      setMembers(client, "U_ALICE");

      const verdicts = await Promise.all([
        checkConversationAccess(request(), PRIVATE),
        checkConversationAccess(request(), PRIVATE),
      ]);

      expect(verdicts).toEqual([{ allowed: true }, { allowed: true }]);
      expect(client.conversations.members).toHaveBeenCalledTimes(1);
    });

    it("shares one user lookup between concurrent checks on different channels", async () => {
      await Promise.all([
        checkConversationAccess(request(), PUBLIC),
        checkConversationAccess(request(), PUBLIC_2),
      ]);

      expect(client.users.info).toHaveBeenCalledTimes(1);
    });

    it("fetches the requester's user info once across two channels", async () => {
      await checkConversationAccess(request(), PUBLIC);
      await checkConversationAccess(request(), PUBLIC_2);

      expect(client.users.info).toHaveBeenCalledTimes(1);
    });

    it("fetches the user info again once the classification TTL has elapsed", async () => {
      expect(CLASSIFICATION_TTL_MS).toBeGreaterThan(ALLOW_VERDICT_TTL_MS);
      await checkConversationAccess(request(), PUBLIC);

      vi.advanceTimersByTime(CLASSIFICATION_TTL_MS);
      await checkConversationAccess(request(), PUBLIC);

      expect(client.users.info).toHaveBeenCalledTimes(2);
    });

    it("repeats the membership lookup without fetching user info after the allow TTL", async () => {
      setUser(client, { team_id: HOME_TEAM, is_restricted: true });
      setMembers(client, "U_ALICE");
      await checkConversationAccess(request(), PUBLIC);

      vi.advanceTimersByTime(ALLOW_VERDICT_TTL_MS);
      await checkConversationAccess(request(), PUBLIC);

      expect(client.conversations.members).toHaveBeenCalledTimes(2);
      expect(client.users.info).toHaveBeenCalledTimes(1);
    });

    it("does not cache a failed membership lookup", async () => {
      client.conversations.members.mockRejectedValueOnce(new Error("ratelimited"));
      await checkConversationAccess(request(), PRIVATE);

      setMembers(client, "U_ALICE");
      expect(await checkConversationAccess(request(), PRIVATE)).toEqual({ allowed: true });
      expect(client.conversations.members).toHaveBeenCalledTimes(2);
    });

    it("does not cache an unknown conversation", async () => {
      client.conversations.info.mockResolvedValueOnce({ ok: false, error: "channel_not_found" });
      await checkConversationAccess(request(), PUBLIC);

      expect(await checkConversationAccess(request(), PUBLIC)).toEqual({ allowed: true });
      expect(client.conversations.info).toHaveBeenCalledTimes(2);
    });

    it("does not cache a failed user lookup", async () => {
      client.users.info.mockRejectedValueOnce(new Error("ratelimited"));
      setMembers(client, "U_ALICE");
      await checkConversationAccess(request(), PUBLIC);

      await checkConversationAccess(request(), PUBLIC_2);

      expect(client.users.info).toHaveBeenCalledTimes(2);
      expect(client.conversations.members).toHaveBeenCalledTimes(1);
    });
  });

  describe("session grants", () => {
    it("persists an allowed conversation and takes the session's list from the persisted one", async () => {
      const session = makeSession(["C_EARLIER"]);
      setMembers(client, "U_ALICE");
      // The persisted list carries a grant another run added, which the in-memory copy lacks.
      const persisted = ["C_EARLIER", "C_CONCURRENT", PRIVATE];
      vi.mocked(addAccessGrant).mockResolvedValue(makeSession(persisted));

      await checkConversationAccess(request({ session }), PRIVATE);

      expect(addAccessGrant).toHaveBeenCalledWith("SID", PRIVATE);
      expect(session.accessGranted).toEqual(persisted);
    });

    it("keeps the grant in memory and warns when the session is not found", async () => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      const session = makeSession(["C_EARLIER"]);
      setMembers(client, "U_ALICE");
      vi.mocked(addAccessGrant).mockResolvedValue(null);

      const verdict = await checkConversationAccess(request({ session }), PRIVATE);

      expect(verdict).toEqual({ allowed: true });
      expect(session.accessGranted).toEqual(["C_EARLIER", PRIVATE]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("not found"));
    });

    it("allows a second participant a channel the session was already granted", async () => {
      const session = makeSession();
      setMembers(client, "U_ALICE");
      await checkConversationAccess(request({ session }), PRIVATE);

      const verdict = await checkConversationAccess(request({ session, userId: "U_BOB" }), PRIVATE);

      expect(verdict).toEqual({ allowed: true });
      expect(client.conversations.members).toHaveBeenCalledTimes(1);
      expect(addAccessGrant).toHaveBeenCalledTimes(1);
    });

    it("denies a participant a channel nobody was granted in the session", async () => {
      const session = makeSession(["C_OTHER_GRANT"]);
      setMembers(client, "U_ALICE");

      const verdict = await checkConversationAccess(request({ session, userId: "U_BOB" }), PRIVATE);

      expect(verdict).toEqual(NOT_MEMBER);
    });

    it("never records a denial, so a member is allowed after a non-member was denied", async () => {
      const session = makeSession();
      setMembers(client, "U_ALICE");

      const denied = await checkConversationAccess(request({ session, userId: "U_BOB" }), PRIVATE);
      expect(denied).toEqual(NOT_MEMBER);
      expect(session.accessGranted).toBeUndefined();
      expect(addAccessGrant).not.toHaveBeenCalled();

      const allowed = await checkConversationAccess(request({ session }), PRIVATE);
      expect(allowed).toEqual({ allowed: true });
      expect(session.accessGranted).toEqual([PRIVATE]);
    });

    it("allows a target granted on a reloaded session without any lookup", async () => {
      const reloaded = makeSession([PRIVATE]);

      const verdict = await checkConversationAccess(request({ session: reloaded }), PRIVATE);

      expect(verdict).toEqual({ allowed: true });
      expect(client.conversations.info).not.toHaveBeenCalled();
      expect(client.conversations.members).not.toHaveBeenCalled();
      expect(addAccessGrant).not.toHaveBeenCalled();
    });

    it("honours a session grant for a run with no requester", async () => {
      const session = makeSession([PRIVATE]);

      expect(await checkConversationAccess(request({ session, role: "system" }), PRIVATE)).toEqual({
        allowed: true,
      });
    });

    it("keeps the verdict and warns when persisting the grant fails", async () => {
      const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
      const session = makeSession();
      setMembers(client, "U_ALICE");
      vi.mocked(addAccessGrant).mockRejectedValue(new Error("disk full"));

      const verdict = await checkConversationAccess(request({ session }), PRIVATE);

      expect(verdict).toEqual({ allowed: true });
      expect(session.accessGranted).toEqual([PRIVATE]);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
