import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  loadVerificationConfig,
  DEFAULT_RETRY_BUDGET,
  DEFAULT_TIMEOUT_SECONDS,
  type LoadVerificationConfigDeps,
} from "./config.js";

function makeDeps(opts: {
  fileExists?: boolean;
  fileContent?: string;
  readThrows?: boolean;
}): LoadVerificationConfigDeps {
  return {
    resolveInstructionFile: (_filename: string) => (opts.fileExists ? "/fake/path.json" : null),
    readTextFile: (_path: string) => {
      if (opts.readThrows) {
        throw new Error("read failed");
      }
      return opts.fileContent ?? "";
    },
  };
}

describe("loadVerificationConfig", () => {
  it("returns null when file does not exist in either tier", () => {
    const result = loadVerificationConfig("my-repo", makeDeps({ fileExists: false }));
    assert.equal(result, null);
  });

  it("returns null when readTextFile throws", () => {
    const result = loadVerificationConfig(
      "my-repo",
      makeDeps({ fileExists: true, readThrows: true }),
    );
    assert.equal(result, null);
  });

  it("returns null when file contains invalid JSON", () => {
    const result = loadVerificationConfig(
      "my-repo",
      makeDeps({ fileExists: true, fileContent: "{ not json }" }),
    );
    assert.equal(result, null);
  });

  it("parses a valid config with all fields", () => {
    const content = JSON.stringify({
      checks: [
        { name: "typecheck", command: "tsc --noEmit", timeoutSeconds: 120 },
        { name: "test", command: "npm test", timeoutSeconds: 600 },
      ],
      retryBudget: 5,
    });
    const result = loadVerificationConfig(
      "my-repo",
      makeDeps({ fileExists: true, fileContent: content }),
    );
    assert.ok(result);
    assert.equal(result.retryBudget, 5);
    assert.equal(result.checks.length, 2);
    assert.equal(result.checks[0]!.name, "typecheck");
    assert.equal(result.checks[0]!.timeoutSeconds, 120);
  });

  it("accepts an empty checks array", () => {
    const content = JSON.stringify({ checks: [] });
    const result = loadVerificationConfig(
      "my-repo",
      makeDeps({ fileExists: true, fileContent: content }),
    );
    assert.ok(result);
    assert.equal(result.checks.length, 0);
    assert.equal(result.retryBudget, DEFAULT_RETRY_BUDGET);
  });

  it("applies default retryBudget when omitted", () => {
    const content = JSON.stringify({
      checks: [{ name: "t", command: "echo" }],
    });
    const result = loadVerificationConfig(
      "my-repo",
      makeDeps({ fileExists: true, fileContent: content }),
    );
    assert.ok(result);
    assert.equal(result.retryBudget, DEFAULT_RETRY_BUDGET);
  });

  it("applies default timeoutSeconds when omitted from a check", () => {
    const content = JSON.stringify({
      checks: [{ name: "t", command: "echo" }],
    });
    const result = loadVerificationConfig(
      "my-repo",
      makeDeps({ fileExists: true, fileContent: content }),
    );
    assert.ok(result);
    assert.equal(result.checks[0]!.timeoutSeconds, DEFAULT_TIMEOUT_SECONDS);
  });

  it("returns null when checks is not an array", () => {
    const content = JSON.stringify({ checks: "not an array" });
    const result = loadVerificationConfig(
      "my-repo",
      makeDeps({ fileExists: true, fileContent: content }),
    );
    assert.equal(result, null);
  });

  it("returns null when a check is missing name", () => {
    const content = JSON.stringify({
      checks: [{ command: "echo" }],
    });
    const result = loadVerificationConfig(
      "my-repo",
      makeDeps({ fileExists: true, fileContent: content }),
    );
    assert.equal(result, null);
  });

  it("returns null when a check is missing command", () => {
    const content = JSON.stringify({
      checks: [{ name: "t" }],
    });
    const result = loadVerificationConfig(
      "my-repo",
      makeDeps({ fileExists: true, fileContent: content }),
    );
    assert.equal(result, null);
  });

  it("returns null when timeoutSeconds is not a positive number", () => {
    const content = JSON.stringify({
      checks: [{ name: "t", command: "echo", timeoutSeconds: 0 }],
    });
    const result = loadVerificationConfig(
      "my-repo",
      makeDeps({ fileExists: true, fileContent: content }),
    );
    assert.equal(result, null);
  });

  it("returns null when retryBudget is not a positive integer", () => {
    const content = JSON.stringify({
      checks: [{ name: "t", command: "echo" }],
      retryBudget: 0,
    });
    const result = loadVerificationConfig(
      "my-repo",
      makeDeps({ fileExists: true, fileContent: content }),
    );
    assert.equal(result, null);
  });
});
