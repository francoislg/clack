import { describe, it } from "vitest";
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

  it("enforces a strict-membership difficulty gate with one-shot reframe", () => {
    // Positive: the new gate references the strict accept range, the reframe rule,
    // and the ≥2-off immediate-reject rule.
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedDifficultyRange/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /STRICT MEMBERSHIP/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /REFRAME ONCE/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /REJECT/);
    // Negative: the obsolete threshold field and the obsolete fixed bucket→range
    // mapping ("Easy = 4-6 / Medium = 7-8 / Hard = 9-10") must NOT appear — the
    // ranges are now configurable per game type and surfaced via suggestedDifficultyRange.
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /minimumDifficultyThreshold/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /Easy\s*=\s*4-6/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /STRICTLY BELOW/);
  });

  it("instructs boolean flows to re-run the polarity self-check after a reframe", () => {
    // Reframing-by-detail-swap can silently flip a TRUE statement to FALSE — the
    // polarity gate is what catches this. The boolean-flow gate must explicitly call
    // out re-running the polarity check after a reframe.
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /re-run the POLARITY SELF-CHECK/i);
  });

  it("routes posting through post_questions and never asks Claude to pass reactions or buttons", () => {
    // The tool owns answer affordances now — it appends an actions block (buttons) per format.
    // The prompt MUST NOT instruct Claude to pass a `reactions` or `buttons` argument, and
    // MUST NOT describe legacy auto-attached reactions as part of the post outcome.
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /post_questions\(\{[^}]*game/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /\{ questionId, blocks \}/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /reactions:\s*\["\+1"/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /Use submit_response with reactions/i);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /auto-attached.*reactions/i);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /Attaches vote reactions automatically/);
  });

  it("describes the appended per-format actions block (buttons), not reactions", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /actions.*block/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /ANSWER BUTTONS/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /👍 TRUE/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /👎 FALSE/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Answer.*button.*modal/i);
  });

  it("uses the FOUR-BLOCK card layout (not FIVE) and no longer describes an inline answer-options section", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /FOUR-BLOCK layout/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /FIVE-BLOCK layout/);
    // The "block 4 = answer options" / inline "TRUE • FALSE" / numbered-list directives are gone.
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /text is exactly `👍 TRUE\s+•\s+👎 FALSE`/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /CHOICE-PATH ANSWER OPTIONS/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /FREEFORM-PATH ANSWER OPTIONS/);
  });

  it("warns about the ~75-char Slack button-text cap for choice questions", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /75/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /button\.text/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /truncate/);
  });

  it("documents post_questions stamping liveAnswersVisible and revealResponses alongside postedAt", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Stamps[^.]*liveAnswersVisible/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /revealResponses/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /cascade/);
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

  it("targets suggestedDifficulty via the per-game-type suggestedDifficultyRange returned by get_ideas", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedDifficulty\b/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedDifficultyRange/);
    // The hardcoded Easy/Medium/Hard → 4-6/7-8/9-10 mapping must NOT be baked into the
    // prompt anymore — those numbers vary per game type (freeform is softer) and live in
    // the get_ideas response now.
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /Easy\s*(?:→|->|=)\s*4-6/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /Medium\s*(?:→|->|=)\s*7-8/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /Hard\s*(?:→|->|=)\s*9-10/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /Easy 4-6, Medium 7-8/);
  });

  it("invites invented styles rather than prescribing a rotation", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /invent a style/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Example/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /rotate between them/);
  });

  it("instructs Claude to retry partial failures with appendToPreviousBatch: true", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /appendToPreviousBatch:\s*true/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /retry/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /failed items/i);
    // Negative: must NOT instruct Claude to pass a raw batchId string argument.
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /batchId:\s*["']/);
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
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Do NOT reuse slot 0's rolls/);
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

  it("instructs the slot-0 header to be a date-stamped round opener distinct from the show banner", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /FIRST question only \(slot 0\)/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /date-stamped round opener/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Trivia for/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /less shouty than the show banner/i);
    assert.match(
      SEND_QUESTIONS_INSTRUCTIONS,
      /Subsequent slots in the same batch go back to the normal show-banner style/,
    );
  });
});

describe("SEND_QUESTIONS_INSTRUCTIONS — topical paths", () => {
  it("documents the 4-way dispatch matrix", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedAnswersFormat.*suggestedQuestionType/s);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /FACT-BOOLEAN PATH/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /FACT-CHOICE PATH/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /TOPICAL-BOOLEAN PATH/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /TOPICAL-CHOICE PATH/);
  });

  it("topical paths require WebSearch as a research step", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /RESEARCH A RECENT EVENT VIA WebSearch/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /WebSearch query/);
  });

  it("topical paths require capturing sourceUrl", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /sourceUrl.*https:\/\//);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /sourceUrl \(REQUIRED/);
  });

  it("topical save_question call passes questionType: 'topical'", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /questionType: "topical"/);
  });

  it("fact save_question call passes questionType: 'fact'", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /questionType: "fact"/);
  });

  it("aims topical research at the last day or two with up-to-a-week fallback", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /last day or two/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /up to a week/i);
  });
});

