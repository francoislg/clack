import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchesInlineStopEmoji, slackEmojiToUnicode } from "./stopEmoji.js";

const OCTAGONAL_SIGN = "\u{1F6D1}"; // 🛑
const STOP = "octagonal_sign";

describe("matchesInlineStopEmoji (Rule B)", () => {
  it("matches the Unicode form alone", () => {
    assert.equal(matchesInlineStopEmoji(OCTAGONAL_SIGN, STOP), true);
  });

  it("matches the colon shortcode form alone", () => {
    assert.equal(matchesInlineStopEmoji(":octagonal_sign:", STOP), true);
  });

  it("matches Unicode with a short reason", () => {
    assert.equal(matchesInlineStopEmoji(`${OCTAGONAL_SIGN} please stop`, STOP), true);
  });

  it("matches colon form with a short reason", () => {
    assert.equal(matchesInlineStopEmoji(":octagonal_sign: wrong branch", STOP), true);
  });

  it("matches when both forms appear together", () => {
    assert.equal(matchesInlineStopEmoji(`${OCTAGONAL_SIGN} :octagonal_sign:`, STOP), true);
  });

  it("matches at exactly 60 characters", () => {
    const padding = "x".repeat(58);
    assert.equal(matchesInlineStopEmoji(`${padding}${OCTAGONAL_SIGN}`, STOP), true);
  });

  it("does NOT match when text exceeds 60 characters", () => {
    const long = "I was thinking about this and wanted to flag: 🛑 the rollout graph shape today";
    assert.ok(long.trim().length > 60);
    assert.equal(matchesInlineStopEmoji(long, STOP), false);
  });

  it("does NOT match a long colon-form message", () => {
    const text = "The :octagonal_sign: emoji is handy to use for highlighting errors in docs";
    assert.equal(matchesInlineStopEmoji(text, STOP), false);
  });

  it("does NOT match when text does not contain the configured emoji", () => {
    assert.equal(matchesInlineStopEmoji("stop", STOP), false);
    assert.equal(matchesInlineStopEmoji("please stop now", STOP), false);
    assert.equal(matchesInlineStopEmoji("❌", STOP), false);
  });

  it("does NOT match when text is empty or whitespace only", () => {
    assert.equal(matchesInlineStopEmoji("", STOP), false);
    assert.equal(matchesInlineStopEmoji("   ", STOP), false);
    assert.equal(matchesInlineStopEmoji(undefined, STOP), false);
  });

  it("does NOT match when stopEmoji is null", () => {
    assert.equal(matchesInlineStopEmoji(OCTAGONAL_SIGN, null), false);
    assert.equal(matchesInlineStopEmoji(":octagonal_sign:", null), false);
  });

  it("does NOT match when stopEmoji is empty string", () => {
    assert.equal(matchesInlineStopEmoji(OCTAGONAL_SIGN, ""), false);
  });

  it("does NOT match when stopEmoji is undefined", () => {
    assert.equal(matchesInlineStopEmoji(OCTAGONAL_SIGN, undefined), false);
  });

  it("matches a custom emoji via its colon form only", () => {
    assert.equal(matchesInlineStopEmoji(":clack-stop:", "clack-stop"), true);
    assert.equal(matchesInlineStopEmoji("🛑", "clack-stop"), false);
  });

  it("trims the message before the length check", () => {
    const text = `\n\n   ${OCTAGONAL_SIGN}   \n\n`;
    assert.equal(matchesInlineStopEmoji(text, STOP), true);
  });
});

describe("slackEmojiToUnicode", () => {
  it("maps standard stop emoji names", () => {
    assert.equal(slackEmojiToUnicode("octagonal_sign"), OCTAGONAL_SIGN);
    assert.equal(slackEmojiToUnicode("stop_sign"), OCTAGONAL_SIGN);
  });

  it("returns undefined for unknown/custom emoji names", () => {
    assert.equal(slackEmojiToUnicode("clack-stop"), undefined);
    assert.equal(slackEmojiToUnicode("totally-made-up"), undefined);
  });
});
