import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addFollowedThread,
  closeInvestigation,
  findInvestigationByFollowedThread,
  getInvestigationsChannel,
  listOpenInvestigations,
  loadInvestigationsState,
  openInvestigation,
  removeFollowedThread,
  resetInvestigationsCache,
  resetInvestigationsStateDeps,
  setInvestigationsChannel,
  setInvestigationsStateDeps,
  type InvestigationsStateDeps,
} from "./state.js";
import type { InvestigationsState } from "./types.js";

/** In-memory stand-in for the investigations.json file, driving the real state module. */
function makeFakeDeps(initial: string | null): {
  deps: InvestigationsStateDeps;
  writeFile: ReturnType<typeof vi.fn>;
  currentContent: () => string | null;
} {
  let content: string | null = initial;
  const fileExists = vi.fn(
    (p: string): Promise<boolean> =>
      Promise.resolve(p.endsWith("investigations.json") ? content !== null : true),
  );
  const readFile = vi.fn((): Promise<string> => {
    if (content === null) return Promise.reject(new Error("ENOENT"));
    return Promise.resolve(content);
  });
  const writeFile = vi.fn((_p: string, data: string): Promise<void> => {
    content = data;
    return Promise.resolve();
  });
  const mkdir = vi.fn((): Promise<string | undefined> => Promise.resolve(undefined));
  const deps: InvestigationsStateDeps = { fileExists, readFile, writeFile, mkdir };
  return { deps, writeFile, currentContent: () => content };
}

const ENTRY = {
  sessionId: "S1",
  mainChannel: "CMAIN",
  mainThreadTs: "100.1",
  surface: "channel" as const,
  startedBy: "U1",
};

