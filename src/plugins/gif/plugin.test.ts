import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createClackSdk } from "../sdk.js";
import { gifPlugin } from "./index.js";

describe("gif plugin load", () => {
  it("registers one instruction and one tool with the expected names", async () => {
    const { sdk, harvest } = createClackSdk("gif", "/tmp/gif-plugin-test", {
      getSlackClient: () => null,
      loadRoles: async () => ({ owner: null, admins: [], devs: [] }),
      openDmChannel: async () => null,
    });

    await gifPlugin(sdk);
    const result = harvest();

    assert.equal(result.name, "gif");
    assert.equal(result.instructions.length, 1);
    assert.equal(result.instructions[0].role, "user");
    assert.equal(result.instructions[0].filename, "gif__usage.md");

    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, "find_gif");
    assert.equal(result.tools[0].minRole, "member");

    const mapping = result.toolMappings.get("find_gif");
    assert.equal(mapping, "Finding a GIF — {query}");
  });
});
