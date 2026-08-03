import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { App } from "@slack/bolt";
import { WebClient } from "@slack/web-api";
import type { Config } from "../config.js";
import type { DrainMessage } from "./drain.js";

// Mock only the boundaries: the Claude run (processMessage), bot identity, and the classifier.
// State, sessions, drain, and delivery-context run for real.
vi.mock("../slack/handlers/core.js", () => ({
  processMessage: vi.fn(() => Promise.resolve({ success: true })),
  setInvestigationSessionRefresher: vi.fn(),
}));
vi.mock("../slack/botIdentity.js", () => ({
  getBotIdentity: vi.fn(() => Promise.resolve({ botUserId: "BOT", botId: "B1" })),
}));
vi.mock("../claude/preAnalysis.js", () => ({
  runInvestigationPreAnalysis: vi.fn(),
}));
vi.mock("../config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config.js")>();
  const getConfig = (): Config => {
    const partial: Partial<Config> = {
      investigations: { enabled: true, emoji: "mag" },
      slackApp: { name: "Clack" },
    };
    return partial as Config;
  };
  return { ...actual, getConfig: vi.fn(getConfig) };
});

import {
  bootstrapInvestigation,
  handleFollowedThreadEvent,
  reconcileInvestigationsOnBoot,
  refreshInvestigationSession,
} from "./engine.js";
import {
  findInvestigationByFollowedThread,
  loadInvestigationsState,
  openInvestigation,
  resetInvestigationsCache,
  resetInvestigationsStateDeps,
  setInvestigationsStateDeps,
  setInvestigationsChannel,
  closeInvestigation,
  type InvestigationsStateDeps,
} from "./state.js";
import { createSession, getSession, updateSession } from "../sessions.js";
import { runInvestigationPreAnalysis } from "../claude/preAnalysis.js";
import { processMessage } from "../slack/handlers/core.js";
import type { FollowedThread } from "./types.js";

function inMemoryStateDeps(): InvestigationsStateDeps {
  let content: string | null = null;
  return {
    fileExists: (p: string) =>
      Promise.resolve(p.endsWith("investigations.json") ? content !== null : true),
    readFile: () =>
      content === null ? Promise.reject(new Error("ENOENT")) : Promise.resolve(content),
    writeFile: (_p: string, data: string) => {
      content = data;
      return Promise.resolve();
    },
    mkdir: () => Promise.resolve(undefined),
  };
}

function makeClient(
  byChannel: Record<string, DrainMessage[]> = {},
  opts: { joinError?: unknown } = {},
): App["client"] {
  const client = new WebClient();
  vi.spyOn(client.conversations, "replies").mockImplementation((args) => {
    const all = byChannel[args?.channel ?? ""] ?? [];
    const oldest = args?.oldest;
    const messages = oldest ? all.filter((m) => m.ts != null && m.ts >= oldest) : all;
    return Promise.resolve({ ok: true, messages });
  });
  const join = vi.spyOn(client.conversations, "join");
  if (opts.joinError !== undefined) join.mockRejectedValue(opts.joinError);
  else join.mockResolvedValue({ ok: true });
  vi.spyOn(client.chat, "postMessage").mockResolvedValue({ ok: true, ts: "3000.0001" });
  vi.spyOn(client.chat, "getPermalink").mockResolvedValue({ ok: true, permalink: "https://x/p" });
  return client;
}

const ORIGIN = { channel: "CSIDE", threadTs: "1000.0001" };

async function setupInvestigation(mode: FollowedThread["mode"]): Promise<string> {
  const session = await createSession({
    channelId: "CMAIN",
    messageTs: "2000.0001",
    threadTs: "2000.0001",
    userId: "U1",
    trigger: { type: "mentions", userId: "U1", messageTs: "2000.0001", messageText: "inv" },
  });
  const origin: FollowedThread = {
    channel: ORIGIN.channel,
    threadTs: ORIGIN.threadTs,
    mode,
    lastInjectedTs: "0",
    pendingCount: 0,
    addedBy: "U1",
  };
  await updateSession(session.sessionId, { followedThreads: [origin] });
  await openInvestigation({
    sessionId: session.sessionId,
    mainChannel: "CMAIN",
    mainThreadTs: "2000.0001",
    surface: "channel",
    startedBy: "U1",
    subject: "the incident",
    followed: [ORIGIN],
  });
  return session.sessionId;
}

