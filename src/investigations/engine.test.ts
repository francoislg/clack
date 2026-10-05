import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import type { SessionContext } from "../sessions.js";
import type { FollowMode, FollowedThread, InvestigationSummary } from "./types.js";
import type { OpenInvestigationEntry } from "./types.js";

// Every collaborator the tested paths touch is mocked at the module boundary; the engine
// orchestration runs for real. Each mock is programmed per test with exactly what the claim
// needs, and interactions are asserted off the mock.
vi.mock("../slack/handlers/core.js", () => ({
  processMessage: vi.fn(),
  setInvestigationSessionRefresher: vi.fn(),
}));
vi.mock("../slack/botIdentity.js", () => ({
  getBotIdentity: vi.fn(),
}));
vi.mock("../claude/preAnalysis.js", () => ({
  runInvestigationPreAnalysis: vi.fn(),
}));
vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  return { ...actual, getConfig: vi.fn() };
});
vi.mock("./state.js", () => ({
  findInvestigationByFollowedThread: vi.fn(),
  getInvestigationsChannel: vi.fn(),
  listOpenInvestigations: vi.fn(),
  openInvestigation: vi.fn(),
}));
vi.mock("../sessions.js", () => ({
  createSession: vi.fn(),
  findSessionByThread: vi.fn(),
  getSession: vi.fn(),
  updateSession: vi.fn(),
}));
vi.mock("./drain.js", () => ({
  drainFollowedThreads: vi.fn(),
}));
vi.mock("../userPreferences.js", () => ({
  getUserPreference: vi.fn(),
}));
vi.mock("../slack/userCache.js", () => ({
  getUserInfo: vi.fn(),
}));
vi.mock("../slack/channelResolver.js", () => ({
  openDmChannel: vi.fn(),
}));
vi.mock("../slack/botMembership.js", () => ({
  isBotInConversation: vi.fn(),
}));

import {
  bootstrapInvestigation,
  handleFollowedThreadEvent,
  reconcileInvestigationsOnBoot,
  runInvestigationRound,
} from "./engine.js";
import { getConfig } from "../config.js";
import { getBotIdentity } from "../slack/botIdentity.js";
import { runInvestigationPreAnalysis } from "../claude/preAnalysis.js";
import { processMessage } from "../slack/handlers/core.js";
import {
  findInvestigationByFollowedThread,
  getInvestigationsChannel,
  listOpenInvestigations,
  openInvestigation,
} from "./state.js";
import { createSession, findSessionByThread, getSession, updateSession } from "../sessions.js";
import { drainFollowedThreads } from "./drain.js";
import { getUserPreference } from "../userPreferences.js";
import { getUserInfo } from "../slack/userCache.js";
import { openDmChannel } from "../slack/channelResolver.js";
import { isBotInConversation } from "../slack/botMembership.js";
import { createSlackClientMock } from "../slack/testSlackClient.js";
import { stub } from "../testStubs.js";

const ORIGIN = { channel: "CSIDE", threadTs: "1000.0001" };

function anchor(sessionId: string): InvestigationSummary {
  return {
    sessionId,
    mainChannel: "CMAIN",
    mainThreadTs: "2000.0001",
    surface: "channel",
    startedBy: "U1",
    subject: "the incident",
    followedCount: 1,
  };
}

function entry(sessionId: string): OpenInvestigationEntry {
  return {
    sessionId,
    mainChannel: "CMAIN",
    mainThreadTs: "2000.0001",
    surface: "channel",
    startedBy: "U1",
    subject: "the incident",
  };
}

function followed(mode: FollowMode): FollowedThread {
  return {
    channel: ORIGIN.channel,
    threadTs: ORIGIN.threadTs,
    mode,
    lastInjectedTs: "0",
    pendingCount: 0,
    addedBy: "U1",
  };
}

