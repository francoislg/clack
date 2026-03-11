import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canEditConfig, canRequestChanges, canManageRoles, canTransferOwnership } from "./permissions.js";

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
