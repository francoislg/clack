import { describe, it, afterEach } from "vitest";
import assert from "node:assert/strict";
import {
  SEND_QUESTIONS_INSTRUCTIONS,
  buildProcessRevealInstructions,
  PREP_QUESTIONS_INSTRUCTIONS,
  POST_QUESTIONS_INSTRUCTIONS,
} from "./scheduledPrompts.js";
import { setTriviaT, _resetTriviaT } from "../i18n/t.js";
import { en, fr } from "../i18n/strings.js";

// The reveal prompt is now a builder; with no `setTriviaT` call the translator falls back
// to EN, so this renders the English labels these structural assertions expect.
const PROCESS_REVEAL_INSTRUCTIONS = buildProcessRevealInstructions();

/** Minimal French resolver mirroring the SDK's `t`: FR table with EN fallback + `{var}` interpolation. */
function frResolver(key: string, vars?: Record<string, string | number>): string {
  const frTable = fr as Record<string, string | undefined>;
  const enTable = en as Record<string, string>;
  let out = frTable[key] ?? enTable[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.replaceAll(`{${k}}`, String(v));
  return out;
}

describe("flexible-format prefix wording", () => {
  it("SEND instructs a flexible PREFIX with stop-early and zero-skip", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /flexible/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /CEILING/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /STOP/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /post NOTHING|post 0|skipped/i);
  });

  it("SEND preserves the fixed fill-every-slot mandate", () => {
    assert.match(
      SEND_QUESTIONS_INSTRUCTIONS,
      /Repeat until all N slots have been generated and saved/,
    );
  });

  it("POST and PREP (staged-pool dispatch) carry the FLEXIBLE PREFIX clause", () => {
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /FLEXIBLE PREFIX/);
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /FLEXIBLE PREFIX/);
  });

  it("POST step preserves the fixed every-slot loop", () => {
    assert.match(
      POST_QUESTIONS_INSTRUCTIONS,
      /every slot index in `\[0\.\.slotCount-1\]` is covered/,
    );
  });
});

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

  it("documents the 40-char hard cap for choice question labels", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /40 characters/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /save_question` rejects/);
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

  it("documents that duplicate detection is cross-game and not slot-scoped", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /CROSS-GAME/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /GAME-SCOPED/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /do NOT filter by slot/i);
  });

  it("uses keywords plus match for dedup and omits the games argument", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /find_previous_questions\(\{ keywords: \[/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /match: "any"/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /OMIT the `games` argument/);
    assert.doesNotMatch(
      SEND_QUESTIONS_INSTRUCTIONS,
      /Call find_previous_questions with a distinctive keyword/,
    );
  });

  it("mandates the primary subject AND the answer as dedup keywords", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /MUST include BOTH/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /PRIMARY SUBJECT/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /the part that VARIES within its category/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /The ANSWER — the correct response as a search term/);
  });

  it("frames the answer as a recall aid, not a duplication verdict", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /RECALL AID, NOT a duplication verdict/);
    assert.match(
      SEND_QUESTIONS_INSTRUCTIONS,
      /sharing the same answer in a DIFFERENT context .* is NOT a duplicate/,
    );
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Judge duplication by the subject and framing/);
    assert.doesNotMatch(
      SEND_QUESTIONS_INSTRUCTIONS,
      /necessarily shares BOTH the subject and the answer/,
    );
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

  it("prefers salient events over mere recency", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /SALIENCE BAR/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Prefer SALIENCE over recency/i);
  });

  it("constrains topical FALSE boolean statements to substance swaps, never date/number", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /swap exactly ONE element of the event's SUBSTANCE/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /NEVER make it false by swapping a date or a number/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /swap a date, a name, a place, or a number/);
  });

  it("falls back to the fact path for the same answersFormat when no salient event surfaces", () => {
    assert.match(
      SEND_QUESTIONS_INSTRUCTIONS,
      /FALL BACK to the fact path for the same answersFormat/,
    );
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

  it("forbids a prose Round Summary section block (the This Round table row carries it)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /Do NOT add a "Round Summary" `section` block/);
  });

  it("keeps per-question verdicts brief (≤ 2 short sentences)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /≤ 2 short sentences/);
  });

  it("single-question branch always drives the This Round row from roundSummary", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /always drives the `This Round` leaderboard row/);
  });
});

describe("PROCESS_REVEAL_INSTRUCTIONS — renderer brief", () => {
  it("is a non-empty prompt", () => {
    assert.equal(typeof PROCESS_REVEAL_INSTRUCTIONS, "string");
    assert.ok(PROCESS_REVEAL_INSTRUCTIONS.length > 100);
  });

  it("sequences compute_answers → update_answers_block → submit_response", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /compute_answers/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /update_answers_block/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /start_new_season/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /submit_response/);
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /process_reveal_answers/);
  });

  it("orders the tool chain compute_answers → update_answers_block → start_new_season", () => {
    // The orchestration moved into this prompt — its ORDER is the runtime contract.
    // `sequences …` above only checks each name exists; this pins the actual sequence.
    const iCompute = PROCESS_REVEAL_INSTRUCTIONS.indexOf("compute_answers");
    const iUpdate = PROCESS_REVEAL_INSTRUCTIONS.indexOf("update_answers_block");
    const iSeason = PROCESS_REVEAL_INSTRUCTIONS.indexOf("start_new_season");
    assert.ok(iCompute >= 0 && iUpdate >= 0 && iSeason >= 0);
    assert.ok(iCompute < iUpdate, "compute_answers must come before update_answers_block");
    assert.ok(iUpdate < iSeason, "update_answers_block must come before start_new_season");
  });

  it("threads the revealed questionIds from compute_answers into update_answers_block", () => {
    // update_answers_block is keyed on questionIds; if the prompt stops telling Claude to
    // pass the step-1 reveals[].questionId, the projector has nothing to repaint.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /Note the `reveals\[\]\.questionId` values/);
    assert.match(
      PROCESS_REVEAL_INSTRUCTIONS,
      /update_answers_block\(\{ game: "\{game\}", questionIds: <every reveals\[\]\.questionId from step 1> \}\)/,
    );
    // The batch handle must never be surfaced to Claude in the reveal flow.
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /batchId: <the batchId from step 1>/);
  });

  it("gates start_new_season to the season's last fire only (never unconditional)", () => {
    // The tool itself now re-verifies the last fire (see startNewSeason.ts confirmation
    // guard), but this prompt conditional is still the first line of defense keeping a
    // mid-season fire from even attempting the rollover.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /IF AND ONLY IF[^\n]*isLastFireOfSeason === true/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /isLastFireOfSeason` is false, SKIP this call/);
    // And it must be REQUIRED (not optional) when the last fire IS reached.
    assert.match(
      PROCESS_REVEAL_INSTRUCTIONS,
      /When `isLastFireOfSeason` is true you MUST call `start_new_season/,
    );
  });

  it("branches on includeRevealInQuestions: yes authors per-card narrative, no does not", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /includeRevealInQuestions/);
    // The "yes" branch instructs a per-question update_question call carrying revealBlocks,
    // explicitly before update_answers_block (step 2).
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /AUTHOR PER-CARD NARRATIVE/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /update_question\(/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /revealBlocks/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /BEFORE you call `update_answers_block` in step 2/);
    // The "no" branch authors nothing.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /`"no"`: do NOT call `update_question`/);
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

  it("describes roundSummary as ALWAYS present and mode-independent", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /roundSummary[^.]*ALWAYS present/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /INDEPENDENT of `revealResponses`/);
    // The render gate is an empty perPlayer (nobody answered), never the mode.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /`perPlayer` is EMPTY/);
    // No mode-based omission of the scoreboard survives.
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /roundSummary` is OMITTED/);
    assert.doesNotMatch(
      PROCESS_REVEAL_INSTRUCTIONS,
      /`?"just-correctness"`?,\s+`?"just-winners"`?,\s+or\s+`?"no"`?/,
    );
  });

  it("describes the additive leaderboard rows (This Round / Current Season / All Time)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /LEADERBOARD TABLE/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /THE ROWS are ADDITIVE/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /"Current Season"/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /"All Time"/);
    // The legacy fixed-shape catalog is gone.
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /4-ROW DUAL-TOTALS TABLE/);
    assert.doesNotMatch(PROCESS_REVEAL_INSTRUCTIONS, /3-ROW LABELED TABLE/);
  });

  it("relabels the single-season anchor row to Current Season (no All Time)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /single season/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /REPLACES the old unlabeled two-row/);
    // The anchor Current Season row is always present when seasons are on.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /the anchor row/);
  });

  it("describes the This Round leaderboard row sourced from roundSummary.perPlayer", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /"This Round"/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /roundSummary\.perPlayer/);
    // Lookup-by-userId is the join key — Claude must not match by displayName.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /look up the entry by `userId`/);
  });

  it("describes the perfect-round star appended to the This Round cell", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /PERFECT-ROUND STAR/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /perfectRound: true/);
    // The star trails the medal-and-score content; the worked example shows it.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /🥇 3 ⭐/);
    // Server flag is authoritative — Claude must not re-derive perfection.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /do NOT re-derive perfection/);
  });

  it("gates the This Round row on a non-empty perPlayer, not reveals.length or reveal mode", () => {
    // Rendered whenever perPlayer is non-empty, for any reveal count and any mode.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /whenever `roundSummary\.perPlayer` is non-empty/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /ANY reveal count/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /ANY reveal mode/);
    // No longer gated on reveals.length > 1.
    assert.doesNotMatch(
      PROCESS_REVEAL_INSTRUCTIONS,
      /`reveals\.length > 1`\s+AND\s+`roundSummary`/,
    );
  });

  it("decides the column order once and forbids per-row sorting", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /DECIDE THE COLUMN ORDER ONCE/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /NEVER sort an individual row's cells/);
    // The leftmost-column-is-round-leader consequence is stated.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /leftmost column is the ROUND leader/);
  });

  it("instructs em-dash for absent players in the This Round row (never empty string)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /"—"/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /em-dash/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /invalid_blocks/);
  });

  it("uses one dense-rank medal rule where ties share a medal and 0/em-dash never medal", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /DENSE-RANK MEDAL RULE/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /Rank by DISTINCT value/);
    // Ties share.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /TIES SHARE/);
    // Zero / em-dash never medal.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /receive NO medal — never/);
  });

  it("gates the All Time row on hasPriorSeasons AND showAllTimeRow", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /showAllTimeRow/);
    assert.match(
      PROCESS_REVEAL_INSTRUCTIONS,
      /`seasonStatus\.hasPriorSeasons === true` AND `showAllTimeRow/,
    );
    // Backward-compat: absent → treat as true.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /when the field is ABSENT, treat it as `true`/);
  });

  it("describes the season finale layout (podium, participation tail, gated all-time table)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /SEASON FINALE LAYOUT/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /SEASON WINNERS PODIUM/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /First place/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /PARTICIPATION TAIL/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /🎀/);
    // The all-time finale table is gated and may be omitted.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /ALL-TIME TABLE/);
    // Finale must not preview the next season or call upsert_season.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /do NOT call `upsert_season`/);
  });

  it("renders expanded answer detail when nobody got it right", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /NOBODY GOT IT/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /EXPANDED explanation of the correct answer/);
    // Replaces the INCORRECT names section in named-bucket modes.
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /REPLACES the INCORRECT names section/);
  });

  it("forbids predicting reveal timing", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /NEVER predict timing/);
  });

  it("instructs Unicode medal characters (not :first_place_medal: shortcodes) in table cells", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /Unicode glyphs, NOT/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /🥇/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /🥈/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /🥉/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /🎀/);
  });

  it("handles the empty-reveals case by posting nothing (skip_response, no leaderboard)", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /POST NOTHING and SKIP steps 2–4/);
    assert.match(
      PROCESS_REVEAL_INSTRUCTIONS,
      /reveals\.length === 0[\s\S]*?POST NOTHING\. Call `submit_response\(\{ skip_response: true \}\)/,
    );
  });
});

