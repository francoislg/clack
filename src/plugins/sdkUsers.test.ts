import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createUsersSurface, type UsersSurfaceDeps } from "./sdkUsers.js";

const schema = z.object({
  joinedAt: z.number().optional(),
  cheatAttempts: z.number().optional(),
});

function makeDeps(overrides: Partial<UsersSurfaceDeps> = {}): UsersSurfaceDeps {
  return {
    getSlackClient: () => null,
    resolveUserIdentity: async (_client, userId) => ({ userId, displayName: "Alice" }),
    listUserIdentities: async () => [{ userId: "U1", displayName: "Alice" }],
    getUserNamespace: async () => null,
    mergeUserNamespace: async () => {},
    ...overrides,
  };
}

describe("createUsersSurface — identity", () => {
  it("get delegates to resolveUserIdentity and returns the identity", async () => {
    const surface = createUsersSurface(makeDeps(), "trivia", () => {});
    expect(await surface.get("U9")).toEqual({ userId: "U9", displayName: "Alice" });
  });

  it("list delegates to listUserIdentities", async () => {
    const surface = createUsersSurface(makeDeps(), "trivia", () => {});
    expect(await surface.list()).toEqual([{ userId: "U1", displayName: "Alice" }]);
  });
});

describe("createUsersSurface — data(schema)", () => {
  it("parses a valid namespace value", async () => {
    const deps = makeDeps({ getUserNamespace: async () => ({ joinedAt: 5, cheatAttempts: 2 }) });
    const surface = createUsersSurface(deps, "trivia", () => {});
    expect(await surface.data(schema).get("U1")).toEqual({ joinedAt: 5, cheatAttempts: 2 });
  });

  it("returns null for an absent namespace", async () => {
    const surface = createUsersSurface(makeDeps(), "trivia", () => {});
    expect(await surface.data(schema).get("U1")).toBeNull();
  });

  it("returns null and warns on a schema mismatch", async () => {
    const warn = vi.fn();
    const deps = makeDeps({ getUserNamespace: async () => ({ joinedAt: "nope" }) });
    const surface = createUsersSurface(deps, "trivia", warn);
    expect(await surface.data(schema).get("U1")).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("merge is auto-scoped to the calling plugin name", async () => {
    const mergeUserNamespace = vi.fn(async () => {});
    const surface = createUsersSurface(makeDeps({ mergeUserNamespace }), "trivia", () => {});
    await surface.data(schema).merge("U1", { joinedAt: 7 });
    expect(mergeUserNamespace).toHaveBeenCalledWith("trivia", "U1", { joinedAt: 7 });
  });

  it("get reads only the calling plugin's namespace", async () => {
    const getUserNamespace = vi.fn(async () => null);
    const surface = createUsersSurface(makeDeps({ getUserNamespace }), "trivia", () => {});
    await surface.data(schema).get("U1");
    expect(getUserNamespace).toHaveBeenCalledWith("trivia", "U1");
  });
});
