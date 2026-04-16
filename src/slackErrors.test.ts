import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { slackErrorCode, isSlackAccessError } from "./slackErrors.js";

describe("slackErrorCode", () => {
  it("extracts the code from a Slack SDK error with data.error", () => {
    const err = Object.assign(new Error("An API error occurred: channel_not_found"), {
      data: { error: "channel_not_found" },
    });
    assert.equal(slackErrorCode(err), "channel_not_found");
  });

  it("returns undefined for a plain Error", () => {
    assert.equal(slackErrorCode(new Error("boom")), undefined);
  });

  it("returns undefined for null / undefined", () => {
    assert.equal(slackErrorCode(null), undefined);
    assert.equal(slackErrorCode(undefined), undefined);
  });

  it("returns undefined when data.error is missing or non-string", () => {
    const noData = new Error("boom");
    assert.equal(slackErrorCode(noData), undefined);

    const withData = Object.assign(new Error("boom"), { data: {} });
    assert.equal(slackErrorCode(withData), undefined);

    const withNonStringCode = Object.assign(new Error("boom"), { data: { error: 42 } });
    assert.equal(slackErrorCode(withNonStringCode), undefined);
  });
});

describe("isSlackAccessError", () => {
  it("matches the structured code on a Slack SDK error (preferred path)", () => {
    const err = Object.assign(new Error("An API error occurred"), {
      data: { error: "channel_not_found" },
    });
    assert.equal(isSlackAccessError(err), true);
  });

  it("matches channel_not_found in a plain message string (fallback)", () => {
    assert.equal(isSlackAccessError("An API error occurred: channel_not_found"), true);
  });

  it("matches not_in_channel in either form", () => {
    assert.equal(isSlackAccessError("not_in_channel"), true);
    const err = Object.assign(new Error(""), { data: { error: "not_in_channel" } });
    assert.equal(isSlackAccessError(err), true);
  });

  it("returns false for unrelated errors", () => {
    assert.equal(isSlackAccessError("something else"), false);
    assert.equal(isSlackAccessError(new Error("ratelimited")), false);
  });

  it("returns false for null, undefined, or non-string", () => {
    assert.equal(isSlackAccessError(null), false);
    assert.equal(isSlackAccessError(undefined), false);
  });

  it("uses the error message when data.error is missing but message contains the code", () => {
    const err = new Error("Upstream said channel_not_found");
    assert.equal(isSlackAccessError(err), true);
  });
});
