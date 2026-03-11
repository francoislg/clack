import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { errorMessage } from "./errors.js";

describe("errorMessage", () => {
  it("returns message from Error objects", () => {
    assert.equal(errorMessage(new Error("something broke")), "something broke");
  });

  it("returns message from Error subclasses", () => {
    assert.equal(errorMessage(new TypeError("bad type")), "bad type");
  });

  it("returns the string directly for string errors", () => {
    assert.equal(errorMessage("raw string error"), "raw string error");
  });

  it("returns string representation of a number", () => {
    assert.equal(errorMessage(42), "42");
  });

  it("returns string representation of null", () => {
    assert.equal(errorMessage(null), "null");
  });

  it("returns string representation of undefined", () => {
    assert.equal(errorMessage(undefined), "undefined");
  });

  it("returns string representation of an object", () => {
    assert.equal(errorMessage({ code: "ENOENT" }), "[object Object]");
  });

  it("returns string representation of a boolean", () => {
    assert.equal(errorMessage(false), "false");
  });
});
