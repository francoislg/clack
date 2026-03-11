import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mapPermissionsToToolsets } from "./mcp.js";

describe("mapPermissionsToToolsets", () => {
  it("always includes context toolset", () => {
    const result = mapPermissionsToToolsets({});
    assert.equal(result, "context");
  });

  it("maps pull_requests to pull_requests and issues toolsets", () => {
    const result = mapPermissionsToToolsets({ pull_requests: "write" });
    const toolsets = result.split(",");
    assert.ok(toolsets.includes("context"));
    assert.ok(toolsets.includes("pull_requests"));
    assert.ok(toolsets.includes("issues"));
  });

  it("maps contents to repos and git toolsets", () => {
    const result = mapPermissionsToToolsets({ contents: "read" });
    const toolsets = result.split(",");
    assert.ok(toolsets.includes("repos"));
    assert.ok(toolsets.includes("git"));
  });

  it("deduplicates toolsets when multiple permissions map to the same toolset", () => {
    // Both pull_requests and issues map to "issues"
    const result = mapPermissionsToToolsets({ pull_requests: "write", issues: "write" });
    const toolsets = result.split(",");
    const issuesCount = toolsets.filter((t) => t === "issues").length;
    assert.equal(issuesCount, 1);
  });

  it("combines multiple permission mappings", () => {
    const result = mapPermissionsToToolsets({
      pull_requests: "write",
      contents: "read",
      actions: "read",
    });
    const toolsets = result.split(",");
    assert.ok(toolsets.includes("pull_requests"));
    assert.ok(toolsets.includes("repos"));
    assert.ok(toolsets.includes("git"));
    assert.ok(toolsets.includes("actions"));
    assert.ok(toolsets.includes("context"));
  });

  it("ignores unknown permission keys", () => {
    const result = mapPermissionsToToolsets({ unknown_perm: "read" });
    assert.equal(result, "context");
  });
});
