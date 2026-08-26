import { describe, it, vi } from "vitest";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk } from "../../plugins-sdk/testHelpers.js";
import { geolocationPlugin } from "./index.js";

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

function makeSdk() {
  return createClackSdk("geolocation", "/tmp/geolocation-plugin-test", {
    getSlackClient: () => null,
    loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
    openDmChannel: async () => null,
    clackQuery: emptyClackQuery,
  });
}

describe("geolocation plugin load", () => {
  it("registers one member-tier tool and a usage instruction, no cron or Slack surface", async () => {
    const { sdk, harvest } = makeSdk();

    // No .mmdb exists at the temp data dir → the plugin still loads (degraded reader).
    await geolocationPlugin(sdk);
    const result = harvest();

    assert.equal(result.name, "geolocation");

    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, "geolocate_ip");
    assert.equal(result.tools[0].minRole, "member");

    assert.equal(result.instructions.length, 1);
    assert.equal(result.instructions[0].role, "user");
    assert.equal(result.instructions[0].filename, "geolocation__usage.md");

    assert.equal(result.toolMappings.get("geolocate_ip"), "Geolocating IP — {ip}");

    assert.equal(result.mcpServers.length, 0);
    assert.equal(result.watchers?.length ?? 0, 0);
    assert.equal(result.actionHandlers.length, 0);
    assert.equal(result.viewHandlers.length, 0);
  });

  it("loads in degraded mode and reports an error when the database is corrupted", async () => {
    const { sdk, harvest } = makeSdk();
    // A present-but-unparseable .mmdb: readFileBuffer returns bytes, but the Reader rejects them.
    vi.spyOn(sdk, "readFileBuffer").mockResolvedValue(Buffer.from("NOT-AN-MMDB"));

    await geolocationPlugin(sdk);
    const result = harvest();

    // The corrupt file is surfaced to admins via the plugin error banner...
    assert.equal(result.errors?.length, 1);
    assert.match(result.errors?.[0] ?? "", /dbip-country-lite\.mmdb/);
    // ...but the plugin still registers its tool (which will report the DB is not installed).
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, "geolocate_ip");
  });
});
