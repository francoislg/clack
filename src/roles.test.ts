import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import {
  loadRoles,
  saveRoles,
  isOwner,
  isAdmin,
  isDev,
  getRole,
  hasOwner,
  setOwner,
  setRole,
  claimOwnershipFromDisabled,
  transferOwnership,
  clearRolesCache,
  setRolesDeps,
  type RolesConfig,
  type RolesDeps,
} from "./roles.js";
import type { App } from "@slack/bolt";

// ---------------------------------------------------------------------------
// Mock deps
// ---------------------------------------------------------------------------

const mockReadFile = mock.fn<(path: string, encoding: string) => Promise<string>>();
const mockWriteFile = mock.fn<(path: string, data: string) => Promise<void>>();
const mockMkdir =
  mock.fn<(path: string, opts: { recursive: boolean }) => Promise<string | undefined>>();
const mockFileExists = mock.fn<(path: string) => Promise<boolean>>();

function makeDeps(): RolesDeps {
  return {
    readFile: mockReadFile as never,
    writeFile: mockWriteFile as never,
    mkdir: mockMkdir as never,
    fileExists: mockFileExists as never,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks(): void {
  clearRolesCache();
  mockReadFile.mock.resetCalls();
  mockWriteFile.mock.resetCalls();
  mockMkdir.mock.resetCalls();
  mockFileExists.mock.resetCalls();

  // Default: file does not exist, dir exists
  mockFileExists.mock.mockImplementation(async () => false);
  mockWriteFile.mock.mockImplementation(async () => {});
  mockMkdir.mock.mockImplementation(async () => undefined);

  setRolesDeps(makeDeps());
}

/** Configure mocks so loadRoles returns the given roles. */
function seedRoles(roles: RolesConfig): void {
  mockFileExists.mock.mockImplementation(async () => true);
  mockReadFile.mock.mockImplementation(async () => JSON.stringify(roles));
}

/** Extract the roles object written by the last saveRoles call. */
function lastSavedRoles(): RolesConfig {
  const calls = mockWriteFile.mock.calls;
  assert.ok(calls.length > 0, "Expected writeFile to have been called");
  const lastCall = calls[calls.length - 1];
  return JSON.parse(lastCall.arguments[1] as string) as RolesConfig;
}

function makeSlackClient(users: Record<string, { deleted?: boolean }> = {}): App["client"] {
  return {
    users: {
      info: async ({ user }: { user: string }) => {
        const u = users[user];
        if (!u) throw new Error("user_not_found");
        return { user: { deleted: u.deleted ?? false } };
      },
    },
  } as unknown as App["client"];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("loadRoles", () => {
  beforeEach(resetMocks);

  it("returns default roles when file does not exist", async () => {
    mockFileExists.mock.mockImplementation(async () => false);

    const roles = await loadRoles();
    assert.equal(roles.owner, null);
    assert.deepEqual(roles.admins, []);
    assert.deepEqual(roles.devs, []);
  });

  it("reads and parses roles from disk", async () => {
    const stored: RolesConfig = {
      owner: "U_OWNER",
      admins: ["U_ADMIN1"],
      devs: ["U_DEV1", "U_DEV2"],
    };
    seedRoles(stored);

    const roles = await loadRoles();
    assert.equal(roles.owner, "U_OWNER");
    assert.deepEqual(roles.admins, ["U_ADMIN1"]);
    assert.deepEqual(roles.devs, ["U_DEV1", "U_DEV2"]);
  });

  it("fills in missing fields with defaults", async () => {
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () => JSON.stringify({ owner: "U1" }));

    const roles = await loadRoles();
    assert.equal(roles.owner, "U1");
    assert.deepEqual(roles.admins, []);
    assert.deepEqual(roles.devs, []);
  });

  it("returns cached roles on subsequent calls without re-reading file", async () => {
    seedRoles({ owner: "U1", admins: [], devs: [] });

    await loadRoles();
    await loadRoles();

    assert.equal(mockReadFile.mock.callCount(), 1);
  });

  it("returns defaults when file contains invalid JSON", async () => {
    mockFileExists.mock.mockImplementation(async () => true);
    mockReadFile.mock.mockImplementation(async () => "not-json");

    const roles = await loadRoles();
    assert.equal(roles.owner, null);
    assert.deepEqual(roles.admins, []);
    assert.deepEqual(roles.devs, []);
  });
});

describe("saveRoles", () => {
  beforeEach(resetMocks);

  it("writes roles as JSON to disk", async () => {
    const roles: RolesConfig = { owner: "U1", admins: ["U2"], devs: ["U3"] };
    await saveRoles(roles);

    assert.equal(mockWriteFile.mock.callCount(), 1);
    const written = lastSavedRoles();
    assert.deepEqual(written, roles);
  });

  it("creates state directory if it does not exist", async () => {
    mockFileExists.mock.mockImplementation(async () => false);

    await saveRoles({ owner: null, admins: [], devs: [] });
    assert.equal(mockMkdir.mock.callCount(), 1);
  });

  it("skips mkdir when state directory already exists", async () => {
    mockFileExists.mock.mockImplementation(async () => true);

    await saveRoles({ owner: null, admins: [], devs: [] });
    assert.equal(mockMkdir.mock.callCount(), 0);
  });

  it("updates the in-memory cache", async () => {
    // Start with default (no file)
    const initial = await loadRoles();
    assert.equal(initial.owner, null);

    // Save new roles
    await saveRoles({ owner: "U_NEW", admins: [], devs: [] });

    // loadRoles should return cached version without reading file
    const afterSave = await loadRoles();
    assert.equal(afterSave.owner, "U_NEW");
    // readFile should not have been called (file didn't exist initially, then cache was set by save)
    assert.equal(mockReadFile.mock.callCount(), 0);
  });
});

// ---------------------------------------------------------------------------
// Role checks: isOwner, isAdmin, isDev
// ---------------------------------------------------------------------------

describe("isOwner", () => {
  beforeEach(resetMocks);

  it("returns true for the owner", async () => {
    seedRoles({ owner: "U1", admins: [], devs: [] });
    assert.equal(await isOwner("U1"), true);
  });

  it("returns false for non-owner", async () => {
    seedRoles({ owner: "U1", admins: ["U2"], devs: ["U3"] });
    assert.equal(await isOwner("U2"), false);
    assert.equal(await isOwner("U3"), false);
    assert.equal(await isOwner("U999"), false);
  });

  it("returns false when there is no owner", async () => {
    seedRoles({ owner: null, admins: [], devs: [] });
    assert.equal(await isOwner("U1"), false);
  });
});

describe("isAdmin", () => {
  beforeEach(resetMocks);

  it("returns true for explicit admins", async () => {
    seedRoles({ owner: "U1", admins: ["U2", "U3"], devs: [] });
    assert.equal(await isAdmin("U2"), true);
    assert.equal(await isAdmin("U3"), true);
  });

  it("returns true for the owner (implicit admin)", async () => {
    seedRoles({ owner: "U1", admins: [], devs: [] });
    assert.equal(await isAdmin("U1"), true);
  });

  it("returns false for devs and members", async () => {
    seedRoles({ owner: "U1", admins: ["U2"], devs: ["U3"] });
    assert.equal(await isAdmin("U3"), false);
    assert.equal(await isAdmin("U999"), false);
  });
});

describe("isDev", () => {
  beforeEach(resetMocks);

  it("returns true for explicit devs", async () => {
    seedRoles({ owner: "U1", admins: [], devs: ["U2"] });
    assert.equal(await isDev("U2"), true);
  });

  it("returns true for the owner (implicit dev)", async () => {
    seedRoles({ owner: "U1", admins: [], devs: [] });
    assert.equal(await isDev("U1"), true);
  });

  it("returns true for admins (implicit dev)", async () => {
    seedRoles({ owner: "U1", admins: ["U2"], devs: [] });
    assert.equal(await isDev("U2"), true);
  });

  it("returns false for members", async () => {
    seedRoles({ owner: "U1", admins: [], devs: ["U2"] });
    assert.equal(await isDev("U999"), false);
  });
});

// ---------------------------------------------------------------------------
// getRole
// ---------------------------------------------------------------------------

describe("getRole", () => {
  beforeEach(resetMocks);

  it("returns 'owner' for the owner", async () => {
    seedRoles({ owner: "U1", admins: [], devs: [] });
    assert.equal(await getRole("U1"), "owner");
  });

  it("returns 'admin' for an admin", async () => {
    seedRoles({ owner: "U1", admins: ["U2"], devs: [] });
    assert.equal(await getRole("U2"), "admin");
  });

  it("returns 'dev' for a dev", async () => {
    seedRoles({ owner: "U1", admins: [], devs: ["U3"] });
    assert.equal(await getRole("U3"), "dev");
  });

  it("returns 'member' for an unknown user", async () => {
    seedRoles({ owner: "U1", admins: ["U2"], devs: ["U3"] });
    assert.equal(await getRole("U999"), "member");
  });

  it("returns the highest role when user appears in multiple lists", async () => {
    // Owner takes precedence even if user is also listed as admin
    seedRoles({ owner: "U1", admins: ["U1"], devs: ["U1"] });
    assert.equal(await getRole("U1"), "owner");
  });

  it("admin takes precedence over dev", async () => {
    seedRoles({ owner: "U_OTHER", admins: ["U1"], devs: ["U1"] });
    assert.equal(await getRole("U1"), "admin");
  });

  // Even if `roles.json` somehow contains the literal string "system" in any
  // field, `getRole()` resolves users by exact userId match — it never returns
  // the "system" tier.
  it('never returns "system", even when roles.json contains that string', async () => {
    seedRoles({ owner: "system", admins: ["system"], devs: ["system"] });
    // The userId "system" maps to owner because owner takes precedence.
    assert.equal(await getRole("system"), "owner");
    // Any other userId falls through to "member".
    assert.equal(await getRole("U_OTHER"), "member");
  });
});

// ---------------------------------------------------------------------------
// hasOwner
// ---------------------------------------------------------------------------

describe("hasOwner", () => {
  beforeEach(resetMocks);

  it("returns true when an owner is set", async () => {
    seedRoles({ owner: "U1", admins: [], devs: [] });
    assert.equal(await hasOwner(), true);
  });

  it("returns false when no owner is set", async () => {
    seedRoles({ owner: null, admins: [], devs: [] });
    assert.equal(await hasOwner(), false);
  });
});

// ---------------------------------------------------------------------------
// setOwner
// ---------------------------------------------------------------------------

describe("setOwner", () => {
  beforeEach(resetMocks);

  it("sets a new owner when there is none", async () => {
    seedRoles({ owner: null, admins: [], devs: [] });

    await setOwner("U_NEW");
    const saved = lastSavedRoles();
    assert.equal(saved.owner, "U_NEW");
  });

  it("demotes the previous owner to admin", async () => {
    seedRoles({ owner: "U_OLD", admins: [], devs: [] });

    await setOwner("U_NEW");
    const saved = lastSavedRoles();
    assert.equal(saved.owner, "U_NEW");
    assert.ok(saved.admins.includes("U_OLD"));
  });

  it("does not duplicate previous owner in admins if already listed", async () => {
    seedRoles({ owner: "U_OLD", admins: ["U_OLD"], devs: [] });

    await setOwner("U_NEW");
    const saved = lastSavedRoles();
    // U_OLD should appear exactly once in admins
    assert.equal(saved.admins.filter((id) => id === "U_OLD").length, 1);
  });

  it("removes new owner from admins list", async () => {
    seedRoles({ owner: "U_OLD", admins: ["U_NEW", "U_OTHER"], devs: [] });

    await setOwner("U_NEW");
    const saved = lastSavedRoles();
    assert.ok(!saved.admins.includes("U_NEW"));
    assert.ok(saved.admins.includes("U_OTHER"));
  });

  it("removes new owner from devs list", async () => {
    seedRoles({ owner: null, admins: [], devs: ["U_NEW", "U_OTHER"] });

    await setOwner("U_NEW");
    const saved = lastSavedRoles();
    assert.ok(!saved.devs.includes("U_NEW"));
    assert.ok(saved.devs.includes("U_OTHER"));
  });

  it("does not demote when re-setting the same owner", async () => {
    seedRoles({ owner: "U1", admins: [], devs: [] });

    await setOwner("U1");
    const saved = lastSavedRoles();
    assert.equal(saved.owner, "U1");
    assert.deepEqual(saved.admins, []);
  });
});

// ---------------------------------------------------------------------------
// setRole
// ---------------------------------------------------------------------------

describe("setRole", () => {
  beforeEach(resetMocks);

  it("sets a member to admin", async () => {
    seedRoles({ owner: "U_OWNER", admins: [], devs: [] });
    const result = await setRole("U2", "admin");
    assert.equal(result.success, true);
    assert.ok(lastSavedRoles().admins.includes("U2"));
  });

  it("sets a member to dev", async () => {
    seedRoles({ owner: "U_OWNER", admins: [], devs: [] });
    const result = await setRole("U2", "dev");
    assert.equal(result.success, true);
    assert.ok(lastSavedRoles().devs.includes("U2"));
  });

  it("promotes dev to admin and removes from devs", async () => {
    seedRoles({ owner: "U_OWNER", admins: [], devs: ["U2", "U3"] });
    const result = await setRole("U2", "admin");
    assert.equal(result.success, true);
    const saved = lastSavedRoles();
    assert.ok(saved.admins.includes("U2"));
    assert.ok(!saved.devs.includes("U2"));
    assert.ok(saved.devs.includes("U3"));
  });

  it("demotes admin to dev and removes from admins", async () => {
    seedRoles({ owner: "U_OWNER", admins: ["U2"], devs: [] });
    const result = await setRole("U2", "dev");
    assert.equal(result.success, true);
    const saved = lastSavedRoles();
    assert.ok(!saved.admins.includes("U2"));
    assert.ok(saved.devs.includes("U2"));
  });

  it("demotes admin to member", async () => {
    seedRoles({ owner: "U_OWNER", admins: ["U2"], devs: [] });
    const result = await setRole("U2", "member");
    assert.equal(result.success, true);
    const saved = lastSavedRoles();
    assert.ok(!saved.admins.includes("U2"));
    assert.ok(!saved.devs.includes("U2"));
  });

  it("demotes dev to member", async () => {
    seedRoles({ owner: "U_OWNER", admins: [], devs: ["U2"] });
    const result = await setRole("U2", "member");
    assert.equal(result.success, true);
    const saved = lastSavedRoles();
    assert.ok(!saved.devs.includes("U2"));
  });

  it("is idempotent — setting admin when already admin", async () => {
    seedRoles({ owner: "U_OWNER", admins: ["U2"], devs: [] });
    const result = await setRole("U2", "admin");
    assert.equal(result.success, true);
    assert.equal(mockWriteFile.mock.callCount(), 0);
  });

  it("is idempotent — setting member when already member", async () => {
    seedRoles({ owner: "U_OWNER", admins: [], devs: [] });
    const result = await setRole("U2", "member");
    assert.equal(result.success, true);
    assert.equal(mockWriteFile.mock.callCount(), 0);
  });

  it("rejects changing the owner's role", async () => {
    seedRoles({ owner: "U1", admins: [], devs: [] });
    const result = await setRole("U1", "dev");
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("owner"));
  });

  it("rejects assigning system at runtime even if a caller casts past AssignableRole", async () => {
    seedRoles({ owner: "U_OWNER", admins: [], devs: [] });
    const result = await setRole("U2", "system" as "admin");
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("not assignable"));
    assert.equal(mockWriteFile.mock.callCount(), 0);
  });

  it("rejects assigning owner at runtime even if a caller casts past AssignableRole", async () => {
    seedRoles({ owner: "U_OWNER", admins: [], devs: [] });
    const result = await setRole("U2", "owner" as "admin");
    assert.equal(result.success, false);
    assert.ok(result.error?.includes("not assignable"));
    assert.equal(mockWriteFile.mock.callCount(), 0);
  });
});