describe("PROCESS_REVEAL_INSTRUCTIONS — finalRevealSummary placement branch", () => {
  it("documents finalRevealSummary in the payload and a SUMMARY PLACEMENT branch", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /finalRevealSummary/);
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /SUMMARY PLACEMENT — BRANCH ON `finalRevealSummary`/);
  });

  it("branches the narrative on all three modes (yes top-level, no omitted, in-thread threaded)", () => {
    const placement = PROCESS_REVEAL_INSTRUCTIONS.slice(
      PROCESS_REVEAL_INSTRUCTIONS.indexOf("SUMMARY PLACEMENT"),
    );
    assert.match(placement, /`"yes"`[^\n]*today's behavior/);
    assert.match(placement, /`"no"`: OMIT the NARRATIVE entirely/);
    assert.match(placement, /`"in-thread"`: keep the HEADLINE top-level/);
  });

  it("in-thread hoists the verdict header top-level for single AND multi layouts", () => {
    const placement = PROCESS_REVEAL_INSTRUCTIONS.slice(
      PROCESS_REVEAL_INSTRUCTIONS.indexOf("SUMMARY PLACEMENT"),
    );
    assert.match(
      placement,
      /HOIST it out of the NARRATIVE so it leads the top message in BOTH the single- and multi-question layouts/,
    );
  });

  it("MENTION POLICY branches every block on tagPlayers (no-ping = @displayName)", () => {
    const policy = PROCESS_REVEAL_INSTRUCTIONS.slice(
      PROCESS_REVEAL_INSTRUCTIONS.indexOf("MENTION POLICY"),
    );
    assert.match(policy, /MENTION POLICY — BRANCH ON `tagPlayers`/);
    assert.match(policy, /`tagPlayers: true` \(default\): name players with real `<@USERID>`/);
    assert.match(policy, /`tagPlayers: false`: NEVER emit `<@USERID>`/);
    assert.match(policy, /plain-text `@displayName`/);
  });

  it("keeps the leaderboard ALWAYS top-level in every mode", () => {
    assert.match(
      PROCESS_REVEAL_INSTRUCTIONS,
      /ALWAYS posts TOP-LEVEL in EVERY mode — the standings are never hidden, never moved to a thread/,
    );
  });

  it("keeps the season finale top-level in every mode (in-thread: day's verdicts to thread)", () => {
    assert.match(
      PROCESS_REVEAL_INSTRUCTIONS,
      /ON THE LAST FIRE \(finale\) in `"in-thread"`: the SEASON FINALE LAYOUT stays TOP-LEVEL/,
    );
    assert.match(
      PROCESS_REVEAL_INSTRUCTIONS,
      /REMAINING NARRATIVE[^\n]*STILL moves to `thread_replies`/,
    );
  });

  it("in-thread mode requires BOTH the localized pointer AND a thread_replies payload", () => {
    assert.match(PROCESS_REVEAL_INSTRUCTIONS, /💬 Full reveal in the thread 👇/);
    assert.match(
      PROCESS_REVEAL_INSTRUCTIONS,
      /thread_replies: \[\{ blocks: \[ \.\.\.remaining NARRATIVE \] \}\]/,
    );
    assert.match(
      PROCESS_REVEAL_INSTRUCTIONS,
      /MUST include BOTH the top-level header\+pointer AND the `thread_replies` payload/,
    );
  });
});

