import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  ROLE_ENUM,
  TOPIC_PATTERN,
  FILE_PATTERN,
  buildInstructionPath,
} from "./configFieldSchemas.js";

describe("configFieldSchemas", () => {
  describe("ROLE_ENUM", () => {
    it("accepts each valid role", () => {
      for (const role of ["user", "dev", "admin", "owner"]) {
        assert.equal(ROLE_ENUM.safeParse(role).success, true, `should accept ${role}`);
      }
    });

    it("rejects unknown role names", () => {
      assert.equal(ROLE_ENUM.safeParse("developer").success, false);
      assert.equal(ROLE_ENUM.safeParse("member").success, false);
      assert.equal(ROLE_ENUM.safeParse("").success, false);
      assert.equal(ROLE_ENUM.safeParse("USER").success, false);
    });
  });

  describe("TOPIC_PATTERN", () => {
    it("accepts safe topic names", () => {
      for (const topic of ["metabase", "monday", "foo-bar_1", "newIntegration", "Topic1"]) {
        assert.equal(TOPIC_PATTERN.safeParse(topic).success, true, `should accept ${topic}`);
      }
    });

    it("rejects path-traversal and slashes", () => {
      assert.equal(TOPIC_PATTERN.safeParse("..").success, false);
      assert.equal(TOPIC_PATTERN.safeParse("../etc").success, false);
      assert.equal(TOPIC_PATTERN.safeParse("foo/bar").success, false);
    });

    it("rejects leading punctuation and empty string", () => {
      assert.equal(TOPIC_PATTERN.safeParse("-leading-dash").success, false);
      assert.equal(TOPIC_PATTERN.safeParse("_leading-underscore").success, false);
      assert.equal(TOPIC_PATTERN.safeParse("").success, false);
    });
  });

  describe("FILE_PATTERN", () => {
    it("accepts bare filenames ending in .md", () => {
      for (const file of ["rules.md", "foo-bar.v2.md", "identity.md", "company_context.md"]) {
        assert.equal(FILE_PATTERN.safeParse(file).success, true, `should accept ${file}`);
      }
    });

    it("rejects missing .md extension", () => {
      assert.equal(FILE_PATTERN.safeParse("rules").success, false);
      assert.equal(FILE_PATTERN.safeParse("rules.txt").success, false);
    });

    it("rejects paths containing slashes", () => {
      assert.equal(FILE_PATTERN.safeParse("topics/x.md").success, false);
      assert.equal(FILE_PATTERN.safeParse("dev/rules.md").success, false);
    });

    it("rejects disallowed characters", () => {
      assert.equal(FILE_PATTERN.safeParse("my file.md").success, false);
      assert.equal(FILE_PATTERN.safeParse("file@v2.md").success, false);
      assert.equal(FILE_PATTERN.safeParse(".hidden.md").success, false);
    });
  });

  describe("buildInstructionPath", () => {
    it("composes a baseline path when topic is undefined", () => {
      assert.equal(buildInstructionPath("user", undefined, "identity.md"), "user/identity.md");
    });

    it("composes a topic-scoped path when topic is provided", () => {
      assert.equal(
        buildInstructionPath("dev", "metabase", "rules.md"),
        "dev/topics/metabase/rules.md",
      );
    });
  });
});