// ---------------------------------------------------------------------------
// claimOwnershipFromDisabled
// ---------------------------------------------------------------------------

describe("claimOwnershipFromDisabled", () => {
  beforeEach(resetMocks);

  it("claims ownership when there is no current owner", async () => {
    seedRoles({ owner: null, admins: [], devs: [] });
    const client = makeSlackClient({});

    const result = await claimOwnershipFromDisabled(client, "U_CLAIMER");
    assert.equal(result.success, true);
    const saved = lastSavedRoles();
    assert.equal(saved.owner, "U_CLAIMER");
  });

  it("allows an admin to claim from a disabled owner", async () => {
    seedRoles({ owner: "U_OLD", admins: ["U_ADMIN"], devs: [] });
    const client = makeSlackClient({
      U_OLD: { deleted: true },
    });

    const result = await claimOwnershipFromDisabled(client, "U_ADMIN");
    assert.equal(result.success, true);
    const saved = lastSavedRoles();
    assert.equal(saved.owner, "U_ADMIN");
    // Old owner should be fully removed (not demoted, since they're disabled)
    assert.ok(!saved.admins.includes("U_OLD"));
  });

  it("fails when current owner is still active", async () => {
    seedRoles({ owner: "U_ACTIVE", admins: ["U_ADMIN"], devs: [] });
    const client = makeSlackClient({
      U_ACTIVE: { deleted: false },
    });

    const result = await claimOwnershipFromDisabled(client, "U_ADMIN");
    assert.equal(result.success, false);
    assert.equal(result.error, "Current owner is still active");
  });

  it("fails when claimer is not an admin", async () => {
    seedRoles({ owner: "U_OLD", admins: [], devs: ["U_DEV"] });
    const client = makeSlackClient({
      U_OLD: { deleted: true },
    });

    const result = await claimOwnershipFromDisabled(client, "U_DEV");
    assert.equal(result.success, false);
    assert.equal(result.error, "Only admins can claim ownership from disabled owner");
  });

  it("removes claiming admin from admins and devs lists", async () => {
    seedRoles({ owner: "U_OLD", admins: ["U_ADMIN", "U_OTHER_ADMIN"], devs: ["U_ADMIN"] });
    const client = makeSlackClient({
      U_OLD: { deleted: true },
    });

    const result = await claimOwnershipFromDisabled(client, "U_ADMIN");
    assert.equal(result.success, true);
    const saved = lastSavedRoles();
    assert.ok(!saved.admins.includes("U_ADMIN"));
    assert.ok(!saved.devs.includes("U_ADMIN"));
    assert.ok(saved.admins.includes("U_OTHER_ADMIN"));
  });

  it("removes disabled old owner from admins and devs", async () => {
    seedRoles({ owner: "U_OLD", admins: ["U_ADMIN", "U_OLD"], devs: ["U_OLD"] });
    const client = makeSlackClient({
      U_OLD: { deleted: true },
    });

    const result = await claimOwnershipFromDisabled(client, "U_ADMIN");
    assert.equal(result.success, true);
    const saved = lastSavedRoles();
    assert.ok(!saved.admins.includes("U_OLD"));
    assert.ok(!saved.devs.includes("U_OLD"));
  });
});

