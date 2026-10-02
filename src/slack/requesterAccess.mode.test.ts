import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./botIdentity.js", () => ({
  getBotIdentity: vi.fn(),
}));
vi.mock("../sessions.js", () => ({
  addAccessGrant: vi.fn(),
}));
vi.mock("../config.js", () => ({
  getSlackAccessMode: vi.fn(),
}));

import {
  checkConversationAccess,
  checkFileAccess,
  clearRequesterAccessCache,
} from "./requesterAccess.js";
import { getSlackAccessMode } from "../config.js";
import { addAccessGrant } from "../sessions.js";
import { createSlackClientMock, type MockSlackClient } from "./testSlackClient.js";
import {
  PRIVATE,
  makeRequest,
  makeSession,
  setConversations,
  setFile,
  setMembers,
} from "./requesterAccess.testHelpers.js";

describe("requesterAccess: slackAccessMode", () => {
  let client: MockSlackClient;

  beforeEach(() => {
    vi.clearAllMocks();
    clearRequesterAccessCache();
    client = createSlackClientMock();
    setConversations(client);
    setMembers(client);
  });

  describe('"bot"', () => {
    beforeEach(() => {
      vi.mocked(getSlackAccessMode).mockReturnValue("bot");
    });

    it("allows a private channel the requester is not in, without asking Slack", async () => {
      expect(await checkConversationAccess(makeRequest(client), PRIVATE)).toEqual({
        allowed: true,
      });
      expect(client.conversations.info).not.toHaveBeenCalled();
      expect(client.conversations.members).not.toHaveBeenCalled();
    });

    it("allows a run with no requester on a private channel", async () => {
      const request = makeRequest(client, { role: "system", userId: "plugin:idler" });

      expect(await checkConversationAccess(request, PRIVATE)).toEqual({ allowed: true });
    });

    it("records no session grant", async () => {
      const session = makeSession();

      await checkConversationAccess(makeRequest(client, { session }), PRIVATE);

      expect(addAccessGrant).not.toHaveBeenCalled();
      expect(session.accessGranted).toBeUndefined();
    });

    it("allows a file the requester has no evidence for and reports the bot's access", async () => {
      setFile(client, { user: "U_OTHER", groups: [PRIVATE], access: "write" });
      const session = makeSession();

      expect(await checkFileAccess(makeRequest(client, { session }), "F1")).toEqual({
        allowed: true,
        botAccess: "write",
        creator: "U_OTHER",
      });
      expect(client.conversations.members).not.toHaveBeenCalled();
      expect(addAccessGrant).not.toHaveBeenCalled();
    });

    it("still denies a file the bot cannot see", async () => {
      client.files.info.mockRejectedValue(new Error("not_visible"));

      expect(await checkFileAccess(makeRequest(client), "F1")).toEqual({
        allowed: false,
        reason: "file_unavailable",
      });
    });
  });

  describe('"requester"', () => {
    it("evaluates the requester", async () => {
      vi.mocked(getSlackAccessMode).mockReturnValue("requester");

      expect(await checkConversationAccess(makeRequest(client), PRIVATE)).toEqual({
        allowed: false,
        reason: "not_member",
      });
      expect(client.conversations.members).toHaveBeenCalled();
    });
  });
});