describe("buildProcessRevealInstructions — leaderboard label localization", () => {
  // Always restore the EN-fallback resolver so the module-level const (and other suites)
  // are unaffected by the French resolver these tests install.
  afterEach(() => {
    _resetTriviaT();
  });

  it("renders French leaderboard + podium labels when the translator is French", () => {
    setTriviaT(frResolver);
    const prompt = buildProcessRevealInstructions();

    // Leaderboard row-label directives (backtick-quoted form) are localized.
    assert.ok(prompt.includes('`"Ce tour"`'));
    assert.ok(prompt.includes('`"Saison en cours"`'));
    assert.ok(prompt.includes('`"Cumulatif"`'));

    // Worked example table cells localize too, so Claude can't anchor on English examples.
    assert.ok(prompt.includes('["Ce tour"'));
    assert.ok(prompt.includes('["Saison en cours"'));
    assert.ok(prompt.includes('["Cumulatif"'));

    // Season-finale podium labels are localized.
    assert.ok(prompt.includes("🥇 Première place"));
    assert.ok(prompt.includes("🥈 Deuxième place"));
    assert.ok(prompt.includes("🥉 Troisième place"));

    // The English label forms must be gone (the directive + example-cell forms; prose concept
    // refs like `Current Season` without inner quotes are intentionally left English).
    assert.ok(!prompt.includes('`"Current Season"`'));
    assert.ok(!prompt.includes('["Current Season"'));
    assert.ok(!prompt.includes("First place"));
  });

  it("renders English labels by default (EN-fallback, byte-stable)", () => {
    _resetTriviaT();
    const prompt = buildProcessRevealInstructions();

    assert.ok(prompt.includes('`"This Round"`'));
    assert.ok(prompt.includes('`"Current Season"`'));
    assert.ok(prompt.includes('`"All Time"`'));
    assert.ok(prompt.includes('["This Round"'));
    assert.ok(prompt.includes("🥇 First place"));

    // No French label leaks into the default render.
    assert.ok(!prompt.includes("Saison en cours"));
    assert.ok(!prompt.includes("Première place"));
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

describe("PREP_QUESTIONS_INSTRUCTIONS", () => {
  it("is a non-empty prompt", () => {
    assert.equal(typeof PREP_QUESTIONS_INSTRUCTIONS, "string");
    assert.ok(PREP_QUESTIONS_INSTRUCTIONS.length > 100);
  });

  it("references the gen-only tools but NOT post_questions", () => {
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /get_ideas/);
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /find_previous_questions/);
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /save_question/);
    assert.doesNotMatch(
      PREP_QUESTIONS_INSTRUCTIONS,
      /\bpost_questions\(/,
      "PREP must NOT invoke post_questions",
    );
  });

  it("explicitly forbids posting and explains the channelless restriction", () => {
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /will NOT post any Slack message/i);
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /not in your tool allowlist|channelless/i);
  });

  it("includes the staged-pool check as the required first step", () => {
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /STAGED POOL CHECK/);
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /posted:\s*false/);
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /seasons:\s*\["current"\]/);
  });

  it("instructs no-op when every slot is already filled", () => {
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /every slot is already FILLED/i);
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /save_question zero times|NO-OP/i);
  });

  it("includes a final validation step after saving", () => {
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /FINAL VALIDATION/);
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /re-call .*find_previous_questions/);
  });

  it("terminates with submit_response skip", () => {
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /submit_response\(\{\s*skip_response:\s*true/);
  });

  it("includes the per-slot generation paths verbatim (shared with POST)", () => {
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /FACT-BOOLEAN PATH/);
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /FACT-CHOICE PATH/);
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /TOPICAL-BOOLEAN PATH/);
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /TOPICAL-CHOICE PATH/);
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /FACT-FREEFORM PATH/);
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /TOPICAL-FREEFORM PATH/);
  });

  it("does NOT contain the FORMAT & POST presentation section", () => {
    assert.doesNotMatch(PREP_QUESTIONS_INSTRUCTIONS, /=== FORMAT & POST/);
    assert.doesNotMatch(PREP_QUESTIONS_INSTRUCTIONS, /BUILD THE QUESTION CARD BLOCKS/);
    assert.doesNotMatch(PREP_QUESTIONS_INSTRUCTIONS, /NEW-SEASON OPENER/);
  });
});

