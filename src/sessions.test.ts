import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSessionId, hasErrors } from "./sessions.js";
import type { SessionContext } from "./sessions.js";

describe("parseSessionId", () => {
  it("parses a valid session ID into channelId, messageTs, and userId", () => {
    const result = parseSessionId("C0A82GNR25V-1768338604-542809-U09FSR0REUQ-1768400009272");
    assert.deepEqual(result, {
      channelId: "C0A82GNR25V",
      messageTs: "1768338604.542809",
      userId: "U09FSR0REUQ",
    });
  });

  it("handles different channel ID prefixes (C and G)", () => {
    const cResult = parseSessionId("C12345-1000000-111111-U12345-9999999");
    assert.ok(cResult);
    assert.equal(cResult.channelId, "C12345");

    const gResult = parseSessionId("G12345-1000000-111111-U12345-9999999");
    assert.ok(gResult);
    assert.equal(gResult.channelId, "G12345");
  });

  it("reconstructs messageTs with dot separator from hyphenated parts", () => {
    const result = parseSessionId("CABC123-1234567890-123456-UABC123-1700000000000");
    assert.ok(result);
    assert.equal(result.messageTs, "1234567890.123456");
  });

  it("returns null for malformed session IDs", () => {
    assert.equal(parseSessionId(""), null);
    assert.equal(parseSessionId("not-a-session-id"), null);
    assert.equal(parseSessionId("missing-parts"), null);
  });

  it("returns null when channel ID prefix is not C or G", () => {
    assert.equal(parseSessionId("X12345-1000000-111111-U12345-9999999"), null);
  });

  it("returns null when user ID prefix is not U", () => {
    assert.equal(parseSessionId("C12345-1000000-111111-X12345-9999999"), null);
  });

  it("returns null when timestamp segment is missing", () => {
    assert.equal(parseSessionId("C12345-U12345-9999999"), null);
  });
});

describe("hasErrors", () => {
  const baseSession: SessionContext = {
    sessionId: "test-session",
    channelId: "C123",
    messageTs: "1234.5678",
    threadTs: "1234.5678",
    userId: "U123",
    originalQuestion: "test question",
    threadContext: [],
    refinements: [],
    errors: [],
    lastActivity: Date.now(),
    createdAt: Date.now(),
  };

  it("returns false when errors array is empty", () => {
    assert.equal(hasErrors(baseSession), false);
  });

  it("returns true when there are errors", () => {
    const session = {
      ...baseSession,
      errors: [
        {
          timestamp: Date.now(),
          errorMessage: "something went wrong",
          conversationTrace: [],
        },
      ],
    };
    assert.equal(hasErrors(session), true);
  });

  it("returns true with multiple errors", () => {
    const session = {
      ...baseSession,
      errors: [
        { timestamp: Date.now(), errorMessage: "error 1", conversationTrace: [] },
        { timestamp: Date.now(), errorMessage: "error 2", conversationTrace: [] },
      ],
    };
    assert.equal(hasErrors(session), true);
  });
});
