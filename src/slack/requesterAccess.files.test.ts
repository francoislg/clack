import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./botIdentity.js", () => ({
  getBotIdentity: vi.fn(),
}));
vi.mock("../sessions.js", () => ({
  addAccessGrant: vi.fn(),
}));

import {
  checkFileAccess,
  clearRequesterAccessCache,
  type AccessRequest,
} from "./requesterAccess.js";
import { getBotIdentity } from "./botIdentity.js";
import { addAccessGrant } from "../sessions.js";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";
import {
  DM,
  GROUP_DM,
  HOME_TEAM,
  PRIVATE,
  PRIVATE_2,
  PUBLIC,
  makeRequest,
  setConversations,
  makeSession,
  setDmUser,
  setFile,
  setMembers,
  setUser,
} from "./requesterAccess.testHelpers.js";

const NO_EVIDENCE = { allowed: false, reason: "no_evidence" };
const FILE_UNAVAILABLE = { allowed: false, reason: "file_unavailable" };

describe("requesterAccess: files", () => {
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

  describe("file access rule", () => {
    it("fetches the file's info itself and allows the creator without a membership lookup", async () => {
      setFile(client, { user: "U_ALICE", groups: [PRIVATE], access: "read" });

      expect(await checkFileAccess(request(), "F1")).toEqual({
        allowed: true,
        botAccess: "read",
        creator: "U_ALICE",
        facts: {},
      });
      expect(client.files.info).toHaveBeenCalledWith({ file: "F1" });
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("allows a requester named in the per-user access list", async () => {
      setFile(client, {
        user: "U_OTHER",
        dm_mpdm_users_with_file_access: [
          { user_id: "U_OTHER", access: "owner" },
          { user_id: "U_ALICE", access: "read" },
        ],
      });

      expect(await checkFileAccess(request(), "F1")).toMatchObject({ allowed: true });
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("allows a file shared to a private channel the requester is in", async () => {
      setFile(client, { user: "U_OTHER", groups: [PRIVATE] });
      setMembers(client, "U_ALICE");

      expect(await checkFileAccess(request(), "F1")).toMatchObject({ allowed: true });
      expect(client.conversations.members).toHaveBeenCalledWith({ channel: PRIVATE, limit: 1000 });
    });

    it("allows a file shared to a group DM the requester is in", async () => {
      setFile(client, { user: "U_OTHER", groups: [GROUP_DM] });
      setMembers(client, "U_ALICE");

      expect(await checkFileAccess(request(), "F1")).toMatchObject({ allowed: true });
      expect(client.conversations.members).toHaveBeenCalledWith({ channel: GROUP_DM, limit: 1000 });
    });

    it("allows a file shared to the requester's own DM", async () => {
      setFile(client, { user: "U_OTHER", ims: [DM] });
      setDmUser(client, "U_ALICE");

      expect(await checkFileAccess(request(), "F1")).toMatchObject({ allowed: true });
    });

    it("allows a full member a file shared to a public channel", async () => {
      setFile(client, { user: "U_OTHER", channels: [PUBLIC] });

      expect(await checkFileAccess(request(), "F1")).toMatchObject({ allowed: true });
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("denies a file shared only to channels the requester is not in", async () => {
      setFile(client, {
        user: "U_OTHER",
        groups: [PRIVATE, PRIVATE_2],
        dm_mpdm_users_with_file_access: [{ user_id: "U_OTHER", access: "owner" }],
      });
      setMembers(client, "U_OTHER");

      expect(await checkFileAccess(request(), "F1")).toEqual(NO_EVIDENCE);
      expect(client.conversations.members).toHaveBeenCalledTimes(2);
    });

    it("denies a requester who appears only in the editor list", async () => {
      setFile(client, { user: "U_OTHER", editors: ["U_ALICE"] });

      expect(await checkFileAccess(request(), "F1")).toEqual(NO_EVIDENCE);
    });

    it("grants nothing for workspace-wide access or a private-channel count", async () => {
      setFile(client, {
        user: "U_OTHER",
        org_or_workspace_access: "write",
        private_channels_with_file_access_count: 3,
      });

      expect(await checkFileAccess(request(), "F1")).toEqual(NO_EVIDENCE);
    });

    it("denies when the file lookup throws", async () => {
      client.files.info.mockRejectedValue(new Error("file_not_found"));

      expect(await checkFileAccess(request(), "F1")).toEqual(FILE_UNAVAILABLE);
    });

    it("denies when Slack reports the file as not visible to the bot", async () => {
      client.files.info.mockResolvedValue({ ok: false, error: "not_visible" });

      expect(await checkFileAccess(request(), "F1")).toEqual(FILE_UNAVAILABLE);
    });

    it("reports the bot's read access", async () => {
      setFile(client, { user: "U_ALICE", access: "read" });

      expect(await checkFileAccess(request(), "F1")).toEqual({
        allowed: true,
        botAccess: "read",
        creator: "U_ALICE",
        facts: {},
      });
    });

    it("reports the bot's write access", async () => {
      setFile(client, { user: "U_ALICE", access: "write" });

      expect(await checkFileAccess(request(), "F1")).toEqual({
        allowed: true,
        botAccess: "write",
        creator: "U_ALICE",
        facts: {},
      });
    });

    it("reports no bot access level when Slack returns none or an unknown one", async () => {
      const noLevel = { allowed: true, botAccess: undefined, creator: "U_ALICE", facts: {} };

      setFile(client, { user: "U_ALICE" });
      expect(await checkFileAccess(request(), "F1")).toEqual(noLevel);

      setFile(client, { user: "U_ALICE", access: "owner" });
      expect(await checkFileAccess(request(), "F1")).toEqual(noLevel);
    });

    it("reports the file's creator", async () => {
      setFile(client, { user: "U1", channels: [PUBLIC] });

      const verdict = await checkFileAccess(request(), "F1");

      expect(verdict).toMatchObject({ allowed: true, creator: "U1" });
    });

    it("reports no creator for a file allowed through a channel share that names no user", async () => {
      setFile(client, { channels: [PUBLIC] });

      const verdict = await checkFileAccess(request(), "F1");

      expect(verdict).toStrictEqual({
        allowed: true,
        botAccess: undefined,
        creator: undefined,
        facts: {
          filetype: undefined,
          prettyType: undefined,
          name: undefined,
          title: undefined,
          mimetype: undefined,
          size: undefined,
          urlPrivate: undefined,
        },
      });
    });

    it("reports the file's facts on an allowance", async () => {
      setFile(client, {
        user: "U_ALICE",
        filetype: "quip",
        pretty_type: "Canvas",
        name: "notes",
        title: "Team notes",
        mimetype: "application/vnd.slack-docs",
        size: 1234,
        url_private: "https://files.slack.com/files-pri/T1-F1/notes",
      });

      const verdict = await checkFileAccess(request(), "F1");

      expect(verdict).toEqual({
        allowed: true,
        botAccess: undefined,
        creator: "U_ALICE",
        facts: {
          filetype: "quip",
          prettyType: "Canvas",
          name: "notes",
          title: "Team notes",
          mimetype: "application/vnd.slack-docs",
          size: 1234,
          urlPrivate: "https://files.slack.com/files-pri/T1-F1/notes",
        },
      });
    });

    it("reports no facts on a denial", async () => {
      setFile(client, { user: "U_OTHER", filetype: "quip", title: "Secret", size: 10 });

      const verdict = await checkFileAccess(request(), "F1");

      expect(verdict).toStrictEqual({ allowed: false, reason: "no_evidence" });
    });

    it("drops a malformed fact and still allows the file", async () => {
      client.files.info.mockResolvedValue({
        ok: true,
        file: JSON.parse('{"id":"F1","user":"U_ALICE","title":"Team notes","size":"big"}'),
      });

      const verdict = await checkFileAccess(request(), "F1");

      expect(verdict).toMatchObject({ allowed: true, creator: "U_ALICE" });
      expect(verdict.allowed && verdict.facts.size).toBeUndefined();
      expect(verdict.allowed && verdict.facts.title).toBe("Team notes");
    });

    it("denies a run with no requester a file shared only to private channels", async () => {
      setFile(client, { user: "plugin:idler", groups: [PRIVATE] });

      const verdict = await checkFileAccess(
        request({ role: "system", userId: "plugin:idler" }),
        "F1",
      );

      expect(verdict).toEqual({ allowed: false, reason: "no_requester" });
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("allows a run with no requester a file shared to a public channel", async () => {
      setFile(client, { user: "U_OTHER", channels: [PUBLIC] });

      expect(await checkFileAccess(request({ role: "system" }), "F1")).toMatchObject({
        allowed: true,
      });
    });
  });

  describe("session grants", () => {
    it("records the file, not the channel it is shared to, on the session", async () => {
      const session = makeSession();
      setFile(client, { user: "U_OTHER", groups: [PRIVATE] });
      setMembers(client, "U_ALICE");
      vi.mocked(addAccessGrant).mockResolvedValue(makeSession(["F1"]));

      await checkFileAccess(request({ session }), "F1");

      expect(session.accessGranted).toEqual(["F1"]);
      expect(addAccessGrant).toHaveBeenCalledTimes(1);
      expect(addAccessGrant).toHaveBeenCalledWith("SID", "F1");
    });

    it("allows a file granted to one participant for the others", async () => {
      const session = makeSession();
      setFile(client, { user: "U_ALICE", access: "write" });
      await checkFileAccess(request({ session }), "F1");

      const verdict = await checkFileAccess(request({ session, userId: "U_BOB" }), "F1");

      expect(verdict).toEqual({
        allowed: true,
        botAccess: "write",
        creator: "U_ALICE",
        facts: {},
      });
      expect(client.files.info).toHaveBeenCalledTimes(2);
      expect(addAccessGrant).toHaveBeenCalledTimes(1);
    });

    it("denies a session-granted file the bot can no longer see", async () => {
      const session = makeSession(["F1"]);
      client.files.info.mockRejectedValue(new Error("file_not_found"));

      expect(await checkFileAccess(request({ session }), "F1")).toEqual(FILE_UNAVAILABLE);
    });

    it("never records a denied file", async () => {
      const session = makeSession();
      setFile(client, { user: "U_OTHER" });

      await checkFileAccess(request({ session }), "F1");

      expect(session.accessGranted).toBeUndefined();
      expect(addAccessGrant).not.toHaveBeenCalled();
    });

    it("counts a session-granted channel as evidence for a file shared to it", async () => {
      const session = makeSession([PRIVATE]);
      setFile(client, { user: "U_OTHER", groups: [PRIVATE] });

      const verdict = await checkFileAccess(request({ session, userId: "U_BOB" }), "F1");

      expect(verdict).toMatchObject({ allowed: true });
      expect(client.conversations.members).not.toHaveBeenCalled();
    });
  });
});
