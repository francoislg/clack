import { describe, it } from "vitest";
import assert from "node:assert/strict";
import {
  SEND_QUESTIONS_INSTRUCTIONS,
  PREP_QUESTIONS_INSTRUCTIONS,
  POST_QUESTIONS_INSTRUCTIONS,
} from "./scheduledPrompts.js";

describe("SEND_QUESTIONS_INSTRUCTIONS — visual (image-medium) paths", () => {
  it("dispatches on the 3-axis matrix including suggestedPromptMedium", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /3-axis matrix/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedPromptMedium/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /PROMPT-MEDIUM DISPATCH/);
  });

  it("defines all three visual path bodies", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /VISUAL CHOICE PATH BODY/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /VISUAL BOOLEAN PATH BODY/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /VISUAL FREEFORM PATH BODY/);
  });

  it("covers all 6 visual combinations (3 answer shapes × fact/topical)", () => {
    // fact variants are the path bodies; topical variants layer the TOPICAL MODIFIER.
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /image \+ topical \+ \{choice, boolean, freeform\}/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /grounds the SUBJECT in a recent event/);
  });

  it("encodes the VISUAL RESEARCH SUBFLOW with runtime tool discovery", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /VISUAL RESEARCH SUBFLOW/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /image_search/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /find_previous_subjects/);
  });

  it("short-circuits to text when no image-search tool is installed", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /no .*image_search.* tool is available/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /fall back to the TEXT-medium path/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /do NOT consume the retry budget/i);
  });

  it("includes the image-inspection and image-is-question gates", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /IMAGE INSPECTION GATE/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /ANSWER LEAKAGE/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /IMAGE-IS-QUESTION GATE/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /If I removed the image/);
  });

  it("specifies the retry budget (3 candidates, 2 categories) then text fallback", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /up to 3 candidate re-rolls/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /up to 2 category re-rolls/);
  });

  it("requires the image+boolean dual dedup check (subjects AND claim text)", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /DUAL DEDUP CHECK/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /image\+boolean only/);
  });

  it("saves with promptMedium image + media and builds an image block from media", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /promptMedium: "image"/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /media: \{ kind: "image"/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /add a SEPARATE `image` block/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /"image_url": "<media\.url>"/);
  });

  it("preserves the text-medium paths unchanged", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /FACT-BOOLEAN PATH/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /FACT-CHOICE PATH/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /TEXT-MEDIUM path bodies/);
  });

  it("prep and post prompts share the same visual paths", () => {
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /VISUAL RESEARCH SUBFLOW/);
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /VISUAL RESEARCH SUBFLOW/);
  });
});