function makeSession(sessionId: string, followedThreads: FollowedThread[]): SessionContext {
  return {
    sessionId,
    channelId: "CMAIN",
    messageTs: "2000.0001",
    threadTs: "2000.0001",
    userId: "U1",
    trigger: { type: "mentions", userId: "U1", messageTs: "2000.0001", messageText: "inv" },
    messages: [],
    threadContext: [],
    errors: [],
    lastActivity: 0,
    createdAt: 0,
    followedThreads,
  };
}

describe("investigations engine (unit)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getConfig).mockReturnValue(
      stub<Config>({
        investigations: { enabled: true, emoji: "mag" },
        slackApp: { name: "Clack" },
      }),
    );
    vi.mocked(getBotIdentity).mockResolvedValue({
      botUserId: "BOT",
      botId: "B1",
      teamId: "T1",
    });
    vi.mocked(processMessage).mockResolvedValue({ success: true, answer: "" });
    vi.mocked(runInvestigationPreAnalysis).mockResolvedValue("skip");
    vi.mocked(findInvestigationByFollowedThread).mockReturnValue(undefined);
    vi.mocked(getInvestigationsChannel).mockReturnValue("CINV");
    vi.mocked(listOpenInvestigations).mockReturnValue([]);
    vi.mocked(openInvestigation).mockResolvedValue(undefined);
    vi.mocked(getSession).mockResolvedValue(null);
    vi.mocked(findSessionByThread).mockResolvedValue(null);
    vi.mocked(createSession).mockResolvedValue(makeSession("SID", []));
    vi.mocked(updateSession).mockResolvedValue(makeSession("SID", []));
    vi.mocked(drainFollowedThreads).mockResolvedValue({
      injectedContext: "",
      updatedThreads: [],
      drainedAny: false,
    });
    vi.mocked(getUserPreference).mockResolvedValue(undefined);
    vi.mocked(getUserInfo).mockResolvedValue({ userId: "U1", displayName: "Requester Name" });
    vi.mocked(openDmChannel).mockResolvedValue("DMROOM");
    vi.mocked(isBotInConversation).mockResolvedValue(true);
  });

  describe("runInvestigationRound", () => {
    it("defers progress false by default, forwarding the anchor's main surface", async () => {
      vi.mocked(listOpenInvestigations).mockReturnValue([anchor("SID")]);
      await runInvestigationRound(createSlackClientMock(), "SID", "U1", "text");
      expect(processMessage).toHaveBeenCalledTimes(1);
      expect(vi.mocked(processMessage).mock.calls[0]?.[0]).toMatchObject({
        deferProgress: false,
        resumeSessionId: "SID",
        triggerType: "mentions",
        channelId: "CMAIN",
        threadTs: "2000.0001",
      });
    });

    it("forwards deferProgress when the caller sets it", async () => {
      vi.mocked(listOpenInvestigations).mockReturnValue([anchor("SID")]);
      await runInvestigationRound(createSlackClientMock(), "SID", "U1", "text", {
        deferProgress: true,
      });
      expect(vi.mocked(processMessage).mock.calls[0]?.[0]).toMatchObject({ deferProgress: true });
    });
  });

  it("handleFollowedThreadEvent (followAndInteract + respond) defers progress", async () => {
    vi.mocked(findInvestigationByFollowedThread).mockReturnValue(entry("SID"));
    vi.mocked(getSession).mockResolvedValue(makeSession("SID", [followed("followAndInteract")]));
    vi.mocked(runInvestigationPreAnalysis).mockResolvedValue("respond");
    vi.mocked(listOpenInvestigations).mockReturnValue([anchor("SID")]);

    await handleFollowedThreadEvent(createSlackClientMock(), {
      channel: ORIGIN.channel,
      threadTs: ORIGIN.threadTs,
      userId: "U2",
      text: "the deploy failed again",
    });

    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processMessage).mock.calls[0]?.[0]).toMatchObject({ deferProgress: true });
  });

  it("reconcileInvestigationsOnBoot (drained followAndInteract + respond) defers progress", async () => {
    vi.mocked(listOpenInvestigations).mockReturnValue([anchor("SID")]);
    vi.mocked(getSession).mockResolvedValue(makeSession("SID", [followed("followAndInteract")]));
    vi.mocked(drainFollowedThreads).mockResolvedValue({
      injectedContext: "activity",
      updatedThreads: [followed("followAndInteract")],
      drainedAny: true,
    });
    vi.mocked(runInvestigationPreAnalysis).mockResolvedValue("respond");

    await reconcileInvestigationsOnBoot(createSlackClientMock());

    expect(processMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(processMessage).mock.calls[0]?.[0]).toMatchObject({ deferProgress: true });
  });

  it("bootstrapInvestigation runs its first round without deferring progress", async () => {
    vi.mocked(createSession).mockResolvedValue(
      makeSession("SID-boot", [followed("followAndInteract")]),
    );
    vi.mocked(listOpenInvestigations).mockReturnValue([anchor("SID-boot")]);

    const result = await bootstrapInvestigation({
      client: createSlackClientMock(),
      surface: "channel",
      originChannel: ORIGIN.channel,
      originThreadTs: ORIGIN.threadTs,
      requester: "U1",
    });
    expect(result.status).toBe("ok");

    // The first round is launched detached; drain pending microtasks before asserting.
    await vi.waitFor(() => expect(processMessage).toHaveBeenCalled());
    expect(vi.mocked(processMessage).mock.calls[0]?.[0]).toMatchObject({ deferProgress: false });
  });

  it("bootstrapInvestigation refuses an origin the bot is not in", async () => {
    vi.mocked(isBotInConversation).mockResolvedValue(false);
    const client = createSlackClientMock();

    const result = await bootstrapInvestigation({
      client,
      surface: "channel",
      originChannel: ORIGIN.channel,
      originThreadTs: ORIGIN.threadTs,
      requester: "U1",
    });

    expect(result).toEqual({ status: "not_in_channel" });
    expect(isBotInConversation).toHaveBeenCalledWith(client, ORIGIN.channel);
  });

  describe("bootstrapInvestigation access grants", () => {
    function bootstrap() {
      return bootstrapInvestigation({
        client: createSlackClientMock(),
        surface: "channel",
        originChannel: ORIGIN.channel,
        originThreadTs: ORIGIN.threadTs,
        requester: "U1",
      });
    }

    it("copies the origin session's grants onto the investigation session", async () => {
      const grants = ["CPRIV", "F123"];
      const origin = { ...makeSession("SID-origin", []), accessGranted: grants };
      vi.mocked(findSessionByThread).mockResolvedValue(origin);

      const result = await bootstrap();

      expect(result.status).toBe("ok");
      expect(findSessionByThread).toHaveBeenCalledWith(ORIGIN.channel, ORIGIN.threadTs);
      expect(updateSession).toHaveBeenCalledWith(
        "SID",
        expect.objectContaining({ accessGranted: ["CPRIV", "F123"] }),
      );
      const updates = vi.mocked(updateSession).mock.calls[0]?.[1];
      expect(updates?.accessGranted).not.toBe(grants);
      expect(updates?.followedThreads).toHaveLength(1);
    });

    it("starts with no grants when the origin message has no session", async () => {
      vi.mocked(findSessionByThread).mockResolvedValue(null);

      const result = await bootstrap();

      expect(result.status).toBe("ok");
      const updates = vi.mocked(updateSession).mock.calls[0]?.[1];
      expect(updates?.followedThreads).toHaveLength(1);
      expect(updates).not.toHaveProperty("accessGranted");
    });

    it("starts with no grants when the origin session holds none", async () => {
      vi.mocked(findSessionByThread).mockResolvedValue(makeSession("SID-origin", []));

      await bootstrap();

      expect(vi.mocked(updateSession).mock.calls[0]?.[1]).not.toHaveProperty("accessGranted");
    });

    it("continues with no grants when the origin session lookup fails", async () => {
      vi.mocked(findSessionByThread).mockRejectedValue(new Error("disk unreadable"));

      const result = await bootstrap();

      expect(result.status).toBe("ok");
      expect(vi.mocked(updateSession).mock.calls[0]?.[1]).not.toHaveProperty("accessGranted");
    });
  });
});
