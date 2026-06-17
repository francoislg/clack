import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  exclamationCount,
  extractEmoji,
  linkCount,
  politenessCount,
  questionMarkCount,
  wordCount,
} from "./text.js";

describe("conversation-stats text helpers", () => {
  it("counts words, ignoring empties and extra whitespace", () => {
    assert.equal(wordCount("  hello   there  world "), 3);
    assert.equal(wordCount(""), 0);
    assert.equal(wordCount("   "), 0);
  });

  it("counts question marks and exclamations", () => {
    assert.equal(questionMarkCount("really?? are you sure?"), 3);
    assert.equal(exclamationCount("wow! amazing!!"), 3);
  });

  it("counts politeness markers in EN and FR", () => {
    assert.equal(politenessCount("please help, svp"), 2);
    assert.equal(politenessCount("s'il vous plaît"), 1);
    assert.equal(politenessCount("nothing polite here"), 0);
  });

  it("counts http(s) links", () => {
    assert.equal(linkCount("see https://a.com and http://b.com"), 2);
    assert.equal(linkCount("no links"), 0);
  });

  it("extracts lettered shortcodes but drops numeric-only ones", () => {
    const emoji = extractEmoji("great :fire: work :22: and :parrot-party:");
    assert.deepEqual(emoji, [":fire:", ":parrot-party:"]);
  });

  it("extracts unicode emoji but not arrows or other symbols", () => {
    const emoji = extractEmoji("done ✅ → next 🚀 ← back");
    assert.deepEqual(emoji, ["✅", "🚀"]);
  });

  it("extracts valid emoji co-occurring with junk", () => {
    const emoji = extractEmoji(":22: 🔥 :tada:");
    assert.deepEqual(emoji, [":tada:", "🔥"]);
  });
});