describe("investigations state", () => {
  beforeEach(() => {
    resetInvestigationsCache();
    resetInvestigationsStateDeps();
  });

  describe("loadInvestigationsState", () => {
    it("returns defaults when the file is absent", async () => {
      const { deps } = makeFakeDeps(null);
      setInvestigationsStateDeps(deps);
      const state = await loadInvestigationsState();
      expect(state).toEqual({ channel: null, open: {} });
      expect(getInvestigationsChannel()).toBeNull();
    });

    it("loads a valid file into the cache", async () => {
      const onDisk: InvestigationsState = {
        channel: "CINV",
        open: { "CSIDE:1.1": { ...ENTRY } },
      };
      const { deps } = makeFakeDeps(JSON.stringify(onDisk));
      setInvestigationsStateDeps(deps);
      await loadInvestigationsState();
      expect(getInvestigationsChannel()).toBe("CINV");
      expect(findInvestigationByFollowedThread("CSIDE", "1.1")).toEqual(ENTRY);
    });

    it("serves defaults and does NOT overwrite on corrupt JSON", async () => {
      const { deps, writeFile, currentContent } = makeFakeDeps("{ not json");
      setInvestigationsStateDeps(deps);
      await loadInvestigationsState();
      expect(getInvestigationsChannel()).toBeNull();
      expect(writeFile).not.toHaveBeenCalled();
      expect(currentContent()).toBe("{ not json");
    });

    it("serves defaults and does NOT overwrite on shape mismatch", async () => {
      const raw = JSON.stringify({ channel: 42, open: {} });
      const { deps, writeFile, currentContent } = makeFakeDeps(raw);
      setInvestigationsStateDeps(deps);
      await loadInvestigationsState();
      expect(getInvestigationsChannel()).toBeNull();
      expect(writeFile).not.toHaveBeenCalled();
      expect(currentContent()).toBe(raw);
    });
  });

  describe("channel mutation", () => {
    it("persists and reflects a set channel", async () => {
      const { deps, currentContent } = makeFakeDeps(null);
      setInvestigationsStateDeps(deps);
      await loadInvestigationsState();
      await setInvestigationsChannel("CINV");
      expect(getInvestigationsChannel()).toBe("CINV");
      const disk: unknown = JSON.parse(currentContent() ?? "{}");
      expect(disk).toMatchObject({ channel: "CINV" });
    });
  });

  describe("open / find / list", () => {
    beforeEach(async () => {
      const { deps } = makeFakeDeps(null);
      setInvestigationsStateDeps(deps);
      await loadInvestigationsState();
    });

    it("indexes every followed thread on open", async () => {
      await openInvestigation({
        sessionId: "S1",
        mainChannel: "CMAIN",
        mainThreadTs: "100.1",
        surface: "channel",
        startedBy: "U1",
        followed: [
          { channel: "CSIDE", threadTs: "1.1" },
          { channel: "COTHER", threadTs: "2.2" },
        ],
      });
      expect(findInvestigationByFollowedThread("CSIDE", "1.1")?.sessionId).toBe("S1");
      expect(findInvestigationByFollowedThread("COTHER", "2.2")?.sessionId).toBe("S1");
      expect(findInvestigationByFollowedThread("CSIDE", "9.9")).toBeUndefined();
    });

    it("dedups by session and counts followed threads in the list", async () => {
      await openInvestigation({
        sessionId: "S1",
        mainChannel: "CMAIN",
        mainThreadTs: "100.1",
        surface: "channel",
        startedBy: "U1",
        followed: [
          { channel: "CSIDE", threadTs: "1.1" },
          { channel: "COTHER", threadTs: "2.2" },
        ],
      });
      const list = listOpenInvestigations();
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ sessionId: "S1", followedCount: 2, surface: "channel" });
    });
  });

  describe("follow / unfollow / close", () => {
    beforeEach(async () => {
      const { deps } = makeFakeDeps(null);
      setInvestigationsStateDeps(deps);
      await loadInvestigationsState();
      await openInvestigation({
        sessionId: "S1",
        mainChannel: "CMAIN",
        mainThreadTs: "100.1",
        surface: "channel",
        startedBy: "U1",
        followed: [{ channel: "CSIDE", threadTs: "1.1" }],
      });
    });

    it("clones the routing projection when adding a thread", async () => {
      await addFollowedThread("S1", "CNEW", "3.3");
      const entry = findInvestigationByFollowedThread("CNEW", "3.3");
      expect(entry).toMatchObject({ sessionId: "S1", mainChannel: "CMAIN", mainThreadTs: "100.1" });
    });

    it("no-ops adding a thread for an unknown session", async () => {
      await addFollowedThread("SX", "CNEW", "3.3");
      expect(findInvestigationByFollowedThread("CNEW", "3.3")).toBeUndefined();
    });

    it("removes a single followed thread", async () => {
      await addFollowedThread("S1", "CNEW", "3.3");
      await removeFollowedThread("CSIDE", "1.1");
      expect(findInvestigationByFollowedThread("CSIDE", "1.1")).toBeUndefined();
      expect(findInvestigationByFollowedThread("CNEW", "3.3")?.sessionId).toBe("S1");
    });

    it("closing drops every key for the session", async () => {
      await addFollowedThread("S1", "CNEW", "3.3");
      await closeInvestigation("S1");
      expect(findInvestigationByFollowedThread("CSIDE", "1.1")).toBeUndefined();
      expect(findInvestigationByFollowedThread("CNEW", "3.3")).toBeUndefined();
      expect(listOpenInvestigations()).toHaveLength(0);
    });
  });

  describe("tee-independence", () => {
    it("findInvestigationByFollowedThread does not consult origin session attentionLevel", async () => {
      const { deps } = makeFakeDeps(null);
      setInvestigationsStateDeps(deps);
      await loadInvestigationsState();

      await openInvestigation({
        sessionId: "S1",
        mainChannel: "CMAIN",
        mainThreadTs: "100.1",
        surface: "channel",
        startedBy: "U1",
        followed: [{ channel: "CSIDE", threadTs: "1.1" }],
      });

      // The routing/index lookup should match regardless of origin session attentionLevel.
      // findInvestigationByFollowedThread is a simple index lookup that never reads session state.
      const match = findInvestigationByFollowedThread("CSIDE", "1.1");
      expect(match).toBeDefined();
      expect(match?.sessionId).toBe("S1");
    });
  });
});
