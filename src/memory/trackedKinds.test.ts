import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MemoryEntry } from "../memoryRegistry.js";
import type { UserRole } from "../roles.js";
import {
  namespaceOf,
  listTrackedKinds,
  buildTrackedMemoryKinds,
  trackedMemoryKindsForRole,
} from "./trackedKinds.js";

const { listMemory, canAccessMemory } = vi.hoisted(() => ({
  listMemory: vi.fn<() => Promise<MemoryEntry[]>>(),
  canAccessMemory: vi.fn<(role: UserRole) => boolean>(),
}));

vi.mock("../memoryRegistry.js", () => ({
  listMemory: () => listMemory(),
}));

vi.mock("../permissions.js", () => ({
  canAccessMemory: (role: UserRole) => canAccessMemory(role),
}));

function entry(id: string): MemoryEntry {
  return {
    id,
    what: "",
    why: "",
    references: [],
    linkedMemories: [],
    createdAt: "",
    updatedAt: "",
  };
}

describe("namespaceOf", () => {
  it("returns the segment before the first colon", () => {
    expect(namespaceOf("clack-pr:pr-4499")).toBe("clack-pr");
    expect(namespaceOf("fun:dad-joke-1")).toBe("fun");
  });

  it("returns only up to the FIRST colon when several are present", () => {
    expect(namespaceOf("asana:asana:1214")).toBe("asana");
  });

  it("returns null for an id with no colon", () => {
    expect(namespaceOf("orphan-id")).toBeNull();
  });

  it("returns null for an id that starts with a colon (no namespace)", () => {
    expect(namespaceOf(":leading")).toBeNull();
  });
});

describe("listTrackedKinds", () => {
  beforeEach(() => listMemory.mockReset());

  it("returns distinct namespaces sorted and de-duplicated", async () => {
    listMemory.mockResolvedValue([
      entry("clack-pr:pr-4499"),
      entry("clack-pr:pr-4468"),
      entry("asana:asana-1214"),
      entry("fun:dad-joke-1"),
    ]);
    expect(await listTrackedKinds()).toEqual(["asana", "clack-pr", "fun"]);
  });

  it("excludes ids that carry no namespace", async () => {
    listMemory.mockResolvedValue([entry("note:thing"), entry("orphan-id")]);
    expect(await listTrackedKinds()).toEqual(["note"]);
  });

  it("returns an empty list for an empty store", async () => {
    listMemory.mockResolvedValue([]);
    expect(await listTrackedKinds()).toEqual([]);
  });
});

describe("buildTrackedMemoryKinds", () => {
  beforeEach(() => listMemory.mockReset());

  it("names the distinct kinds when entries exist", async () => {
    listMemory.mockResolvedValue([entry("clack-pr:pr-1"), entry("asana:t-1")]);
    const block = await buildTrackedMemoryKinds();
    expect(block).toContain("asana, clack-pr");
    expect(block).toContain("recall");
  });

  it("returns an empty string when nothing is tracked", async () => {
    listMemory.mockResolvedValue([]);
    expect(await buildTrackedMemoryKinds()).toBe("");
  });

  it("returns an empty string when only namespace-less ids exist", async () => {
    listMemory.mockResolvedValue([entry("orphan")]);
    expect(await buildTrackedMemoryKinds()).toBe("");
  });
});

describe("trackedMemoryKindsForRole", () => {
  beforeEach(() => {
    listMemory.mockReset();
    canAccessMemory.mockReset();
  });

  it("returns the block when the role can access memory", async () => {
    canAccessMemory.mockReturnValue(true);
    listMemory.mockResolvedValue([entry("clack-pr:pr-1")]);
    expect(await trackedMemoryKindsForRole("member")).toContain("clack-pr");
  });

  it("returns an empty string without reading the store when the role cannot access memory", async () => {
    canAccessMemory.mockReturnValue(false);
    expect(await trackedMemoryKindsForRole("member")).toBe("");
    expect(listMemory).not.toHaveBeenCalled();
  });

  it("defaults an absent role to member when gating", async () => {
    canAccessMemory.mockReturnValue(true);
    listMemory.mockResolvedValue([]);
    await trackedMemoryKindsForRole(undefined);
    expect(canAccessMemory).toHaveBeenCalledWith("member");
  });
});