// ---------------------------------------------------------------------------
// transferOwnership
// ---------------------------------------------------------------------------

describe("transferOwnership", () => {
  beforeEach(resetMocks);

  it("transfers ownership to an active user", async () => {
    seedRoles({ owner: "U_CURRENT", admins: ["U_TARGET"], devs: [] });
    const client = makeSlackClient({
      U_TARGET: { deleted: false },
    });

    const result = await transferOwnership(client, "U_CURRENT", "U_TARGET");
    assert.equal(result.success, true);
    const saved = lastSavedRoles();
    assert.equal(saved.owner, "U_TARGET");
    // Previous owner should be demoted to admin
    assert.ok(saved.admins.includes("U_CURRENT"));
  });

  it("fails when requester is not the current owner", async () => {
    seedRoles({ owner: "U_REAL_OWNER", admins: ["U_IMPOSTER"], devs: [] });
    const client = makeSlackClient({
      U_TARGET: { deleted: false },
    });

    const result = await transferOwnership(client, "U_IMPOSTER", "U_TARGET");
    assert.equal(result.success, false);
    assert.equal(result.error, "Only the owner can transfer ownership");
  });

  it("fails when target user is disabled", async () => {
    seedRoles({ owner: "U_CURRENT", admins: [], devs: [] });
    const client = makeSlackClient({
      U_DISABLED: { deleted: true },
    });

    const result = await transferOwnership(client, "U_CURRENT", "U_DISABLED");
    assert.equal(result.success, false);
    assert.equal(result.error, "Cannot transfer ownership to a disabled user");
  });
});

// ---------------------------------------------------------------------------
// clearRolesCache
// ---------------------------------------------------------------------------

describe("clearRolesCache", () => {
  beforeEach(resetMocks);

  it("forces re-read from disk on next loadRoles call", async () => {
    seedRoles({ owner: "U1", admins: [], devs: [] });
    await loadRoles();
    assert.equal(mockReadFile.mock.callCount(), 1);

    clearRolesCache();
    await loadRoles();
    assert.equal(mockReadFile.mock.callCount(), 2);
  });
});