describe("POST_QUESTIONS_INSTRUCTIONS", () => {
  it("is a non-empty prompt", () => {
    assert.equal(typeof POST_QUESTIONS_INSTRUCTIONS, "string");
    assert.ok(POST_QUESTIONS_INSTRUCTIONS.length > 100);
  });

  it("includes the staged-pool check as the required first step", () => {
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /STAGED POOL CHECK/);
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /posted:\s*false/);
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /seasons:\s*\["current"\]/);
  });

  it("retains the full FORMAT & POST presentation section", () => {
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /=== FORMAT & POST/);
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /BUILD THE QUESTION CARD BLOCKS/);
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /NEW-SEASON OPENER/);
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /post_questions/);
  });

  it("includes the per-slot generation paths verbatim (shared with PREP)", () => {
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /FACT-BOOLEAN PATH/);
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /FACT-CHOICE PATH/);
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /TOPICAL-BOOLEAN PATH/);
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /TOPICAL-CHOICE PATH/);
  });

  it("describes the FILLED vs MISSING per-slot dispatch", () => {
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /FILLED/);
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /MISSING/);
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /do NOT regenerate/i);
  });
});

describe("PREP and POST share PER_SLOT_GENERATION_PATHS content", () => {
  it("both include the same matrix dispatch description", () => {
    const sample = "DISPATCHES on a 3-axis matrix";
    assert.ok(PREP_QUESTIONS_INSTRUCTIONS.includes(sample));
    assert.ok(POST_QUESTIONS_INSTRUCTIONS.includes(sample));
  });

  it("both include the same BOOLEAN path body heading", () => {
    const sample = "=== BOOLEAN PATH BODY";
    assert.ok(PREP_QUESTIONS_INSTRUCTIONS.includes(sample));
    assert.ok(POST_QUESTIONS_INSTRUCTIONS.includes(sample));
  });
});

