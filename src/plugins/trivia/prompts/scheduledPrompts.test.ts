import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SEND_QUESTIONS_INSTRUCTIONS, PROCESS_REVEAL_INSTRUCTIONS } from "./scheduledPrompts.js";

describe("SEND_QUESTIONS_INSTRUCTIONS (boolean path)", () => {
  it("is a non-empty prompt", () => {
    assert.equal(typeof SEND_QUESTIONS_INSTRUCTIONS, "string");
    assert.ok(SEND_QUESTIONS_INSTRUCTIONS.length > 100);
  });

  it("references the required trivia tools by bare name", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /get_ideas/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /find_previous_questions/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /save_question/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /post_questions/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /submit_response/);
  });

  it("enforces the difficulty gate", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /3\/10/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /4\/10/);
  });

  it("routes posting through post_questions, not submit_response with reactions", () => {
    // The tool, not the prompt, owns the reactions list. The prompt SHOULD reference the
    // [+1, -1] / numbered-emoji reactions in EXPLANATORY context (so Claude knows what gets
    // attached), but MUST NOT instruct Claude to pass them as a `reactions` argument.
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /post_questions\(\{[^}]*game/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /\{ questionId, blocks \}/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /reactions:\s*\["\+1"/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /Use submit_response with reactions/i);
  });

  it("terminates the run with skip_response: true", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /submit_response\(\{\s*skip_response:\s*true/);
  });

  it("instructs Claude to honor the server-chosen suggestedAnswer", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedAnswer/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Branch on suggestedAnswer/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Do NOT randomize the polarity yourself/i);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /randomly decide/i);
  });

  it("frames false statements directly instead of researching truth-then-flipping", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /CORRECT POLARITY FROM THE START/);
    assert.match(
      SEND_QUESTIONS_INSTRUCTIONS,
      /do NOT write a true statement and try to flip it later/i,
    );
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /plausible-sounding FALSE statement/);
  });

  it("includes an explicit polarity self-check gate", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /POLARITY SELF-CHECK/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Do these match\?/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /rewrite/i);
  });

  it("instructs Claude to target suggestedDifficulty with the bucket-to-1-10 mapping", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedDifficulty/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Easy/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Medium/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Hard/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Easy.*4-6/s);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Medium.*7-8/s);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Hard.*9-10/s);
  });

  it("invites invented styles rather than prescribing a rotation", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /invent a style/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Example/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /rotate between them/);
  });
});

describe("SEND_QUESTIONS_INSTRUCTIONS — format-aware multi-slot loop", () => {
  it("describes both outer flows (single-question + multi-slot)", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /SINGLE-QUESTION FLOW/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /MULTI-SLOT FLOW/);
  });

  it("instructs Claude to inspect the format field returned by get_ideas", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Inspect the response's `format`/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /format: null/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /format: \{ slotCount/);
  });

  it("describes per-slot get_ideas calls for i >= 1", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /get_ideas\(\{ game: "\{game\}", slot: i \}\)/);
  });

  it("explicitly forbids pre-rolling suggestions across slots", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Pre-rolling all suggestions up front is forbidden/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Do NOT reuse slot 0's `suggestedAnswer`/);
  });

  it("clarifies that slot.label is a creative hint, not literal", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /label.*creative HINT/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /do NOT copy the label literally/i);
  });

  it("instructs save_question to pass slot in multi-slot flow and omit in single-question", () => {
    assert.match(
      SEND_QUESTIONS_INSTRUCTIONS,
      /slot: `\{ index: i \}` — REQUIRED when the active season has a format/,
    );
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /MUST be OMITTED when format is null/);
  });

  it("specifies one post_questions call with N items in slot order", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /call `post_questions` ONCE/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /items MUST be in slot-index order/);
  });

  it("documents that duplicate detection stays game-scoped, not slot-scoped", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /GAME-SCOPED, not slot-scoped/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /do NOT filter by slot/i);
  });
});

