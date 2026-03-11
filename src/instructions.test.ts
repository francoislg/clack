import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { interpolateVariables } from "./instructions.js";

describe("interpolateVariables", () => {
  it("replaces known variables with their values", () => {
    const result = interpolateVariables("Hello {NAME}!", { NAME: "Clack" });
    assert.equal(result, "Hello Clack!");
  });

  it("replaces multiple occurrences of the same variable", () => {
    const result = interpolateVariables("{X} and {X}", { X: "a" });
    assert.equal(result, "a and a");
  });

  it("replaces multiple different variables", () => {
    const result = interpolateVariables("{BOT_NAME} v{VERSION}", {
      BOT_NAME: "Clack",
      VERSION: "2.0",
    });
    assert.equal(result, "Clack v2.0");
  });

  it("replaces unknown variables with empty string", () => {
    const result = interpolateVariables("Hello {UNKNOWN}!", {});
    assert.equal(result, "Hello !");
  });

  it("replaces a mix of known and unknown variables", () => {
    const result = interpolateVariables("{A} {B} {C}", { A: "1", C: "3" });
    assert.equal(result, "1  3");
  });

  it("returns the original string when there are no placeholders", () => {
    const result = interpolateVariables("no placeholders here", { X: "y" });
    assert.equal(result, "no placeholders here");
  });

  it("handles empty content", () => {
    const result = interpolateVariables("", { X: "y" });
    assert.equal(result, "");
  });

  it("handles empty variables map", () => {
    const result = interpolateVariables("plain text", {});
    assert.equal(result, "plain text");
  });

  it("only matches word characters inside braces", () => {
    // Curly braces with non-word characters should not be replaced
    const result = interpolateVariables("{with-dash} {with space}", {});
    assert.equal(result, "{with-dash} {with space}");
  });

  it("handles variables with underscores and digits", () => {
    const result = interpolateVariables("{VAR_1} {a2b}", {
      VAR_1: "first",
      a2b: "second",
    });
    assert.equal(result, "first second");
  });

  it("replaces variable value that itself contains braces literally", () => {
    const result = interpolateVariables("{X}", { X: "{Y}" });
    // The replacement is not recursive — {Y} stays as-is
    assert.equal(result, "{Y}");
  });

  it("handles adjacent placeholders", () => {
    const result = interpolateVariables("{A}{B}", { A: "1", B: "2" });
    assert.equal(result, "12");
  });
});
