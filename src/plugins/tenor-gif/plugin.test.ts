import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createTestClackSdk } from "../../plugins-sdk/testHelpers.js";
import { tenorGifPlugin } from "./index.js";

describe("tenor-gif plugin load", () => {
  it("registers one instruction and one tool with the expected names", async () => {
    const { sdk, harvest } = createTestClackSdk("tenor-gif", "/tmp/tenor-gif-plugin-test");

    await tenorGifPlugin(sdk);
    const result = harvest();

    assert.equal(result.name, "tenor-gif");
    assert.equal(result.instructions.length, 1);
    assert.equal(result.instructions[0].role, "user");
    assert.equal(result.instructions[0].filename, "tenor-gif__usage.md");

    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, "find_gif");
    assert.equal(result.tools[0].minRole, "member");

    const mapping = result.toolMappings.get("find_gif");
    assert.equal(mapping, "Finding a GIF — {query}");
  });
});
