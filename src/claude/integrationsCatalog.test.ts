import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildIntegrationsCatalog } from "./integrationsCatalog.js";
import type { McpServerRegistry } from "../config.js";

describe("buildIntegrationsCatalog", () => {
  it("lists non-always-on entries alphabetically with their descriptions", () => {
    const registry: McpServerRegistry = {
      monday: { alwaysLoad: false, description: "Monday boards and items" },
      metabase: { alwaysLoad: false, description: "Read-only SQL queries" },
      sentry: { alwaysLoad: false, description: "Errors and exceptions" },
    };

    const catalog = buildIntegrationsCatalog(registry);

    // Alphabetical order: metabase, monday, sentry
    const metabaseIdx = catalog.indexOf("- metabase");
    const mondayIdx = catalog.indexOf("- monday");
    const sentryIdx = catalog.indexOf("- sentry");
    assert.ok(metabaseIdx > -1 && mondayIdx > -1 && sentryIdx > -1);
    assert.ok(metabaseIdx < mondayIdx);
    assert.ok(mondayIdx < sentryIdx);

    // Descriptions rendered
    assert.ok(catalog.includes("Read-only SQL queries"));
    assert.ok(catalog.includes("Monday boards and items"));
    assert.ok(catalog.includes("Errors and exceptions"));
  });

  it("excludes alwaysLoad: true entries", () => {
    const registry: McpServerRegistry = {
      github: { alwaysLoad: true, description: "GitHub MCP" },
      metabase: { alwaysLoad: false, description: "metabase" },
    };

    const catalog = buildIntegrationsCatalog(registry);

    assert.ok(catalog.includes("metabase"));
    assert.ok(!catalog.includes("github"));
    assert.ok(!catalog.includes("GitHub MCP"));
  });

  it("excludes the internal clack entry even if mistakenly marked non-always-load", () => {
    const registry: McpServerRegistry = {
      clack: { alwaysLoad: false, description: "should not be listed" },
      metabase: { alwaysLoad: false, description: "metabase queries" },
    };

    const catalog = buildIntegrationsCatalog(registry);

    assert.ok(catalog.includes("metabase"));
    assert.ok(!catalog.includes("clack"));
    assert.ok(!catalog.includes("should not be listed"));
  });

  it("returns an empty string when no entries qualify", () => {
    const registry: McpServerRegistry = {
      github: { alwaysLoad: true, description: "GitHub MCP" },
    };

    assert.equal(buildIntegrationsCatalog(registry), "");
  });

  it("returns an empty string for an empty registry", () => {
    assert.equal(buildIntegrationsCatalog({}), "");
  });

  it("includes a call-to-action phrase so Claude treats the catalog as actionable", () => {
    const registry: McpServerRegistry = {
      metabase: { alwaysLoad: false, description: "SQL" },
    };

    const catalog = buildIntegrationsCatalog(registry);

    assert.match(catalog, /attach_integration\("name"\)/);
    // Directive framing — the catalog should push Claude toward attaching as a first step
    assert.match(catalog, /first step/);
  });
});
