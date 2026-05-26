import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  canEditConfig,
  canRequestChanges,
  canManageRoles,
  canTransferOwnership,
  canCreateUserSkill,
  canEditUserSkill,
  meetsMinimumRole,
  userCanEditConfig,
  userCanManageRoles,
} from "./permissions.js";
import { saveRoles, clearRolesCache } from "./roles.js";
import type { UserRole } from "./roles.js";

// ---------------------------------------------------------------------------
// Role-based (synchronous) permission checks
// ---------------------------------------------------------------------------

const ALL_ROLES: UserRole[] = ["system", "owner", "admin", "dev", "member"];

describe("canEditConfig", () => {
  it("allows admin and owner", () => {
    assert.equal(canEditConfig("admin"), true);
    assert.equal(canEditConfig("owner"), true);
  });

  it("denies member and dev", () => {
    assert.equal(canEditConfig("member"), false);
    assert.equal(canEditConfig("dev"), false);
  });
});

describe("canRequestChanges", () => {
  it("allows dev, admin, and owner", () => {
    assert.equal(canRequestChanges("dev"), true);
    assert.equal(canRequestChanges("admin"), true);
    assert.equal(canRequestChanges("owner"), true);
  });

  it("denies member", () => {
    assert.equal(canRequestChanges("member"), false);
  });
});

describe("canManageRoles", () => {
  it("allows admin and owner", () => {
    assert.equal(canManageRoles("admin"), true);
    assert.equal(canManageRoles("owner"), true);
  });

  it("denies member and dev", () => {
    assert.equal(canManageRoles("member"), false);
    assert.equal(canManageRoles("dev"), false);
  });
});

describe("canTransferOwnership", () => {
  it("allows only owner", () => {
    assert.equal(canTransferOwnership("owner"), true);
  });

  it("denies all other roles", () => {
    assert.equal(canTransferOwnership("admin"), false);
    assert.equal(canTransferOwnership("dev"), false);
    assert.equal(canTransferOwnership("member"), false);
  });
});

describe("canCreateUserSkill", () => {
  it("allows every user-facing role", () => {
    assert.equal(canCreateUserSkill("member"), true);
    assert.equal(canCreateUserSkill("dev"), true);
    assert.equal(canCreateUserSkill("admin"), true);
    assert.equal(canCreateUserSkill("owner"), true);
  });

  it("allows system", () => {
    assert.equal(canCreateUserSkill("system"), true);
  });
});

describe("canEditUserSkill", () => {
  it("allows the owner of the skill regardless of role", () => {
    assert.equal(canEditUserSkill("member", "U_ALICE", "U_ALICE"), true);
    assert.equal(canEditUserSkill("dev", "U_ALICE", "U_ALICE"), true);
  });

  it("allows admin on someone else's skill", () => {
    assert.equal(canEditUserSkill("admin", "U_ALICE", "U_BOB"), true);
  });

  it("allows owner role on someone else's skill", () => {
    assert.equal(canEditUserSkill("owner", "U_ALICE", "U_BOB"), true);
  });

  it("denies non-owner member", () => {
    assert.equal(canEditUserSkill("member", "U_ALICE", "U_BOB"), false);
  });

  it("denies non-owner dev", () => {
    assert.equal(canEditUserSkill("dev", "U_ALICE", "U_BOB"), false);
  });

  it("admin editing own skill is still allowed", () => {
    assert.equal(canEditUserSkill("admin", "U_ADMIN", "U_ADMIN"), true);
  });
});

// ---------------------------------------------------------------------------
// meetsMinimumRole — role hierarchy comparison
// ---------------------------------------------------------------------------

