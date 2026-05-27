import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  parseTsFromPermalink,
  parseChannelFromPermalink,
  normalizeReactions,
  stripSkinTone,
  isExpectedUserLookupError,
} from "./slack.js";

describe("parseTsFromPermalink", () => {
  it("extracts the ts with dot inserted at 10 chars", () => {
    const link = "https://workspace.slack.com/archives/C0123/p1700000000123456";
    assert.equal(parseTsFromPermalink(link), "1700000000.123456");
  });

  it("pads microseconds to 6 digits when permalink has fewer", () => {
    const link = "https://workspace.slack.com/archives/C0123/p17000000001234";
    assert.equal(parseTsFromPermalink(link), "1700000000.123400");
  });

  it("returns null for permalinks without a /p... segment", () => {
    assert.equal(parseTsFromPermalink("https://workspace.slack.com/team/U123"), null);
  });

  it("returns null for a /p segment shorter than 10 digits", () => {
    assert.equal(parseTsFromPermalink("https://workspace.slack.com/archives/C0123/p12345"), null);
  });

  it("ignores trailing query params and thread fragments", () => {
    const link = "https://workspace.slack.com/archives/C0123/p1700000000123456?thread_ts=1234.56";
    assert.equal(parseTsFromPermalink(link), "1700000000.123456");
  });
});

describe("parseChannelFromPermalink", () => {
  it("extracts the channel ID from /archives/<id>/...", () => {
    assert.equal(
      parseChannelFromPermalink("https://workspace.slack.com/archives/C0123/p1700000000123456"),
      "C0123",
    );
  });

  it("handles group + DM channel prefixes", () => {
    assert.equal(parseChannelFromPermalink("https://x.slack.com/archives/G0456/p1"), "G0456");
    assert.equal(parseChannelFromPermalink("https://x.slack.com/archives/D0789/p1"), "D0789");
  });

  it("returns null when /archives/ is absent", () => {
    assert.equal(parseChannelFromPermalink("https://workspace.slack.com/team/U123"), null);
  });
});

describe("normalizeReactions", () => {
  it("returns an empty array on an empty input", () => {
    assert.deepEqual(normalizeReactions([]), []);
  });

  it("normalizes well-formed reactions into { emoji, users }", () => {
    assert.deepEqual(
      normalizeReactions([
        { name: "+1", users: ["U1", "U2"] },
        { name: "tada", users: ["U3"] },
      ]),
      [
        { emoji: "+1", users: ["U1", "U2"] },
        { emoji: "tada", users: ["U3"] },
      ],
    );
  });

  it("treats missing users field as empty array", () => {
    assert.deepEqual(normalizeReactions([{ name: "rocket" }]), [{ emoji: "rocket", users: [] }]);
  });

  it("preserves reaction order from the input", () => {
    const out = normalizeReactions([
      { name: "a", users: [] },
      { name: "b", users: [] },
      { name: "c", users: [] },
    ]);
    assert.deepEqual(
      out.map((r) => r.emoji),
      ["a", "b", "c"],
    );
  });

  it("strips the ::skin-tone-N suffix so +1::skin-tone-4 folds into +1", () => {
    assert.deepEqual(
      normalizeReactions([
        { name: "+1::skin-tone-4", users: ["U1"] },
        { name: "-1::skin-tone-2", users: ["U2"] },
      ]),
      [
        { emoji: "+1", users: ["U1"] },
        { emoji: "-1", users: ["U2"] },
      ],
    );
  });

  it("merges skin-tone variants with their base emoji and de-duplicates users", () => {
    assert.deepEqual(
      normalizeReactions([
        { name: "+1", users: ["U1", "U2"] },
        { name: "+1::skin-tone-3", users: ["U2", "U3"] },
        { name: "+1::skin-tone-5", users: ["U4"] },
      ]),
      [{ emoji: "+1", users: ["U1", "U2", "U3", "U4"] }],
    );
  });
});

describe("stripSkinTone", () => {
  it("removes the ::skin-tone-N suffix", () => {
    assert.equal(stripSkinTone("+1::skin-tone-4"), "+1");
    assert.equal(stripSkinTone("-1::skin-tone-2"), "-1");
    assert.equal(stripSkinTone("wave::skin-tone-6"), "wave");
  });

  it("leaves names without a skin-tone suffix unchanged", () => {
    assert.equal(stripSkinTone("+1"), "+1");
    assert.equal(stripSkinTone("thumbsup"), "thumbsup");
    assert.equal(stripSkinTone(""), "");
  });

  it("strips chained skin-tones on multi-person emoji", () => {
    assert.equal(stripSkinTone("kiss::skin-tone-2::skin-tone-4"), "kiss");
    assert.equal(stripSkinTone("couple_with_heart::skin-tone-3::skin-tone-5"), "couple_with_heart");
  });
});

function slackPlatformError(code: string): Error {
  const err = new Error(`Slack API error: ${code}`);
  Object.defineProperty(err, "data", { value: { error: code }, enumerable: true });
  return err;
}

describe("isExpectedUserLookupError", () => {
  it("returns true for user_not_found", () => {
    assert.equal(isExpectedUserLookupError(slackPlatformError("user_not_found")), true);
  });

  it("returns true for user_not_visible", () => {
    assert.equal(isExpectedUserLookupError(slackPlatformError("user_not_visible")), true);
  });

  it("returns true for bot_not_found", () => {
    assert.equal(isExpectedUserLookupError(slackPlatformError("bot_not_found")), true);
  });

  it("returns false for unrecognized Slack error codes (e.g. ratelimited)", () => {
    assert.equal(isExpectedUserLookupError(slackPlatformError("ratelimited")), false);
  });

  it("returns false for plain Errors with no `.data` envelope", () => {
    assert.equal(isExpectedUserLookupError(new Error("network down")), false);
  });

  it("returns false when `data.error` is missing", () => {
    const err = new Error("malformed");
    Object.defineProperty(err, "data", { value: {}, enumerable: true });
    assert.equal(isExpectedUserLookupError(err), false);
  });

  it("returns false when `data.error` is not a string", () => {
    const err = new Error("weird");
    Object.defineProperty(err, "data", { value: { error: 42 }, enumerable: true });
    assert.equal(isExpectedUserLookupError(err), false);
  });

  it("returns false for null / undefined / primitive throws", () => {
    assert.equal(isExpectedUserLookupError(null), false);
    assert.equal(isExpectedUserLookupError(undefined), false);
    assert.equal(isExpectedUserLookupError("user_not_found"), false);
    assert.equal(isExpectedUserLookupError(42), false);
  });
});