describe("SEND_QUESTIONS_INSTRUCTIONS — contexts (lens) handling", () => {
  it("includes the CONTEXTS preamble", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /CONTEXTS \(LENSES\)/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /contextPriority\[0\]/);
  });

  it("describes the priority-list descent rule", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Try `contextPriority\[0\]` FIRST/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Only descend.*contextPriority\[1\]/s);
  });

  it("treats empty-string entries as 'no specific lean'", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Empty-string entries mean "no specific lean"/);
  });

  it("instructs Claude to pass context to save_question when a non-empty lens was used", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /pass `context: "<the lens you used>"`/);
  });

  it("instructs Claude to re-call get_ideas when contextPriority is exhausted", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /re-call `get_ideas`/);
  });

  it("explains that absent contextPriority means generate without a lens", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /does NOT include `contextPriority`/);
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
    // The renderer is told cheaters are STRUCTURALLY absent; it must NOT receive
    // instructions to filter them out itself.
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

  it("describes the discriminated voters union keyed on revealResponses", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /DISCRIMINATED UNION/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /revealResponses: "yes"/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /revealResponses: "just-correctness"/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /revealResponses: "no"/);
  });

  it("describes the 'yes' mode with full per-bucket rendering (correct/incorrect/no-answer/reactions)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /`?"yes"`?\s+mode/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /CORRECT voters/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /INCORRECT voters/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /NO-ANSWER voters/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /REACTIONS commentary/);
  });

  it("describes 'just-correctness' mode as name-only with no freeform text quoting", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /`?"just-correctness"`?\s+mode/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /Name them only/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /DO NOT invent or speculate/);
  });

  it("describes 'no' mode as no per-bucket sections, reactions/closer/leaderboard only", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /`?"no"`?\s+mode/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /render NO per-bucket sections/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /MUST NOT speculate/);
  });

  it("instructs the renderer to skip empty bucket arrays", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /Skip empty arrays entirely/i);
  });

  it("frames reactions as commentary, not votes", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /COMMENTARY, not votes/i);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /emojis are color, not votes|color\/commentary/);
  });

  it("no longer describes the legacy fenceSitters/wildcards/multi-react world", () => {
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /fenceSitters/);
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /FENCE-SITTERS/);
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /WILDCARDS/);
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /multi-react voters/);
  });

  it("describes roundSummary as OPTIONAL, omitted when any entry is non-'yes'", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /roundSummary[^.]*OPTIONAL/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /OMITTED/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /`?"just-correctness"`?\s+or\s+`?"no"`?/);
  });

  it("describes both 2-row and 3-row leaderboard table shapes keyed on seasonStatus presence", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /3-ROW DUAL-TOTALS TABLE/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /2-ROW TABLE/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /`seasonStatus` IS PRESENT/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /`seasonStatus` IS ABSENT/);
  });

  it("uses 2-row layout when seasonStatus.hasPriorSeasons is false (single-season case)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /hasPriorSeasons` IS `false`/);
  });

  it("forbids predicting reveal timing", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /NEVER predict timing/);
  });

  it("instructs Unicode medal characters (not :first_place_medal: shortcodes) in table cells", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /Unicode characters, NOT/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /🥇/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /🥈/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /🥉/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /🎀/);
  });

  it("handles the empty-reveals case (acknowledge with humor; still render leaderboard)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /No verdict to deliver today/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /STILL render the cumulative leaderboard/);
  });
});

describe("SEND_QUESTIONS_INSTRUCTIONS — new-season opener branch", () => {
  it("references firstFireOfSeason as the trigger signal", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /firstFireOfSeason/);
  });

  it("describes the header + section opener block shape", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /header.*block/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /section.*block/i);
  });

  it("instructs Unicode 🆕 character (not :new: shortcode) in the opener header", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /🆕/);
    // The prompt MUST also explicitly warn against using the :new: shortcode at least once in
    // the opener context, mirroring the existing emoji-rule pattern used for table cells.
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /:new:/);
    assert.match(
      SEND_QUESTIONS_INSTRUCTIONS,
      /NEVER the `:new:` shortcode|never.*:new:|NOT the.*:new:/i,
    );
  });

  it("explicitly forbids rendering opener blocks when firstFireOfSeason is false", () => {
    // The prompt should contain a "do NOT" / "no opener" gate so Claude knows
    // not to ship opener blocks on mid-season fires.
    assert.match(
      SEND_QUESTIONS_INSTRUCTIONS,
      /firstFireOfSeason === false|firstFireOfSeason\b[^.]*false/,
    );
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /do NOT render any opener blocks|no opener blocks/i);
  });

  it("explicitly forbids mentioning a theme when the theme field is absent", () => {
    // Defends against fabrication, category-enumeration fallback, and "no theme yet" phrasings.
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /theme/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /do NOT (fabricate|mention)/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /no theme/i);
  });

  it("positions the opener branch outside the single-vs-multi-slot split (applies to both flows)", () => {
    // The opener should live BEFORE the per-question card layout (step 9 onwards) so it
    // attaches at the FRONT of the message regardless of outer flow.
    const openerIdx = SEND_QUESTIONS_INSTRUCTIONS.search(/NEW-SEASON OPENER/);
    const step9Idx = SEND_QUESTIONS_INSTRUCTIONS.search(/9\.\s*BUILD THE QUESTION CARD BLOCKS/);
    assert.ok(openerIdx > 0, "opener section should exist");
    assert.ok(step9Idx > 0, "step 9 should exist");
    assert.ok(
      openerIdx < step9Idx,
      "opener branch must appear BEFORE step 9 (so it prepends to the message)",
    );
    // And the prompt should explicitly call out the both-flows applicability.
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /BOTH outer flows|BOTH FLOWS/);
  });

  it("attaches the opener to items[0] once in multi-slot flow (not per slot)", () => {
    assert.match(
      SEND_QUESTIONS_INSTRUCTIONS,
      /prepended ONCE|opener.*ONCE|does NOT repeat per slot/i,
    );
  });
});
