import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { z } from "zod";
import { zodErrorToResult } from "./zodResult.js";

/** Helper: parse `input`, assert it failed, and format the error under `label`. */
function formatFailure(schema: z.ZodType, input: unknown, label: string): string {
  const parsed = schema.safeParse(input);
  assert.ok(!parsed.success, "expected a parse failure");
  return zodErrorToResult(parsed.error, label).error;
}

describe("zodErrorToResult", () => {
  it("labels a root-level failure with just the field label", () => {
    const schema = z.string({ message: "must be a string" });
    assert.equal(formatFailure(schema, 42, "theme"), "'theme' must be a string");
  });

  it("appends object keys with a dot", () => {
    const schema = z.object({ boolean: z.number().int("must be an integer") });
    assert.equal(
      formatFailure(schema, { boolean: 1.5 }, "answersFormat"),
      "'answersFormat.boolean' must be an integer",
    );
  });

  it("appends array indices with brackets", () => {
    const schema = z.array(z.object({ name: z.string("must be a string") }));
    assert.equal(
      formatFailure(schema, [{ name: "ok" }, { name: 3 }], "contexts"),
      "'contexts[1].name' must be a string",
    );
  });

  it("formats record (string-key) paths with a dot", () => {
    const schema = z.record(
      z.string(),
      z.object({ weight: z.number().positive("must be positive") }),
    );
    assert.equal(
      formatFailure(schema, { "2": { weight: -1 } }, "slotOverrides"),
      "'slotOverrides.2.weight' must be positive",
    );
  });

  it("joins multiple issues with a semicolon", () => {
    const schema = z.object({
      a: z.number("a must be a number"),
      b: z.number("b must be a number"),
    });
    assert.equal(
      formatFailure(schema, { a: "x", b: "y" }, "cfg"),
      "'cfg.a' a must be a number; 'cfg.b' b must be a number",
    );
  });
});
