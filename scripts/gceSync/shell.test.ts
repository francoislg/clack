import { describe, it, expect } from "vitest";
import { shellQuote, shellWords } from "./shell.js";

describe("shellQuote", () => {
  it("wraps a plain value in single quotes", () => {
    expect(shellQuote("data/config.json")).toBe("'data/config.json'");
  });

  it("escapes embedded single quotes", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });

  it("leaves shell metacharacters inert", () => {
    expect(shellQuote("$(rm -rf /); `x`")).toBe("'$(rm -rf /); `x`'");
  });
});

describe("shellWords", () => {
  it("quotes and space-joins each value", () => {
    expect(shellWords(["a b", "c"])).toBe("'a b' 'c'");
  });
});
