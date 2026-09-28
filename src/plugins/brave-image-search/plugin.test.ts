import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createTestClackSdk } from "../../plugins-sdk/testHelpers.js";
import { braveImageSearchPlugin } from "./index.js";

describe("brave-image-search plugin load", () => {
  it("registers the find_image tool on the always-on default server", async () => {
    const { sdk, harvest } = createTestClackSdk(
      "brave-image-search",
      "/tmp/brave-image-search-plugin-test",
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
