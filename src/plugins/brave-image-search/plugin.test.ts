import { describe, it } from "vitest";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { createClackSdk } from "../sdk.js";
import { braveImageSearchPlugin } from "./index.js";

async function* emptyClackQuery(): AsyncGenerator<SDKMessage, void, void> {}

describe("brave-image-search plugin load", () => {
  it("registers the find_image tool on the always-on default server", async () => {
    const { sdk, harvest } = createClackSdk(
      "brave-image-search",
      "/tmp/brave-image-search-plugin-test",
      {
        getSlackClient: () => null,
        loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
        openDmChannel: async () => null,
        clackQuery: emptyClackQuery,
      },
    );

    await braveImageSearchPlugin(sdk);
    const result = harvest();

    assert.equal(result.name, "brave-image-search");
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, "find_image");
    assert.equal(result.tools[0].minRole, "member");

    const mapping = result.toolMappings.get("find_image");
    assert.equal(mapping, "Searching Brave Images — {query}");
  });
});
