import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { buildRevealFooterBlocks } from "./footer.js";
import type { VoterBuckets } from "../tools/reveal/types.js";

function sectionText(voters: VoterBuckets, answerLine = "👍 TRUE", tagPlayers = true): string {
  const [divider, section] = buildRevealFooterBlocks(voters, answerLine, "Q1", tagPlayers);
  assert.equal(divider.type, "divider");
  assert.equal(divider.block_id, "reveal-results-divider:Q1");
  assert.equal(section.type, "section");
  assert.equal(section.block_id, "reveal-results:Q1");
  assert.equal(section.text?.type, "mrkdwn");
  return section.text?.text ?? "";
}

const ALICE = { userId: "U_ALICE", displayName: "Alice" };
const BOB = { userId: "U_BOB", displayName: "Bob" };
const CY = { userId: "U_CY", displayName: "Cy" };

describe("buildRevealFooterBlocks", () => {
  it('always renders the "Answer was" line', () => {
    const text = sectionText({ revealResponses: "no", reactions: [] }, "Cream");
    assert.match(text, /\*Answer:\* Cream/);
  });

  it('"yes" names all non-empty buckets', () => {
    const text = sectionText({
      revealResponses: "yes",
      correct: [ALICE],
      incorrect: [BOB],
      noAnswer: [CY],
      reactions: [],
    });
    assert.match(text, /Correct:.*<@U_ALICE>/);
    assert.match(text, /Incorrect:.*<@U_BOB>/);
    assert.match(text, /Didn't answer:.*<@U_CY>/);
  });

  it('"just-correctness" names correct and incorrect buckets', () => {
    const text = sectionText({
      revealResponses: "just-correctness",
      correct: [ALICE],
      incorrect: [BOB],
      noAnswer: [],
      reactions: [],
    });
    assert.match(text, /Correct:.*<@U_ALICE>/);
    assert.match(text, /Incorrect:.*<@U_BOB>/);
  });

  it('"just-winners" names winners but only counts missers/non-answerers', () => {
    const text = sectionText({
      revealResponses: "just-winners",
      correct: [ALICE],
      incorrectCount: 3,
      noAnswerCount: 2,
      reactions: [],
    });
    assert.match(text, /Correct:.*<@U_ALICE>/);
    assert.match(text, /3 got it wrong/);
    assert.match(text, /2 didn't answer/);
    assert.doesNotMatch(text, /<@U_BOB>/);
  });

  it('"no" mode renders the answer line only — no names, no counts', () => {
    const text = sectionText({ revealResponses: "no", reactions: [] });
    assert.equal(text, "*Answer:* 👍 TRUE");
  });

  it("omits empty buckets rather than rendering placeholder lines", () => {
    const text = sectionText({
      revealResponses: "yes",
      correct: [ALICE],
      incorrect: [],
      noAnswer: [],
      reactions: [],
    });
    assert.match(text, /Correct:.*<@U_ALICE>/);
    assert.doesNotMatch(text, /Incorrect/);
    assert.doesNotMatch(text, /Didn't answer/);
  });

  it("tagPlayers=false renders plain @displayName instead of pinging mentions", () => {
    const text = sectionText(
      {
        revealResponses: "yes",
        correct: [ALICE],
        incorrect: [BOB],
        noAnswer: [CY],
        reactions: [],
      },
      "👍 TRUE",
      false,
    );
    assert.match(text, /Correct:.*@Alice/);
    assert.match(text, /Incorrect:.*@Bob/);
    assert.match(text, /Didn't answer:.*@Cy/);
    assert.doesNotMatch(text, /<@U_/);
  });

  it("omits just-winners count lines when the counts are zero", () => {
    const text = sectionText({
      revealResponses: "just-winners",
      correct: [ALICE],
      incorrectCount: 0,
      noAnswerCount: 0,
      reactions: [],
    });
    assert.doesNotMatch(text, /got it wrong/);
    assert.doesNotMatch(text, /didn't answer/);
  });
});
