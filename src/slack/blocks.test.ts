import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decodeActionValue } from "./blocks.js";

describe("decodeActionValue", () => {
  it("decodes a JSON-encoded value with session ID", () => {
    const result = decodeActionValue(JSON.stringify({ s: "session-123" }));
    assert.equal(result.sessionId, "session-123");
  });

  it("decodes ref from JSON", () => {
    const result = decodeActionValue(JSON.stringify({ s: "session-123", r: "ref-abc" }));
    assert.equal(result.sessionId, "session-123");
    assert.equal(result.ref, "ref-abc");
  });

  it("decodes choice value and workMode", () => {
    const result = decodeActionValue(JSON.stringify({ s: "s1", v: "option-a", w: true }));
    assert.equal(result.choiceValue, "option-a");
    assert.equal(result.workMode, true);
  });

  it("decodes followup prompt", () => {
    const result = decodeActionValue(JSON.stringify({ s: "s1", p: "please continue" }));
    assert.equal(result.prompt, "please continue");
  });

  it("decodes send_to_thread fields", () => {
    const result = decodeActionValue(JSON.stringify({
      s: "s1",
      c: "C123",
      t: "1234.5678",
      sn: "snapshot-1",
    }));
    assert.equal(result.targetChannel, "C123");
    assert.equal(result.targetThreadTs, "1234.5678");
    assert.equal(result.snapshotId, "snapshot-1");
  });

  it("falls back to plain string as sessionId for non-JSON", () => {
    const result = decodeActionValue("plain-session-id");
    assert.equal(result.sessionId, "plain-session-id");
    assert.equal(result.ref, undefined);
  });

  it("handles workMode=false by returning undefined", () => {
    const result = decodeActionValue(JSON.stringify({ s: "s1", w: false }));
    assert.equal(result.workMode, undefined);
  });
});
