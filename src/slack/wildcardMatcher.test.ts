import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildWildcardMatcher } from "./wildcardMatcher.js";

describe("buildWildcardMatcher", () => {
  describe("substring mode (no wildcard)", () => {
    it("matches case-insensitive substring", () => {
      const match = buildWildcardMatcher("dev");
      assert.equal(match("dev-team"), true);
      assert.equal(match("Dev-Team"), true);
      assert.equal(match("frontend-dev"), true);
      assert.equal(match("general"), false);
    });

    it("matches empty query against anything", () => {
      const match = buildWildcardMatcher("");
      assert.equal(match("anything"), true);
      assert.equal(match(""), true);
    });
  });

  describe("wildcard mode", () => {
    it("matches prefix wildcard", () => {
      const match = buildWildcardMatcher("dev-*");
      assert.equal(match("dev-team"), true);
      assert.equal(match("dev-updates"), true);
      assert.equal(match("frontend-dev"), false);
    });

    it("matches suffix wildcard", () => {
      const match = buildWildcardMatcher("*-dev");
      assert.equal(match("frontend-dev"), true);
      assert.equal(match("dev-team"), false);
    });

    it("matches middle wildcard", () => {
      const match = buildWildcardMatcher("dev-*-prod");
      assert.equal(match("dev-api-prod"), true);
      assert.equal(match("dev-prod"), false);
    });

    it("matches lone wildcard against anything", () => {
      const match = buildWildcardMatcher("*");
      assert.equal(match("anything"), true);
      assert.equal(match(""), true);
    });

    it("is case-insensitive in wildcard mode", () => {
      const match = buildWildcardMatcher("Dev-*");
      assert.equal(match("dev-team"), true);
      assert.equal(match("DEV-TEAM"), true);
    });

    it("escapes regex special characters", () => {
      const match = buildWildcardMatcher("foo.bar*");
      assert.equal(match("foo.bar-baz"), true);
      assert.equal(match("fooXbar-baz"), false);
    });

    it("escapes parentheses and brackets", () => {
      const match = buildWildcardMatcher("test(*)");
      assert.equal(match("test(1)"), true);
      assert.equal(match("test1)"), false);
    });
  });
});
