import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateSlug, validateDescription } from "./userSkills.js";

describe("validateSlug", () => {
  it("accepts simple lowercase names", () => {
    assert.equal(validateSlug("foo").ok, true);
    assert.equal(validateSlug("copy-improver").ok, true);
    assert.equal(validateSlug("a").ok, true);
    assert.equal(validateSlug("a1").ok, true);
  });

  it("rejects empty string", () => {
    assert.equal(validateSlug("").ok, false);
  });

  it("rejects uppercase", () => {
    assert.equal(validateSlug("CopyImprover").ok, false);
  });

  it("rejects leading hyphen", () => {
    assert.equal(validateSlug("-foo").ok, false);
  });

  it("rejects trailing hyphen", () => {
    assert.equal(validateSlug("foo-").ok, false);
  });

  it("rejects consecutive hyphens", () => {
    const res = validateSlug("foo--bar");
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.reason, /consecutive/);
  });

  it("rejects spaces", () => {
    assert.equal(validateSlug("foo bar").ok, false);
  });

  it("rejects underscores", () => {
    assert.equal(validateSlug("foo_bar").ok, false);
  });

  it("accepts exactly 64 chars", () => {
    assert.equal(validateSlug("a".repeat(64)).ok, true);
  });

  it("rejects 65 chars", () => {
    assert.equal(validateSlug("a".repeat(65)).ok, false);
  });
});

describe("validateDescription", () => {
  it("accepts a normal description", () => {
    assert.equal(validateDescription("When the user wants X").ok, true);
  });

  it("rejects empty string", () => {
    assert.equal(validateDescription("").ok, false);
  });

  it("rejects whitespace-only", () => {
    assert.equal(validateDescription("   ").ok, false);
  });

  it("accepts 1024 chars", () => {
    assert.equal(validateDescription("a".repeat(1024)).ok, true);
  });

  it("rejects 1025 chars", () => {
    assert.equal(validateDescription("a".repeat(1025)).ok, false);
  });
});