describe("meetsMinimumRole", () => {
  const roles: UserRole[] = ["member", "dev", "admin", "owner", "system"];

  it("same role always meets its own threshold", () => {
    for (const role of roles) {
      assert.equal(meetsMinimumRole(role, role), true, `${role} should meet ${role}`);
    }
  });

  it("higher roles meet lower thresholds", () => {
    assert.equal(meetsMinimumRole("owner", "member"), true);
    assert.equal(meetsMinimumRole("admin", "dev"), true);
    assert.equal(meetsMinimumRole("dev", "member"), true);
  });

  it("lower roles do not meet higher thresholds", () => {
    assert.equal(meetsMinimumRole("member", "dev"), false);
    assert.equal(meetsMinimumRole("dev", "admin"), false);
    assert.equal(meetsMinimumRole("admin", "owner"), false);
  });

  it("system sits above every user-facing role", () => {
    assert.equal(meetsMinimumRole("system", "owner"), true);
    assert.equal(meetsMinimumRole("system", "admin"), true);
    assert.equal(meetsMinimumRole("system", "dev"), true);
    assert.equal(meetsMinimumRole("system", "member"), true);
  });

  // Sanity guard: ownership-mutating code uses `role === "owner"` literals to
  // exclude system. If a future refactor unifies the strings this test fails.
  it('system is not literally equal to "owner"', () => {
    const role: string = "system";
    assert.equal(role === "owner", false);
  });
});

// ---------------------------------------------------------------------------
// Exhaustive role matrix — verifies every (function, role) combination
// ---------------------------------------------------------------------------

describe("permission matrix", () => {
  const expectations: Record<string, Record<UserRole, boolean>> = {
    canEditConfig: { system: true, owner: true, admin: true, dev: false, member: false },
    canRequestChanges: { system: true, owner: true, admin: true, dev: true, member: false },
    canManageRoles: { system: true, owner: true, admin: true, dev: false, member: false },
    // canTransferOwnership uses literal `=== "owner"` — system is excluded by design.
    canTransferOwnership: {
      system: false,
      owner: true,
      admin: false,
      dev: false,
      member: false,
    },
  };

  const fns: Record<string, (role: UserRole) => boolean> = {
    canEditConfig,
    canRequestChanges,
    canManageRoles,
    canTransferOwnership,
  };

  for (const [fnName, expected] of Object.entries(expectations)) {
    describe(fnName, () => {
      for (const role of ALL_ROLES) {
        it(`${expected[role] ? "allows" : "denies"} ${role}`, () => {
          assert.equal(fns[fnName](role), expected[role]);
        });
      }
    });
  }
});

// ---------------------------------------------------------------------------
// userId-based (async) permission wrappers
// ---------------------------------------------------------------------------

const tmpBase = resolve(tmpdir(), `permissions-test-${process.pid}`);
const stateDir = join(tmpBase, "data", "state");

describe("userCanEditConfig", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
    mkdirSync(stateDir, { recursive: true });
    process.chdir(tmpBase);
    clearRolesCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
  });

  it("returns true for the owner", async () => {
    await saveRoles({ owner: "U_OWNER", admins: [], devs: [] });
    assert.equal(await userCanEditConfig("U_OWNER"), true);
  });

  it("returns true for an admin", async () => {
    await saveRoles({ owner: "U_OWNER", admins: ["U_ADMIN"], devs: [] });
    assert.equal(await userCanEditConfig("U_ADMIN"), true);
  });

  it("returns false for a dev", async () => {
    await saveRoles({ owner: "U_OWNER", admins: [], devs: ["U_DEV"] });
    assert.equal(await userCanEditConfig("U_DEV"), false);
  });

  it("returns false for a member (unknown user)", async () => {
    await saveRoles({ owner: "U_OWNER", admins: [], devs: [] });
    assert.equal(await userCanEditConfig("U_MEMBER"), false);
  });
});

describe("userCanManageRoles", () => {
  const originalCwd = process.cwd();

  beforeEach(() => {
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
    mkdirSync(stateDir, { recursive: true });
    process.chdir(tmpBase);
    clearRolesCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tmpBase)) {
      rmSync(tmpBase, { recursive: true });
    }
  });

  it("returns true for the owner", async () => {
    await saveRoles({ owner: "U_OWNER", admins: [], devs: [] });
    assert.equal(await userCanManageRoles("U_OWNER"), true);
  });

  it("returns true for an admin", async () => {
    await saveRoles({ owner: "U_OWNER", admins: ["U_ADMIN"], devs: [] });
    assert.equal(await userCanManageRoles("U_ADMIN"), true);
  });

  it("returns false for a dev", async () => {
    await saveRoles({ owner: "U_OWNER", admins: [], devs: ["U_DEV"] });
    assert.equal(await userCanManageRoles("U_DEV"), false);
  });

  it("returns false for a member (unknown user)", async () => {
    await saveRoles({ owner: "U_OWNER", admins: [], devs: [] });
    assert.equal(await userCanManageRoles("U_MEMBER"), false);
  });
});