describe("{game} substitution works on PREP and POST", () => {
  it("PREP contains placeholder for game name", () => {
    assert.match(PREP_QUESTIONS_INSTRUCTIONS, /\{game\}/);
  });

  it("POST contains placeholder for game name", () => {
    assert.match(POST_QUESTIONS_INSTRUCTIONS, /\{game\}/);
  });
});

describe("SEND_QUESTIONS_INSTRUCTIONS — HINT DRAFTING GATE", () => {
  it("defines the gate with the required structural pieces", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /HINT DRAFTING GATE/);
    // mode branches
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /suggestedHintMode === "none"/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /"button"/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /"inline"/);
    // 140-char cap
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /140 characters/);
    // self-review step
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /SELF-REVIEW/);
    // omit-when-no-useful-nudge — explicit "acceptable outcome, not a failure"
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /acceptable outcome, not a failure/);
  });

  it("includes at least two bad-example and one good-example contrast", () => {
    const matchAll = (re: RegExp): number => {
      const matches = SEND_QUESTIONS_INSTRUCTIONS.match(re);
      return matches ? matches.length : 0;
    };
    assert.ok(matchAll(/❌/g) >= 2, "expected at least 2 bad-example bullets");
    assert.ok(matchAll(/✅/g) >= 1, "expected at least 1 good-example bullet");
  });

  it("is referenced from every per-path SAVE step", () => {
    // Each of the three paths references the gate by name.
    const refs = SEND_QUESTIONS_INSTRUCTIONS.match(/apply the HINT DRAFTING GATE/g);
    assert.ok(
      refs !== null && refs.length >= 3,
      "expected ≥3 references (boolean/choice/freeform)",
    );
  });

  it("each per-path SAVE call lists `hint` as an optional field", () => {
    const hintFieldMentions = SEND_QUESTIONS_INSTRUCTIONS.match(
      /hint \(only when the HINT DRAFTING GATE produced one/g,
    );
    assert.ok(
      hintFieldMentions !== null && hintFieldMentions.length >= 3,
      "expected ≥3 mentions of `hint` as an optional save_question field",
    );
  });
});

