import { describe, it, expect, vi } from "vitest";
import { refreshUserDisplayNames } from "./refreshDisplayNames.js";
import type { TriviaUser } from "../../core/types.js";

function makeUser(overrides: Partial<TriviaUser> & { userId: string }): TriviaUser {
  return {
    userId: overrides.userId,
    displayName: overrides.displayName ?? "Old Name",
    joinedAt: overrides.joinedAt ?? 0,
    ...(overrides.cheatAttempts !== undefined ? { cheatAttempts: overrides.cheatAttempts } : {}),
  };
}

const silentLogger = { debug: () => {}, warn: () => {} };

describe("refreshUserDisplayNames", () => {
  it("persists changed users via a single batch saveUsers call", async () => {
    const users = new Map<string, TriviaUser>([
      ["U1", makeUser({ userId: "U1", displayName: "Old1" })],
      ["U2", makeUser({ userId: "U2", displayName: "Old2" })],
      ["U3", makeUser({ userId: "U3", displayName: "Same" })],
    ]);
    const saveUsers = vi.fn<(updates: readonly TriviaUser[]) => Promise<void>>(async () => {});

    await refreshUserDisplayNames({
      userIds: ["U1", "U2", "U3"],
      users,
      data: { saveUsers },
      fetchDisplayName: async (id) => {
        if (id === "U1") return "New1";
        if (id === "U2") return "New2";
        return "Same";
      },
      logger: silentLogger,
    });

    expect(users.get("U1")?.displayName).toBe("New1");
    expect(users.get("U2")?.displayName).toBe("New2");
    expect(users.get("U3")?.displayName).toBe("Same");
    expect(saveUsers).toHaveBeenCalledTimes(1);
    const batch = saveUsers.mock.calls[0][0];
    expect(batch).toHaveLength(2);
    expect([...batch].map((u) => u.userId).sort()).toEqual(["U1", "U2"]);
  });

  it("skips the batch save when no display name changed", async () => {
    const users = new Map<string, TriviaUser>([
      ["U1", makeUser({ userId: "U1", displayName: "Same" })],
    ]);
    const saveUsers = vi.fn(async () => {});

    await refreshUserDisplayNames({
      userIds: ["U1"],
      users,
      data: { saveUsers },
      fetchDisplayName: async () => "Same",
      logger: silentLogger,
    });

    expect(saveUsers).not.toHaveBeenCalled();
  });

  it("preserves stored data when the Slack lookup returns null", async () => {
    const users = new Map<string, TriviaUser>([
      ["U1", makeUser({ userId: "U1", displayName: "Old Name" })],
    ]);
    const saveUsers = vi.fn(async () => {});

    await refreshUserDisplayNames({
      userIds: ["U1"],
      users,
      data: { saveUsers },
      fetchDisplayName: async () => null,
      logger: silentLogger,
    });

    expect(saveUsers).not.toHaveBeenCalled();
    expect(users.get("U1")?.displayName).toBe("Old Name");
  });

  it("swallows a per-user fetch error and still processes remaining users", async () => {
    const users = new Map<string, TriviaUser>([
      ["U1", makeUser({ userId: "U1", displayName: "Old1" })],
      ["U2", makeUser({ userId: "U2", displayName: "Old2" })],
    ]);
    const saveUsers = vi.fn<(updates: readonly TriviaUser[]) => Promise<void>>(async () => {});
    const warn = vi.fn();

    await refreshUserDisplayNames({
      userIds: ["U1", "U2"],
      users,
      data: { saveUsers },
      fetchDisplayName: async (id) => {
        if (id === "U1") throw new Error("rate-limited");
        return "Fresh2";
      },
      logger: { debug: () => {}, warn },
    });

    expect(users.get("U1")?.displayName).toBe("Old1");
    expect(users.get("U2")?.displayName).toBe("Fresh2");
    expect(saveUsers).toHaveBeenCalledTimes(1);
    expect([...saveUsers.mock.calls[0][0]].map((u) => u.userId)).toEqual(["U2"]);
    expect(warn).toHaveBeenCalled();
  });

  it("swallows a saveUsers error and leaves in-memory mutations intact", async () => {
    const users = new Map<string, TriviaUser>([
      ["U1", makeUser({ userId: "U1", displayName: "Old1" })],
    ]);
    const warn = vi.fn();
    const saveUsers = vi.fn(async () => {
      throw new Error("disk full");
    });

    await refreshUserDisplayNames({
      userIds: ["U1"],
      users,
      data: { saveUsers },
      fetchDisplayName: async () => "New1",
      logger: { debug: () => {}, warn },
    });

    expect(users.get("U1")?.displayName).toBe("New1");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("failed to persist"));
  });

  it("skips IDs that are not in the users map", async () => {
    const users = new Map<string, TriviaUser>([["U1", makeUser({ userId: "U1" })]]);
    const saveUsers = vi.fn(async () => {});
    const fetchDisplayName = vi.fn(async () => "Anything");

    await refreshUserDisplayNames({
      userIds: ["U1", "U-unknown"],
      users,
      data: { saveUsers },
      fetchDisplayName,
      logger: silentLogger,
    });

    expect(fetchDisplayName).toHaveBeenCalledTimes(1);
    expect(fetchDisplayName).toHaveBeenCalledWith("U1");
  });

  it("de-duplicates repeated user IDs in the input", async () => {
    const users = new Map<string, TriviaUser>([["U1", makeUser({ userId: "U1" })]]);
    const fetchDisplayName = vi.fn(async () => "Fresh");

    await refreshUserDisplayNames({
      userIds: ["U1", "U1", "U1"],
      users,
      data: { saveUsers: async () => {} },
      fetchDisplayName,
      logger: silentLogger,
    });

    expect(fetchDisplayName).toHaveBeenCalledTimes(1);
  });
});
