import { describe, it, expect, vi, beforeEach } from "vitest";
import { setupMemoryId, loadSetupNotes } from "./setupMemory.js";
import { getMemory, type MemoryEntry } from "../memoryRegistry.js";

vi.mock("../memoryRegistry.js", () => ({
  getMemory: vi.fn(),
}));

const getMemoryMock = vi.mocked(getMemory);

function makeEntry(what: string): MemoryEntry {
  return {
    id: "worker-setup:acme",
    what,
    why: "learned during a worker run",
    references: [],
    linkedMemories: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
  };
}

describe("setupMemoryId", () => {
  it("builds the worker and tester keyed ids", () => {
    expect(setupMemoryId("worker", "acme")).toBe("worker-setup:acme");
    expect(setupMemoryId("tester", "acme")).toBe("tester-setup:acme");
  });
});

describe("loadSetupNotes", () => {
  beforeEach(() => {
    getMemoryMock.mockReset();
  });

  it("returns the entry's what text when present", async () => {
    getMemoryMock.mockResolvedValue(makeEntry("## Services\n- web: pnpm dev, port 3000"));
    const notes = await loadSetupNotes("worker", "acme");
    expect(notes).toBe("## Services\n- web: pnpm dev, port 3000");
    expect(getMemoryMock).toHaveBeenCalledWith("worker-setup:acme");
  });

  it("looks up the tester key for tester runs", async () => {
    getMemoryMock.mockResolvedValue(null);
    await loadSetupNotes("tester", "acme");
    expect(getMemoryMock).toHaveBeenCalledWith("tester-setup:acme");
  });

  it("returns null when no entry exists", async () => {
    getMemoryMock.mockResolvedValue(null);
    expect(await loadSetupNotes("worker", "acme")).toBeNull();
  });

  it("returns null for a whitespace-only what", async () => {
    getMemoryMock.mockResolvedValue(makeEntry("   \n  "));
    expect(await loadSetupNotes("worker", "acme")).toBeNull();
  });

  it("returns null when the store lookup throws", async () => {
    getMemoryMock.mockRejectedValue(new Error("store corrupted"));
    expect(await loadSetupNotes("tester", "acme")).toBeNull();
  });
});
