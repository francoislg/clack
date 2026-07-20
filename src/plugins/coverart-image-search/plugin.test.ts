import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk } from "../../plugins-sdk/testHelpers.js";
import { coverartImageSearchPlugin } from "./index.js";

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

describe("coverart-image-search plugin load", () => {
  it("registers the find_album tool on the always-on default server with no configuration", async () => {
    const { sdk, harvest } = createClackSdk(
      "coverart-image-search",
      "/tmp/coverart-image-search-plugin-test",
      {
        getSlackClient: () => null,
        loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
        openDmChannel: async () => null,
        clackQuery: emptyClackQuery,
      },
    );

    await coverartImageSearchPlugin(sdk);
    const result = harvest();

    assert.equal(result.name, "coverart-image-search");
    assert.deepEqual(result.errors, []);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, "find_album");
    assert.equal(result.tools[0].minRole, "member");

    const mapping = result.toolMappings.get("find_album");
    assert.equal(mapping, "Searching album covers — {query}");
  });
});