describe("investigations engine (integration)", () => {
  const tmpBase = resolve(tmpdir(), `inv-engine-${process.pid}`);
  const originalCwd = process.cwd();

  beforeEach(async () => {
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    mkdirSync(join(tmpBase, "data", "sessions"), { recursive: true });
    mkdirSync(join(tmpBase, "data", "state"), { recursive: true });
    process.chdir(tmpBase);
    resetInvestigationsCache();
    resetInvestigationsStateDeps();
    setInvestigationsStateDeps(inMemoryStateDeps());
    await loadInvestigationsState();
    vi.mocked(processMessage).mockClear();
    vi.mocked(runInvestigationPreAnalysis).mockReset();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tmpBase)) rmSync(tmpBase, { recursive: true });
    resetInvestigationsStateDeps();
  });

  it("follow mode: a side message only increments the persisted pending count", async () => {
    const sessionId = await setupInvestigation("follow");
    await handleFollowedThreadEvent(makeClient({}), {
      channel: ORIGIN.channel,
      threadTs: ORIGIN.threadTs,
      userId: "U2",
      text: "new info",
    });
    expect(processMessage).not.toHaveBeenCalled();
    expect(runInvestigationPreAnalysis).not.toHaveBeenCalled();
    const reloaded = await getSession(sessionId);
    expect(reloaded?.followedThreads?.[0].pendingCount).toBe(1);
  });

  it("followAndInteract + respond: drives a resumed round on the main session", async () => {
    const sessionId = await setupInvestigation("followAndInteract");
    vi.mocked(runInvestigationPreAnalysis).mockResolvedValue("respond");
    await handleFollowedThreadEvent(makeClient({}), {
      channel: ORIGIN.channel,
      threadTs: ORIGIN.threadTs,
      userId: "U2",
      text: "the deploy failed again",
    });
    expect(runInvestigationPreAnalysis).toHaveBeenCalledWith(
      "the incident",
      "the deploy failed again",
      "Clack",
    );
    expect(processMessage).toHaveBeenCalledTimes(1);
    const call = vi.mocked(processMessage).mock.calls[0]?.[0];
    expect(call).toMatchObject({ resumeSessionId: sessionId, channelId: "CMAIN" });
  });

  it("refreshInvestigationSession drains new side messages into the delivery context", async () => {
    const sessionId = await setupInvestigation("followAndInteract");
    const session = await getSession(sessionId);
    expect(session).not.toBeNull();
    const client = makeClient({
      CSIDE: [
        { ts: "1000.0001", user: "U1", text: "thread root" },
        { ts: "1000.0002", user: "U2", text: "found a clue" },
      ],
    });
    if (!session) throw new Error("no session");
    const refreshed = await refreshInvestigationSession(session, client);
    expect(refreshed.additionalSystemPrompt).toContain("INVESTIGATION SURFACE");
    expect(refreshed.additionalSystemPrompt).toContain("found a clue");
    expect(refreshed.followedThreads?.[0].lastInjectedTs).toBe("1000.0002");
    // Persisted, so a later round sees the advanced cursor.
    const reloaded = await getSession(sessionId);
    expect(reloaded?.followedThreads?.[0].lastInjectedTs).toBe("1000.0002");
  });

  it("close stops routing: the followed thread no longer resolves to an investigation", async () => {
    const sessionId = await setupInvestigation("followAndInteract");
    expect(findInvestigationByFollowedThread(ORIGIN.channel, ORIGIN.threadTs)).toBeDefined();
    await closeInvestigation(sessionId);
    expect(findInvestigationByFollowedThread(ORIGIN.channel, ORIGIN.threadTs)).toBeUndefined();
    vi.mocked(runInvestigationPreAnalysis).mockResolvedValue("respond");
    await handleFollowedThreadEvent(makeClient({}), {
      channel: ORIGIN.channel,
      threadTs: ORIGIN.threadTs,
      userId: "U2",
      text: "post-close message",
    });
    expect(processMessage).not.toHaveBeenCalled();
  });

  describe("bootstrapInvestigation", () => {
    it("rejects the cycle: origin thread inside the investigations channel", async () => {
      await setInvestigationsChannel("CINV");
      const result = await bootstrapInvestigation({
        client: makeClient(),
        surface: "channel",
        originChannel: "CINV",
        originThreadTs: "1.1",
        requester: "U1",
      });
      expect(result.status).toBe("cycle");
    });

    it("returns channel_not_configured when no channel is set", async () => {
      const result = await bootstrapInvestigation({
        client: makeClient(),
        surface: "channel",
        originChannel: "CSIDE",
        originThreadTs: "1.1",
        requester: "U1",
      });
      expect(result.status).toBe("channel_not_configured");
    });

    it("degrades the origin thread to follow mode when the public join fails", async () => {
      await setInvestigationsChannel("CINV");
      const client = makeClient({}, { joinError: { data: { error: "restricted_action" } } });
      const result = await bootstrapInvestigation({
        client,
        surface: "channel",
        originChannel: "CSIDE",
        originThreadTs: "1.1",
        requester: "U1",
        originMode: "followAndInteract",
      });
      expect(result.status).toBe("ok");
      if (result.status !== "ok") throw new Error("expected ok");
      expect(result.degraded).toBe(true);
      const session = await getSession(result.sessionId);
      expect(session?.followedThreads?.[0].mode).toBe("follow");
      expect(processMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("reconcileInvestigationsOnBoot", () => {
    it("fires a round for a followAndInteract thread with undrained messages on respond", async () => {
      await setupInvestigation("followAndInteract");
      vi.mocked(runInvestigationPreAnalysis).mockResolvedValue("respond");
      const client = makeClient({
        CSIDE: [
          { ts: "1000.0001", user: "U1", text: "root" },
          { ts: "1000.0002", user: "U2", text: "missed while down" },
        ],
      });
      await reconcileInvestigationsOnBoot(client);
      expect(processMessage).toHaveBeenCalledTimes(1);
    });

    it("does not fire a round on a skip verdict", async () => {
      await setupInvestigation("followAndInteract");
      vi.mocked(runInvestigationPreAnalysis).mockResolvedValue("skip");
      const client = makeClient({
        CSIDE: [
          { ts: "1000.0001", user: "U1", text: "root" },
          { ts: "1000.0002", user: "U2", text: "noise" },
        ],
      });
      await reconcileInvestigationsOnBoot(client);
      expect(processMessage).not.toHaveBeenCalled();
    });
  });
});
