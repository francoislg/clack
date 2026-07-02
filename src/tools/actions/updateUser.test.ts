import { describe, it, vi, type Mock } from "vitest";
import assert from "node:assert/strict";
import { createUpdateUserTool } from "./updateUser.js";
import { parseToolResult } from "../testHelpers.js";
import type { QueryToolContext } from "../types.js";
import type { UserRecord } from "../../userRegistry.js";

interface UpdateUserArgs {
  user_id: string;
  display_name?: string | null;
  github?: { username: string } | null;
  add_other_names?: string[];
  remove_other_names?: string[];
}

interface MockedUpdateUserDeps {
  getUserRecord: Mock;
  mergeUserGithub: Mock;
  mergeUserOtherNames: Mock;
  setUserDisplayName: Mock;
}

function makeCtx(opts?: { userId?: string; role?: QueryToolContext["role"] }): QueryToolContext {
  return {
    mode: "query",
    userId: opts?.userId ?? "U_ALICE",
    role: opts?.role ?? "member",
    session: { sessionId: "S", channelId: "C" } as QueryToolContext["session"],
    config: {} as QueryToolContext["config"],
    changesWorkflowEnabled: false,
    cronUserSchedules: false,
  };
}

function makeDeps(): MockedUpdateUserDeps {
  return {
    getUserRecord: vi.fn(
      async (userId: string): Promise<UserRecord | null> => ({
        userId,
        displayName: "Existing",
        lastFetched: 0,
        github: { username: "existing-gh" },
      }),
    ),
    mergeUserGithub: vi.fn(async () => undefined),
    mergeUserOtherNames: vi.fn(async () => undefined),
    setUserDisplayName: vi.fn(async () => undefined),
  };
}

async function call(ctx: QueryToolContext, deps: MockedUpdateUserDeps, args: UpdateUserArgs) {
  const tool = createUpdateUserTool(ctx, deps);
  const result = await tool.handler(
    {
      display_name: undefined,
      github: undefined,
      add_other_names: undefined,
      remove_other_names: undefined,
      ...args,
    },
    { signal: new AbortController().signal, requestId: "r" },
  );
  return result as { content: readonly { type: string }[]; isError?: boolean };
}

describe("update_user", () => {
  it("sets github (omitting display_name keeps it) for any user", async () => {
    const deps = makeDeps();
    const result = await call(makeCtx({ role: "member" }), deps, {
      user_id: "U_BOB",
      github: { username: "bob-gh" },
    });
    const json = parseToolResult(result);
    assert.equal(json.success, true);
    assert.equal(deps.mergeUserGithub.mock.calls[0][0], "U_BOB");
    assert.deepEqual(deps.mergeUserGithub.mock.calls[0][1], { username: "bob-gh" });
    assert.equal(deps.setUserDisplayName.mock.calls.length, 0);
    // Returns the resolved identity read back from the registry.
    assert.deepEqual(json.user, {
      user_id: "U_BOB",
      display_name: "Existing",
      github: { username: "existing-gh" },
      other_names: [],
    });
  });

  it("clears github with null", async () => {
    const deps = makeDeps();
    await call(makeCtx(), deps, { user_id: "U_BOB", github: null });
    assert.equal(deps.mergeUserGithub.mock.calls[0][1], null);
  });

  it("clears display_name by passing null (self)", async () => {
    const deps = makeDeps();
    const result = await call(makeCtx({ userId: "U_ALICE", role: "member" }), deps, {
      user_id: "U_ALICE",
      display_name: null,
    });
    assert.equal(result.isError, undefined);
    assert.equal(deps.setUserDisplayName.mock.calls[0][1], "");
  });

  it("lets a user set their own display_name", async () => {
    const deps = makeDeps();
    const result = await call(makeCtx({ userId: "U_ALICE", role: "member" }), deps, {
      user_id: "U_ALICE",
      display_name: "Alice New",
    });
    assert.equal(result.isError, undefined);
    assert.equal(deps.setUserDisplayName.mock.calls[0][1], "Alice New");
  });

  it("lets an admin set another user's display_name", async () => {
    const deps = makeDeps();
    const result = await call(makeCtx({ userId: "U_ADMIN", role: "admin" }), deps, {
      user_id: "U_BOB",
      display_name: "Bob New",
    });
    assert.equal(result.isError, undefined);
    assert.equal(deps.setUserDisplayName.mock.calls[0][1], "Bob New");
  });

  it("rejects a non-admin changing another user's display_name without applying anything", async () => {
    const deps = makeDeps();
    const result = await call(makeCtx({ userId: "U_ALICE", role: "member" }), deps, {
      user_id: "U_BOB",
      display_name: "Hacked",
    });
    assert.equal(result.isError, true);
    assert.match(parseToolResult(result).error, /display_name/);
    assert.equal(deps.setUserDisplayName.mock.calls.length, 0);
  });

  it("rejects a mixed call atomically when display_name is unauthorized (github not applied)", async () => {
    const deps = makeDeps();
    const result = await call(makeCtx({ userId: "U_ALICE", role: "member" }), deps, {
      user_id: "U_BOB",
      display_name: "Hacked",
      github: { username: "bob-gh" },
    });
    assert.equal(result.isError, true);
    assert.equal(deps.setUserDisplayName.mock.calls.length, 0);
    assert.equal(deps.mergeUserGithub.mock.calls.length, 0);
  });

  it("errors when no field is provided", async () => {
    const deps = makeDeps();
    const result = await call(makeCtx(), deps, { user_id: "U_BOB" });
    assert.equal(result.isError, true);
  });

  it("lets any user add/remove another user's other_names, delegating normalized intent", async () => {
    const deps = makeDeps();
    const result = await call(makeCtx({ userId: "U_ALICE", role: "member" }), deps, {
      user_id: "U_BOB",
      add_other_names: ["Bobby"],
      remove_other_names: ["Rob"],
    });
    assert.equal(result.isError, undefined);
    assert.equal(deps.mergeUserOtherNames.mock.calls[0][0], "U_BOB");
    // The tool forwards the raw ops; normalization/dedup is the mutator's own concern.
    assert.deepEqual(deps.mergeUserOtherNames.mock.calls[0][1], {
      add: ["Bobby"],
      remove: ["Rob"],
    });
    assert.equal(deps.setUserDisplayName.mock.calls.length, 0);
    assert.equal(deps.mergeUserGithub.mock.calls.length, 0);
  });

  it("surfaces the resulting other_names in the success payload", async () => {
    const deps = makeDeps();
    deps.getUserRecord.mockImplementation(async (userId: string) => ({
      userId,
      displayName: "Existing",
      lastFetched: 0,
      otherNames: ["Bobby"],
    }));
    const result = await call(makeCtx(), deps, { user_id: "U_BOB", add_other_names: ["Bobby"] });
    const json = parseToolResult(result);
    assert.deepEqual(json.user.other_names, ["Bobby"]);
  });

  it("rejects a mixed call atomically when display_name is unauthorized (other_names not applied)", async () => {
    const deps = makeDeps();
    const result = await call(makeCtx({ userId: "U_ALICE", role: "member" }), deps, {
      user_id: "U_BOB",
      display_name: "Hacked",
      add_other_names: ["Bobby"],
    });
    assert.equal(result.isError, true);
    assert.equal(deps.setUserDisplayName.mock.calls.length, 0);
    assert.equal(deps.mergeUserOtherNames.mock.calls.length, 0);
  });
});
