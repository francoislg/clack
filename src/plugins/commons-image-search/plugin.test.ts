import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk } from "../../plugins-sdk/testHelpers.js";
import { commonsImageSearchPlugin } from "./index.js";

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

describe("commons-image-search plugin load", () => {
  it("registers the find_subject tool on the always-on default server", async () => {
    const { sdk, harvest } = createClackSdk(
      "commons-image-search",
      "/tmp/commons-image-search-plugin-test",
      {
        getSlackClient: () => null,
        loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
        openDmChannel: async () => null,
        clackQuery: emptyClackQuery,
      },
    );

    await commonsImageSearchPlugin(sdk);
    const result = harvest();

    assert.equal(result.name, "commons-image-search");
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, "find_subject");
    assert.equal(result.tools[0].minRole, "member");

    const mapping = result.toolMappings.get("find_subject");
    assert.equal(mapping, "Searching Wikimedia — {query}");
  });
});
