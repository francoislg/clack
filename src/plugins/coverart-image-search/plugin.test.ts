import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { createTestClackSdk } from "../../plugins-sdk/testHelpers.js";
import { coverartImageSearchPlugin } from "./index.js";

describe("coverart-image-search plugin load", () => {
  it("registers the find_album tool on the always-on default server with no configuration", async () => {
    const { sdk, harvest } = createTestClackSdk(
      "coverart-image-search",
      "/tmp/coverart-image-search-plugin-test",
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