describe("PROCESS_REVEAL_INSTRUCTIONS — multi-question branch", () => {
  it("branches on reveals.length with three explicit cases", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /reveals\.length === 0/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /reveals\.length === 1/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /reveals\.length > 1/);
  });

  it("describes the SINGLE-QUESTION and MULTI-QUESTION layouts as distinct sections", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /SINGLE-QUESTION LAYOUT/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /MULTI-QUESTION LAYOUT/);
  });

  it("documents the roundSummary field on the payload", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /roundSummary/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /totalQuestions/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /perPlayer/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /roundMvp/);
  });

  it("forbids Claude-side counting of correct/answered", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /MUST NOT recompute it from `reveals\[\]\.voters`/);
  });

  it("instructs the multi-question branch to mark roundMvp entries with the trophy emoji", () => {
    assert.match(
      PROCESS_REVEAL_INSTRUCTIONS,
      /Prefix every entry whose `roundMvp: true` is set with `🏆`/,
    );
  });

  it("keeps per-question verdicts brief (≤ 2 short sentences)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /≤ 2 short sentences/);
  });

  it("explicitly ignores roundSummary in the single-question branch", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /`roundSummary` field is IGNORED in this branch/);
  });
});

describe("PROCESS_REVEAL_INSTRUCTIONS — renderer brief", () => {
  it("is a non-empty prompt", () => {
    assert.equal(typeof PROCESS_REVEAL_INSTRUCTIONS, "string");
    assert.ok(PROCESS_REVEAL_INSTRUCTIONS.length > 100);
  });

  it("references process_reveal_answers as the single hot-path tool", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /process_reveal_answers/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /submit_response/);
  });

  it("does NOT enumerate the absorbed deterministic-step tools as required steps", () => {
    // These tools may be MENTIONED by name in a "you will NOT call these" caveat, but they
    // must not appear as required-step verbs. Check no specific step header references them.
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /Call fetch_channel_messages/);
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /Call find_previous_questions/);
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /Call get_question_history/);
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /Call submit_answers/);
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /Call retrieve_scores/);
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /Call check_season_status/);
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /Call upsert_season/);
  });

  it("does NOT contain a categorization/cheater-exclusion walkthrough", () => {
    // The renderer is told cheaters / multi-react voters are STRUCTURALLY absent; it must
    // NOT receive instructions to filter them out itself.
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /Exclude every user ID present in `cheater/i);
    assert.doesNotMatch(
      PROCESS_REVEAL_INSTRUCTIONS,
      /silently remove every user in cheaterUserIds/i,
    );
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /BEFORE submit_response/i);
  });

  it("does NOT reference cheat detection (handled by trivia-check)", () => {
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /save_cheating/);
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /<@ASKER_ID>/);
  });

  it("describes the payload shape (reveals, leaderboard, optional seasonStatus)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /reveals/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /leaderboard/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /seasonStatus/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /isLastFireOfSeason/);
  });

  it("names the voter buckets the renderer covers (correct/incorrect/fence-sitters/wildcards)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /CORRECT voters/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /INCORRECT voters/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /FENCE-SITTERS/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /WILDCARDS/);
  });

  it("instructs the renderer to skip empty voter buckets", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /Skip empty buckets entirely/i);
  });

  it("describes both 2-row and 3-row leaderboard table shapes keyed on seasonStatus presence", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /3-ROW DUAL-TOTALS TABLE/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /2-ROW TABLE/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /`seasonStatus` IS PRESENT/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /`seasonStatus` IS ABSENT/);
  });

  it("forbids predicting reveal timing", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /NEVER predict timing/);
  });

  it("instructs Unicode medal characters (not :first_place_medal: shortcodes) in table cells", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /Unicode characters, NOT/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /🥇/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /🥈/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /🥉/);
  });

  it("handles the empty-reveals case (acknowledge with humor; still render leaderboard)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /No verdict to deliver today/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /STILL render the cumulative leaderboard/);
  });
});
