import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { parseRepoUrl } from "./github.js";

describe("parseRepoUrl", () => {
  it("parses owner/repo shorthand", () => {
    const result = parseRepoUrl("myorg/myrepo");
    assert.deepEqual(result, { owner: "myorg", repo: "myrepo" });
  });

  it("parses HTTPS URL", () => {
    const result = parseRepoUrl("https://github.com/myorg/myrepo");
    assert.deepEqual(result, { owner: "myorg", repo: "myrepo" });
  });

  it("parses HTTPS URL with .git suffix", () => {
    const result = parseRepoUrl("https://github.com/myorg/myrepo.git");
    assert.deepEqual(result, { owner: "myorg", repo: "myrepo" });
  });

  it("throws for invalid URLs", () => {
    assert.throws(() => parseRepoUrl("not-a-url"), /Cannot parse repository URL/);
  });

  it("throws for empty string", () => {
    assert.throws(() => parseRepoUrl(""), /Cannot parse repository URL/);
  });
});
