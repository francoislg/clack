import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClackSdk } from "../sdk.js";
import { giphyPlugin } from "./index.js";

describe("giphy plugin load", () => {
  it("registers one instruction and one tool with the expected names", async () => {
    const { sdk, harvest } = createClackSdk("giphy", "/tmp/giphy-plugin-test", {
      getSlackClient: () => null,
      loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
      openDmChannel: async () => null,
    });

    await giphyPlugin(sdk);
    const result = harvest();

    assert.equal(result.name, "giphy");
    assert.equal(result.instructions.length, 1);
    assert.equal(result.instructions[0].role, "user");
    assert.equal(result.instructions[0].filename, "giphy__usage.md");

    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, "find_gif");
    assert.equal(result.tools[0].minRole, "member");

    const mapping = result.toolMappings.get("find_gif");
    assert.equal(mapping, "Finding a GIF — {query}");
  });
});