describe("SEND_QUESTIONS_INSTRUCTIONS — EMOJI SELECTION GATE", () => {
  it("defines the gate once with the non-spoiler constraint", () => {
    const defs = SEND_QUESTIONS_INSTRUCTIONS.match(
      /EMOJI SELECTION GATE \(shared across all paths/g,
    );
    assert.ok(defs !== null && defs.length === 1, "expected exactly one gate definition");
    // anchors emojis to the category, not the answer
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /decorate the CATEGORY/);
    // forbids answer-revealing emojis (the flag spoiler is the canonical example)
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /SPOILER/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /🇪🇨/);
  });

  it("is referenced by every generation path (3 text + 3 visual)", () => {
    const refs = SEND_QUESTIONS_INSTRUCTIONS.match(/apply the EMOJI SELECTION GATE/g);
    assert.ok(
      refs !== null && refs.length >= 6,
      "expected ≥6 references (fact boolean/choice/freeform + visual boolean/choice/freeform)",
    );
  });

  it("leaves the visual paths' media.altText non-spoiler wording intact", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /not "the flag of Ecuador"/);
  });
});

describe("PUZZLE QUALITY GATE", () => {
  for (const [name, prompt] of [
    ["SEND", SEND_QUESTIONS_INSTRUCTIONS],
    ["PREP", PREP_QUESTIONS_INSTRUCTIONS],
    ["POST", POST_QUESTIONS_INSTRUCTIONS],
  ] as const) {
    it(`${name}: defines the gate exactly once`, () => {
      const defs = prompt.match(/PUZZLE QUALITY GATE \(shared across all paths/g);
      assert.ok(defs !== null && defs.length === 1, "expected exactly one gate definition");
    });

    it(`${name}: is referenced before save by all six path bodies`, () => {
      const refs = prompt.match(/apply the PUZZLE QUALITY GATE/g);
      assert.ok(
        refs !== null && refs.length >= 6,
        "expected ≥6 references (text + visual boolean/choice/freeform)",
      );
    });
  }

  it("mandates explicit reasoning and prefers re-roll over shipping weak", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /REASON about the question as a puzzle/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /don't just assert "pass/i);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /re-rolling beats shipping a weak question/i);
  });

  it("absorbs the year/date principle with a worked example", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /SOLVABLE BY KNOWING, NOT GUESSING/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /Berlin Wall fell during the Reagan administration/);
    // the year/date principle lives in the gate, not in standalone per-path blocks
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /AVOID YEAR\/DATE ANCHORING/);
    assert.doesNotMatch(SEND_QUESTIONS_INSTRUCTIONS, /AVOID YEAR\/DATE QUESTIONS/);
  });

  it("names the per-format surface-tell manifestations", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /NO SURFACE TELL/);
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /read equally plausible/i);
  });

  it("defers flavor-leak enforcement to the existing NO-SPOILER GATE (no duplicate prose)", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /FLAVOR NEVER LEAKS[\s\S]*?NO-SPOILER GATE/);
  });
});

describe("difficulty is doubt, not obscurity (boolean)", () => {
  it("boolean reframe dials plausibility, not obscurity", () => {
    assert.match(SEND_QUESTIONS_INSTRUCTIONS, /dial difficulty by PLAUSIBILITY, not obscurity/);
    assert.match(
      SEND_QUESTIONS_INSTRUCTIONS,
      /Do NOT raise boolean difficulty by reaching for a more obscure fact/,
    );
  });
});
