import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { unfurlOptions } from "./unfurlOptions.js";

describe("unfurlOptions", () => {
  it("returns an empty object when suppressUnfurls is undefined", () => {
    const result = unfurlOptions(undefined);
    assert.deepEqual(result, {});
    assert.equal("unfurl_links" in result, false);
    assert.equal("unfurl_media" in result, false);
  });

  it("returns an empty object when suppressUnfurls is false", () => {
    const result = unfurlOptions(false);
    assert.deepEqual(result, {});
  });

  it("returns both unfurl flags set to false when suppressUnfurls is true", () => {
    const result = unfurlOptions(true);
    assert.deepEqual(result, { unfurl_links: false, unfurl_media: false });
  });
});
