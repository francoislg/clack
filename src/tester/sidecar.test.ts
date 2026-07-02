import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import { checkSidecarReachable, buildPlaywrightMcpServerConfig } from "./sidecar.js";

describe("checkSidecarReachable", () => {
  it("returns true when the endpoint responds", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }));
    assert.equal(await checkSidecarReachable("http://sidecar/mcp", { fetch }), true);
  });

  it("counts any HTTP response as reachable (405 on HEAD is fine)", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 405 }));
    assert.equal(await checkSidecarReachable("http://sidecar/mcp", { fetch }), true);
  });

  it("returns false on network failure", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    assert.equal(await checkSidecarReachable("http://sidecar/mcp", { fetch }), false);
  });
});

describe("buildPlaywrightMcpServerConfig", () => {
  it("builds a remote HTTP MCP server entry", () => {
    assert.deepEqual(buildPlaywrightMcpServerConfig("http://clack-playwright:8931/mcp"), {
      type: "http",
      url: "http://clack-playwright:8931/mcp",
    });
  });
});
