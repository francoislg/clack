import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isValidTimezone } from "./timezone.js";

describe("isValidTimezone", () => {
  it("accepts IANA names", () => {
    assert.equal(isValidTimezone("America/New_York"), true);
    assert.equal(isValidTimezone("Europe/London"), true);
    assert.equal(isValidTimezone("UTC"), true);
  });

  it("rejects abbreviations and garbage", () => {
    assert.equal(isValidTimezone("EDT"), false);
    assert.equal(isValidTimezone("not-a-zone"), false);
    assert.equal(isValidTimezone(""), false);
  });
});
