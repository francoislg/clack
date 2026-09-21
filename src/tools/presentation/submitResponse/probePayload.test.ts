import { describe, it, expect } from "vitest";
import { findProbeRefusal, isProbeRefusal, PROBE_REFUSAL_CODE } from "./probePayload.js";

describe("findProbeRefusal", () => {
  describe("refuses probe payloads", () => {
    const probes = [
      "test",
      "Test",
      "TEST",
      "test.",
      "*test*",
      '"test"',
      "  test  ",
      "test!!!",
      "testing",
      "test 123",
      "testing 123",
      "test 1 2 3",
      "a test",
      "just a test",
      "this is a test",
      "this is another test",
      "test message",
      "test response",
      "test again",
      "test test",
      "hello world",
      "Hello, world!",
      "foo",
      "foo bar",
      "asdf",
      "lorem ipsum",
      "placeholder",
      "dummy text",
      "sample text",
    ];

    for (const text of probes) {
      it(`refuses ${JSON.stringify(text)}`, () => {
        expect(findProbeRefusal(text, "")).toContain(PROBE_REFUSAL_CODE);
      });
    }
  });

  describe("passes real answers through", () => {
    const answers = [
      "Tests pass.",
      "The test suite is green — 412 passing, 0 failing.",
      "I ran the tests and they all pass.",
      "Testing the login flow requires a seeded user.",
      "4",
      "Yes.",
      "No — the worker pool is disposable by default.",
      "test coverage is at 82%",
      "Here you go: test",
      "The word you asked for is: test",
      "hello world program",
      "foo() is defined in src/foo.ts",
    ];

    for (const text of answers) {
      it(`allows ${JSON.stringify(text)}`, () => {
        expect(findProbeRefusal(text, "")).toBeUndefined();
      });
    }
  });

  it("returns undefined for empty text", () => {
    expect(findProbeRefusal("", "")).toBeUndefined();
    expect(findProbeRefusal("   ", "")).toBeUndefined();
  });

  it("labels the primary message when no path prefix is given", () => {
    expect(findProbeRefusal("test", "")).toMatch(/^primary: /);
  });

  it("labels a follower message with its path prefix", () => {
    expect(findProbeRefusal("test", "thread_replies[2]")).toMatch(/^thread_replies\[2\]: /);
  });

  it("tells Claude the call was valid and to resend with a real answer", () => {
    const error = findProbeRefusal("test", "");
    expect(error).toContain("WOULD have delivered");
    expect(error).toContain("end the discussion");
    expect(error).toContain("Resend this same call with your real, complete answer");
  });

  it("quotes the offending text so Claude sees what was refused", () => {
    expect(findProbeRefusal("  testing 123  ", "")).toContain('"testing 123"');
  });
});

describe("isProbeRefusal", () => {
  it("recognizes its own error strings", () => {
    expect(isProbeRefusal(findProbeRefusal("test", "") as string)).toBe(true);
  });

  it("rejects formatting-class errors", () => {
    expect(isProbeRefusal("primary: response_too_long — text (12000 chars) exceeds")).toBe(false);
    expect(isProbeRefusal("blocks[0].text: text is required")).toBe(false);
  });
});
