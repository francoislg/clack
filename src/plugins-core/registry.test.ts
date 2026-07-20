import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { synthesizeErrorResult } from "./registry.js";

describe("synthesizeErrorResult", () => {
  it("captures an Error's message", () => {
    const result = synthesizeErrorResult("p", new Error("boom"));
    assert.deepEqual(result.errors, ["boom"]);
  });

  it("stringifies non-Error throws", () => {
    const result = synthesizeErrorResult("p", "string-thrown");
    assert.deepEqual(result.errors, ["string-thrown"]);
  });

  it("stringifies null", () => {
    const result = synthesizeErrorResult("p", null);
    assert.deepEqual(result.errors, ["null"]);
  });

  it("returns an empty-registration plugin record", () => {
    const result = synthesizeErrorResult("trivia", new Error("crons disabled"));
    assert.equal(result.name, "trivia");
    assert.deepEqual(result.instructions, []);
    assert.deepEqual(result.tools, []);
    assert.deepEqual(result.mcpServers, []);
    assert.equal(result.toolMappings.size, 0);
    assert.deepEqual(result.actionHandlers, []);
    assert.deepEqual(result.viewHandlers, []);
    assert.deepEqual(result.watchers, []);
  });

  it("attaches a dedicated MCP server scaffold under the plugin name", () => {
    const result = synthesizeErrorResult("trivia", new Error("any"));
    assert.equal(result.mcpServer.name, "trivia");
  });
});
