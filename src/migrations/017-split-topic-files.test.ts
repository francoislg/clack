import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { migration } from "./017-split-topic-files.js";

describe("migration 017: split topic files", () => {
  it("metadata is correct", () => {
    assert.equal(migration.version, 17);
    assert.equal(migration.priority, "enhancement");
    assert.equal(migration.static, undefined);
    assert.ok(migration.prompt);
    assert.ok(migration.prompt!.length > 0);
  });

  it("references data/mcp.json so Claude can classify by server name", () => {
    assert.ok(migration.files.includes("data/mcp.json"));
  });

  it("includes both baseline and topics destinations for every known integration", () => {
    const expected = [
      "data/configuration/user/topics/asana/asana-context.md",
      "data/configuration/user/topics/gcp-observability/gcp-logs.md",
      "data/configuration/user/topics/hubspot/applauz-hubspot.md",
      "data/configuration/user/topics/metabase/metabase.md",
      "data/configuration/user/topics/monday/monday-integration.md",
      "data/configuration/user/topics/scheduling/scheduled-messages.md",
      "data/configuration/user/topics/sentry/sentry.md",
    ];
    for (const path of expected) {
      assert.ok(migration.files.includes(path), `missing topic path: ${path}`);
    }
  });

  it("includes baseline source files alongside topic destinations", () => {
    const baseline = [
      "data/configuration/user/metabase.md",
      "data/configuration/user/sentry.md",
      "data/configuration/user/scheduled-messages.md",
    ];
    for (const path of baseline) {
      assert.ok(migration.files.includes(path), `missing baseline path: ${path}`);
    }
  });

  it("prompt instructs Claude on the two classification buckets", () => {
    const prompt = migration.prompt!;
    assert.ok(prompt.includes("Bucket A"));
    assert.ok(prompt.includes("Bucket B"));
    assert.ok(prompt.includes("attach_integration"));
    assert.ok(prompt.includes("topics"));
  });

  it("prompt has explicit re-run safety rule", () => {
    assert.ok(migration.prompt!.toLowerCase().includes("re-run safety"));
  });
});
