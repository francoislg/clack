import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { truncate } from "./text.js";

describe("truncate", () => {
  it("returns the string unchanged when shorter than max", () => {
    assert.equal(truncate("hello", 10), "hello");
  });

  it("returns the string unchanged when equal to max", () => {
    assert.equal(truncate("hello", 5), "hello");
  });

  it("truncates and appends ellipsis when longer than max", () => {
    assert.equal(truncate("hello world", 8), "hello w…");
  });

  it("truncates a single character result correctly", () => {
    assert.equal(truncate("abc", 2), "a…");
  });

  it("handles empty string", () => {
    assert.equal(truncate("", 5), "");
  });

  it("handles max of 1 with a long string", () => {
    assert.equal(truncate("hello", 1), "…");
  });
});
