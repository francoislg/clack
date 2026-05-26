import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONFIG_SCHEMA } from "./configSchema.js";

describe("CONFIG_SCHEMA", () => {
  it("describes data/config.json as an object root", () => {
    assert.equal(CONFIG_SCHEMA.type, "object");
    assert.ok(CONFIG_SCHEMA.description.length > 0);
    assert.ok(CONFIG_SCHEMA.fields);
  });

  it("every top-level field carries a non-empty description and a recognized type", () => {
    const allowed = new Set(["string", "boolean", "number", "enum", "array", "object", "record"]);
    for (const [key, doc] of Object.entries(CONFIG_SCHEMA.fields)) {
      assert.ok(doc.description.length > 0, `field '${key}' missing description`);
      assert.ok(allowed.has(doc.type), `field '${key}' has invalid type '${doc.type}'`);
    }
  });

  it("enum fields declare their allowed values", () => {
    const lang = CONFIG_SCHEMA.fields.language;
    assert.equal(lang.type, "enum");
    assert.deepEqual(lang.enum, ["en", "fr"]);
  });

  it("array fields describe their items", () => {
    const repos = CONFIG_SCHEMA.fields.repositories;
    assert.equal(repos.type, "array");
    assert.ok("items" in repos && repos.items, "repositories.items missing");
  });

  it("record fields describe their entry shape", () => {
    const mcp = CONFIG_SCHEMA.fields.mcpServers;
    assert.equal(mcp.type, "record");
    assert.ok("entries" in mcp && mcp.entries, "mcpServers.entries missing");
  });
});
