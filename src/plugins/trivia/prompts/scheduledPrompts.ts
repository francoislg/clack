/**
 * Prompt text returned by the plugin's scheduled-run instruction tools.
 * Each `*_INSTRUCTIONS` constant below is the full on-demand prompt that Claude
 * receives when the matching tool is invoked.
 */

/**
 * Reference line that replaces the previous inlined `GAME_SHOW_PERSONA` constant. The
 * persona, reveal tone, and season-finale tone now live in the `trivia` topic instructions
 * (registered by the plugin via `sdk.addTopicInstruction` — see `topicInstructions.ts`),
 * which are pre-attached by the trivia cron jobs and overrideable at
 * `data/configuration/user/topics/trivia/trivia__*.md`. See the `plugin-topic-instructions`
 * capability.
 */
const PERSONA_TOPIC_REFERENCE = `Your persona, reveal tone, and season-finale style are described in the \`trivia\` topic of your system instructions. Apply them throughout this run.`;

/**
 * Per-game scoping directive prepended to every scheduled-run prompt. `{game}` is
 * substituted with each cron spec's game name in `buildGameSpecs.ts`. The trivia
 * data is partitioned per game, so EVERY per-game tool call below MUST pass
 * `game: "<name>"` — otherwise the call fails Zod validation.
 *
 * The slug is also exposed at the top of the prompt as a literal so Claude can
 * always see which game it is operating on (useful for any logging/diagnostics
 * Claude might add to its responses, though end-user output never mentions it).
 */
const GAME_CONTEXT_DIRECTIVE = `GAME: {game}

This trivia run targets the game named \`{game}\`. Trivia data is partitioned per-game, so EVERY trivia tool call you make in the steps below MUST include \`game: "{game}"\` as an argument. Omitting the \`game\` argument or passing a slug that isn't \`"{game}"\` will fail validation and abort the call.

Do NOT mention the game slug to end-users in any reveal or post — it is internal coordination metadata.`;

/**
 * Optional context-priority preamble shared across all generation paths.
 * When `get_ideas` returns a `contextPriority` array, this guidance tells Claude
 * how to descend the lens list. It is irrelevant when contextPriority is absent.
 */
const CONTEXT_PRIORITY_PREAMBLE = `CONTEXTS (LENSES) — when get_ideas returns \`contextPriority: string[]\`:
   - The array is a freshly-rolled weighted-random ordering of every configured lens. Try \`contextPriority[0]\` FIRST — write the question with that lens as the angle/perspective.
   - Empty-string entries mean "no specific lean" — generate without applying a lens.
   - Only descend to \`contextPriority[1]\`, \`[2]\`, etc. when the current lens GENUINELY yields no usable question (e.g. for topical: no recent newsworthy event in that lens; for fact: nothing interesting at the intersection of category × lens). A reflexive descent defeats the purpose of weights.
   - When you write the question with a non-empty lens, pass \`context: "<the lens you used>"\` to \`save_question\` so the lens is recorded.
   - If you exhaust every entry in \`contextPriority\` without producing a usable question, re-call \`get_ideas\` to re-roll all the suggestions (fresh categories AND fresh contextPriority).
   - When the get_ideas response does NOT include \`contextPriority\`, ignore lens handling entirely and pass no \`context\` arg to \`save_question\`.`;

/**
 * Shared step sequence for generating a new FACT-typed boolean trivia question.
 * Used by the scheduled question-posting prompt; kept as a single source so
 * future flows (e.g. an on-demand user-triggered generation) can compose from it.
 */
const QUESTION_FLOW_STEPS = `1. GET CATEGORY IDEAS AND SUGGESTIONS:
   - Call get_ideas. It returns:
     - categories.ideas: 5 random categories (excludes the last 10 used).
     - suggestedAnswer (boolean): the truth value the final statement MUST have.
     - suggestedDifficulty ("Easy" | "Medium" | "Hard"): the bucket to aim at.
     - suggestedDifficultyRange ([min, max]): the inclusive 1–10 STRICT accept range for that bucket on THIS game type. Your self-rating at step 6 MUST land inside this range; ±1 off triggers a one-shot reframe; ≥2 off triggers immediate re-roll.
     - contextPriority (optional, only when contexts are configured): see CONTEXTS guidance above.
   - Pick one category from categories.ideas.
   - Read suggestedAnswer and suggestedDifficulty — both steer the next steps.

2. WRITE A STATEMENT WITH THE CORRECT POLARITY FROM THE START. Branch on suggestedAnswer — do NOT write a true statement and try to flip it later, because that retrofit consistently fails and biases output toward true:

   - If suggestedAnswer is TRUE: research a verified true fact about the topic and state it directly. The statement must be actually true.
   - If suggestedAnswer is FALSE: write a plausible-sounding FALSE statement about the topic from the start. Pick one of these angles:
     a) A common misconception people believe but is wrong (e.g. "Humans only use 10% of their brain").
     b) A confidently-stated claim that is contradicted by the actual record (e.g. wrong inventor, wrong location, wrong superlative).
     c) A real fact with one key detail swapped to something incorrect (e.g. "shrimp" → "lobster", "Stockholm" → "Oslo"). The underlying real fact must remain a real fact — only the surfaced statement is wrong.
     Do not start from a true fact and ask "how do I flip this?" — start from "what false-but-plausible statement can I write about this topic?"

   AVOID YEAR/DATE ANCHORING (HARD CONSTRAINT). Don't make the truth value hinge on a specific year, exact date, or numeric quantity that players can't reasonably verify — that turns the question into a memorization test rather than a thinking test. Concretely:
     - DON'T: "The Berlin Wall fell in 1989." / "Mount Tambora erupted in 1815." — answering correctly just means remembering a number, and a knowledgeable player can't tell whether the year is right.
     - DO: "The Berlin Wall fell during the Reagan administration." / "Mount Tambora's eruption caused a worldwide volcanic winter the following year." — the truth value hinges on something verifiable from understanding.
     - When you DO need to swap a number to make a FALSE statement, swap the WHAT (the agent, the mechanism, the location, the consequence), NOT the WHEN. Year-swap distractors ("1969" → "1971") are forbidden.
     - Year context is fine as flavor when the year is famous in its own right (1969 moon landing, 1989 Berlin Wall, 2008 financial crisis) — but the truth value still must NOT hinge on the year being correct.

   Aim at the inclusive 1-10 range from \`suggestedDifficultyRange\` (the bucket's target band on THIS game type — freeform's bands are softer than boolean/choice's). You will self-rate against the same 1-10 scale in step 6.

   Do NOT randomize the polarity yourself; the random pick has already been made server-side.

3. POLARITY SELF-CHECK (REQUIRED GATE — DO NOT SKIP):
   State the following explicitly to yourself before continuing:
   - "suggestedAnswer was: <true | false>"
   - "My statement asserts something that is actually: <true | false>"
   - "Do these match? <yes | no>"

   If the answer is "no" — stop, return to step 2, and rewrite the statement with the correct polarity. Do NOT try to patch it with a small edit; rewrite. Only proceed to step 4 once the polarities match.

4. CHECK FOR DUPLICATES:
   - Call find_previous_questions to search for similar statements.
   - If a match is found, go back to step 2 and try a different statement.
   - Keep iterating until you have a truly unique statement.

5. VALIDATE through research that the statement's actual truth matches suggestedAnswer (true → actually true; false → actually false). If validation reveals a mismatch (e.g. a "false" statement turned out to be accidentally true, or vice versa), return to step 2 and rewrite — do not patch.

6. DIFFICULTY RATING (REQUIRED GATE — STRICT MEMBERSHIP):
   Self-rate the question on the 1-10 scale. The ACCEPT RANGE is \`suggestedDifficultyRange\` \`[min, max]\` (the range get_ideas returned for THIS game type's bucket). The bucket's range IS the accept bound — there is no separate threshold.

   Apply EXACTLY these three rules:

   a) If your rating is INSIDE \`[min, max]\` (inclusive) → proceed to step 7.

   b) If your rating is EXACTLY \`min - 1\` or \`max + 1\` (one point off the range, above or below) → REFRAME ONCE:
      - Rewrite the question to dial difficulty toward the range. Concrete levers:
        - Too easy (rating below): swap a famous name/place for a less-iconic one; demand a mechanism or consequence rather than the headline fact; pick a more obscure detail of the same topic.
        - Too hard (rating above): pick a more iconic example of the same category; lean on a famous date/place/person; state the consequence rather than the cause.
      - IMMEDIATELY re-run the POLARITY SELF-CHECK (step 3) on the reframed statement before re-rating. Reframing-by-detail-swap can silently flip a TRUE statement to FALSE — the polarity gate is what catches this. If polarity fails on the reframe, REJECT and re-call get_ideas (don't try a second reframe; you've burned your retry).
      - If polarity passes, re-rate the new version on the same 1–10 scale INDEPENDENTLY of the prior rating (don't anchor on "I made it easier so it must now be inside the range" — judge v2 fresh).
      - If the new rating is INSIDE \`[min, max]\` → proceed to step 7.
      - If the new rating is STILL OUTSIDE the range (anywhere outside, not just ≥2 off) → REJECT and re-call get_ideas for a fresh roll. Do NOT reframe a second time.

   c) If your rating is TWO OR MORE points outside \`[min, max]\` (either direction) → REJECT immediately and re-call get_ideas for a fresh roll. Do NOT reframe — the topic is wrong, not the framing. Reframing a question rated 3 to fit a Hard bucket [8,10] produces forced, awkward questions.

   ONLY PROCEED TO STEP 7 when the rating (v1 or v2 after one reframe) lies inside \`[min, max]\`.

7. Choose fun emojis that relate to the topic.

8. SAVE TO DATABASE:
   - Call save_question with:
     - answersFormat: "boolean"
     - questionType: "fact"
     - category (the one you picked from get_ideas)
     - statement (your trivia statement)
     - isTrue (boolean)
     - emojis (array of emoji strings)
     - suggestedDifficulty (the bucket from get_ideas in step 1)
     - difficulty (your 1–10 self-rating from step 6)
     - context (only when a non-empty contextPriority entry was used; omit otherwise)
     - slot: \`{ index: i }\` — REQUIRED when the active season has a format (the get_ideas response will carry \`format: { slotCount, slots: [...] }\` then). MUST be OMITTED when format is null.
   - Store the returned questionId AND its slot.index for the post step.`;

const CHOICE_FLOW_STEPS = `1. GET CATEGORY IDEAS AND SUGGESTIONS:
   - Call get_ideas. For the CHOICE PATH, it returns:
     - categories.ideas: 5 random categories (excludes the last 10 used).
     - suggestedAnswersFormat: "choice"
     - suggestedChoiceCount (integer): the number of options the question MUST have.
     - suggestedCorrectIndex (integer in [0, suggestedChoiceCount)): the 0-based index where the correct answer MUST be placed.
     - suggestedDifficulty ("Easy" | "Medium" | "Hard"): the bucket to aim at.
     - suggestedDifficultyRange ([min, max]): the strict 1–10 accept range for that bucket on THIS game type. Used at step 5.
     - contextPriority (optional, only when contexts are configured): see CONTEXTS guidance above.
   - Pick one category from categories.ideas.

2. WRITE THE CORRECT ANSWER FIRST (REQUIRED — NEVER SHIFT THE CORRECT POSITION):
   - Research a verified true fact about the topic and write the correct option text FIRST. This option will occupy the index named by suggestedCorrectIndex. The correct answer's POSITION is LOCKED — you MUST NOT rewrite or swap the correct answer later to fix a gate failure, because that defeats the server-rolled suggestedCorrectIndex (which is what keeps the leaderboard fair).
   - Then write (suggestedChoiceCount − 1) plausible-but-wrong distractors. Each distractor should be a confident-sounding but incorrect option a knowledgeable person could be tempted by — not joke filler.

   AVOID YEAR/DATE QUESTIONS (HARD CONSTRAINT). Don't write questions whose options are all years, exact dates, or close numeric values that players can't reasonably distinguish (e.g. "In what year did X happen? A) 1972 B) 1976 C) 1980"). That's a memory test, not a thinking test. Concretely:
     - DON'T: questions where all options are years/dates, OR where the correct answer is a year/date the player can't reason their way to.
     - DO: questions where the options are WHAT (people, places, events, mechanisms, causes, outcomes) — things players can reason about.
     - If the topic naturally suggests a date question ("when did X happen?"), reframe to WHAT happened, WHO did it, WHERE it happened, or WHY it mattered.
     - This rule overrides "use what you researched" — if your research only surfaces date-anchored facts about this category, re-call \`get_ideas\` for a different category rather than writing a year question.

3. DISTRACTOR PLAUSIBILITY GATE (REQUIRED — DO NOT SKIP):
   Rate each option (correct + every distractor) 1–10 on "how plausible does this sound as the correct answer to someone who doesn't know the topic" (NOT "how true is it"). Apply ALL FOUR conditions:
   - (a) correct answer plausibility ≥ 5 — it must be defensible (a correct answer that scores 3/10 plausibility is one no one would even consider).
   - (b) highest distractor plausibility ≥ 4 — at least one real trap (otherwise the question is trivial).
   - (c) correct − highest_distractor ≤ 4 — the gap is small enough that distractors compete (otherwise the correct answer is a giveaway).
   - (d) every distractor plausibility ≥ 2 — no obvious joke filler.

   If ANY condition fails, REWRITE ONLY THE FAILING DISTRACTOR(S), never the correct answer. Repeat the gate. Retry budget: 3 distractor-rewrite passes per question. If the gate still fails after 3 passes, ABANDON this question and re-roll from get_ideas with a fresh suggestedCorrectIndex.

4. CHECK FOR DUPLICATES:
   - Call find_previous_questions with a distinctive keyword from the statement (a name, a number, or a rare noun).
   - If a match is found, go back to step 2 and write a different question.

5. DIFFICULTY GATE (REQUIRED — STRICT MEMBERSHIP):
   Self-rate the question as a whole on the 1–10 scale. The ACCEPT RANGE is \`suggestedDifficultyRange\` \`[min, max]\` from get_ideas. The bucket's range IS the accept bound — there is no separate threshold.

   - Rating INSIDE \`[min, max]\` → proceed.
   - Rating EXACTLY \`min - 1\` or \`max + 1\` → REFRAME ONCE: rewrite the question to dial difficulty toward the range (swap iconic↔obscure example, demand mechanism vs. headline fact, etc.). The correct answer's POSITION is still LOCKED at \`suggestedCorrectIndex\` — only rewrite the question text or the distractors, never move the correct answer. Re-rate v2 independently. If v2 lands inside \`[min, max]\` → proceed. If still outside → REJECT and re-call get_ideas (don't reframe twice).
   - Rating TWO OR MORE points outside \`[min, max]\` (either direction) → REJECT immediately and re-call get_ideas. Don't reframe — the topic is wrong, not the framing.

6. Choose 1-4 fun emojis that relate to the topic.

7. SAVE TO DATABASE:
   - Call save_question with:
     - answersFormat: "choice"
     - questionType: "fact"
     - category (the one you picked from get_ideas)
     - statement (a single-sentence question prompt — what is being asked)
     - choices (array of suggestedChoiceCount strings — the correct answer at suggestedCorrectIndex, distractors at the other positions)
     - correctIndex (MUST equal suggestedCorrectIndex)
     - emojis (array of 1-4 emoji strings)
     - suggestedDifficulty (the bucket from get_ideas in step 1)
     - difficulty (your 1–10 self-rating from step 5)
     - context (only when a non-empty contextPriority entry was used; omit otherwise)
     - slot: \`{ index: i }\` — REQUIRED when the active season has a format. MUST be OMITTED when format is null.
   - Store the returned questionId AND its slot.index for the post step.`;

/**
 * Topical-boolean flow: prefixes a WebSearch research step in front of the
 * fact-boolean gates. The polarity / duplicate-check / difficulty / save gates
 * are otherwise identical, but `save_question` carries `questionType: "topical"`
 * + the captured `sourceUrl` (and optional `eventDate`).
 */
const TOPICAL_BOOLEAN_FLOW_STEPS = `1. GET CATEGORY IDEAS AND SUGGESTIONS:
   - Call get_ideas. For the TOPICAL BOOLEAN PATH, it returns:
     - categories.ideas: 5 random categories.
     - suggestedAnswersFormat: "boolean"
     - suggestedQuestionType: "topical"
     - suggestedAnswer (boolean): the truth value the final statement MUST have.
     - suggestedDifficulty ("Easy" | "Medium" | "Hard"): the bucket to aim at.
     - suggestedDifficultyRange ([min, max]): the strict 1–10 accept range for the rolled bucket on THIS game type — used at step 6.
     - contextPriority (optional, only when contexts are configured): see CONTEXTS guidance above.
   - Pick one category from categories.ideas.

2. RESEARCH A RECENT EVENT VIA WebSearch (REQUIRED — DO NOT SKIP):
   - Compose a WebSearch query that combines the chosen category, the chosen lens from contextPriority[0] (if applicable), and a recency hint (e.g. "this week", "yesterday", "last few days", a recent year).
   - Aim for events from the last day or two. Go back further (up to a week) only if nothing notable surfaced from the most recent days.
   - Pick ONE specific newsworthy event from the results to anchor the question on. Capture:
     - sourceUrl: the most authoritative URL that supports the claim (must begin with https://).
     - eventDate (optional but encouraged): the ISO 8601 date (YYYY-MM-DD) the event occurred, when easy to determine.
   - If the current lens (contextPriority[0]) yielded no usable event, descend per the CONTEXTS guidance. If every lens fails, re-call get_ideas.

3. WRITE A STATEMENT WITH THE CORRECT POLARITY FROM THE START:
   Branch on suggestedAnswer — do NOT write a true statement and try to flip it later.
   - If suggestedAnswer is TRUE: state a verified true fact drawn from the event.
   - If suggestedAnswer is FALSE: write a plausible-sounding FALSE statement about the event — swap a date, a name, a place, or a number to something subtly incorrect; or assert a tempting misconception about the event that is contradicted by the actual reporting.
   Aim inside \`suggestedDifficultyRange\` (the inclusive 1–10 band get_ideas returned for THIS game type's bucket).

4. POLARITY SELF-CHECK (REQUIRED GATE):
   - "suggestedAnswer was: <true | false>"
   - "My statement asserts something that is actually: <true | false>"
   - "Do these match? <yes | no>"
   If "no", rewrite the statement from step 3.

5. CHECK FOR DUPLICATES:
   - Call find_previous_questions with a distinctive keyword from the statement.
   - If the same event was already asked about (even with different polarity or angle), pick a different event from your WebSearch results (or re-search).

6. DIFFICULTY GATE (REQUIRED — STRICT MEMBERSHIP): same rules as the fact-boolean path. Rating INSIDE \`suggestedDifficultyRange\` → proceed; ±1 off → reframe ONCE (then re-run polarity self-check on the reframed statement before re-rating); ≥2 off OR reframe still outside → REJECT and re-call get_ideas.

7. Choose 1-4 fun emojis related to the event/topic.

8. SAVE TO DATABASE:
   - Call save_question with:
     - answersFormat: "boolean"
     - questionType: "topical"
     - category (from get_ideas)
     - statement (your trivia statement)
     - isTrue (boolean)
     - sourceUrl (REQUIRED — the https:// URL you captured in step 2)
     - eventDate (when known — YYYY-MM-DD)
     - emojis
     - suggestedDifficulty
     - difficulty (your self-rating)
     - context (the lens you used, when non-empty)
     - slot: \`{ index: i }\` — REQUIRED when the active season has a format. MUST be OMITTED when format is null.
   - Store the returned questionId AND its slot.index for the post step.`;

/**
 * Topical-choice flow: prefixes a WebSearch research step in front of the
 * fact-choice distractor / difficulty gates.
 */
const TOPICAL_CHOICE_FLOW_STEPS = `1. GET CATEGORY IDEAS AND SUGGESTIONS:
   - Call get_ideas. For the TOPICAL CHOICE PATH, it returns:
     - categories.ideas: 5 random categories.
     - suggestedAnswersFormat: "choice"
     - suggestedQuestionType: "topical"
     - suggestedChoiceCount (integer): the number of options the question MUST have.
     - suggestedCorrectIndex (integer in [0, suggestedChoiceCount)): the index where the correct answer MUST be placed.
     - suggestedDifficulty ("Easy" | "Medium" | "Hard"): the bucket to aim at.
     - suggestedDifficultyRange ([min, max]): the strict 1–10 accept range for the rolled bucket on THIS game type — used at step 6.
     - contextPriority (optional, only when contexts are configured): see CONTEXTS guidance above.
   - Pick one category from categories.ideas.

2. RESEARCH A RECENT EVENT VIA WebSearch (REQUIRED — DO NOT SKIP):
   - Same WebSearch + lens-descent rules as the topical boolean path. Capture sourceUrl and (when known) eventDate from the chosen event.

3. WRITE THE CORRECT ANSWER FIRST (REQUIRED — NEVER SHIFT THE CORRECT POSITION):
   - Anchor the correct option on a verified fact drawn from the event. This option occupies suggestedCorrectIndex.
   - Write (suggestedChoiceCount − 1) plausible distractors — confident-sounding wrong options drawn from the same news domain (e.g. other people in the story, other recent similar events, related-but-wrong dates/places/numbers).

4. DISTRACTOR PLAUSIBILITY GATE (REQUIRED): same four-condition rule as the fact-choice path. Rewrite only failing distractors, never the correct answer. 3-pass retry budget; otherwise re-roll from get_ideas.

5. CHECK FOR DUPLICATES: same as topical boolean path.

6. DIFFICULTY GATE (REQUIRED — STRICT MEMBERSHIP): same rules as the fact-choice path. Rating INSIDE \`suggestedDifficultyRange\` → proceed; ±1 off → reframe ONCE (correct-answer position stays locked at \`suggestedCorrectIndex\` during reframe — only the question text or distractors change); ≥2 off OR reframe still outside → REJECT and re-call get_ideas.

7. Choose 1-4 fun emojis.

8. SAVE TO DATABASE:
   - Call save_question with:
     - answersFormat: "choice"
     - questionType: "topical"
     - category
     - statement (single-sentence question prompt)
     - choices (array; correct answer at suggestedCorrectIndex)
     - correctIndex (MUST equal suggestedCorrectIndex)
     - sourceUrl (REQUIRED)
     - eventDate (when known)
     - emojis
     - suggestedDifficulty
     - difficulty
     - context (the lens you used, when non-empty)
     - slot: \`{ index: i }\` — REQUIRED when the active season has a format.
   - Store the returned questionId for the post step.`;

/**
 * Fact-freeform flow: Claude writes a statement plus a canonical expectedAnswer.
 * Optionally enumerates acceptableAnswers (variants) and gradingNotes. The
 * reveal-time judge (a small fast model) scores user-typed answers against
 * these fields. The card posts with an "Answer" button (added by post_questions
 * automatically) — Claude does NOT add the button itself.
 */
const FREEFORM_FACT_FLOW_STEPS = `1. GET CATEGORY IDEAS AND SUGGESTIONS:
   - Call get_ideas. For the FACT FREEFORM PATH, it returns:
     - categories.ideas: 5 random categories.
     - suggestedAnswersFormat: "freeform"
     - suggestedQuestionType: "fact"
     - suggestedFreeformAnswerShape: one of "name" | "place" | "phrase" | "title" | "date" | "countable" | "other" — the SHAPE the answer must take. Non-negotiable.
     - suggestedDifficulty ("Easy" | "Medium" | "Hard"): the bucket to aim at.
     - suggestedDifficultyRange ([min, max]): the strict 1–10 accept range for the rolled bucket on THIS game type (freeform's bands are softer than boolean/choice's) — used at step 7.
     - contextPriority (optional, only when contexts are configured): see CONTEXTS guidance above.
   - Pick one category from categories.ideas.

2. WRITE THE QUESTION (REQUIRED — SHORT, UNAMBIGUOUS):
   - Write a single-sentence prompt that has ONE clearly correct answer when read literally.
   - The answer MUST match suggestedFreeformAnswerShape:
     - "name" → the proper noun of a person, character, brand, organization, animal species, etc.
     - "place" → a city, country, region, landmark, geographical feature, planet, or fictional location.
     - "phrase" → a quote, idiom, motto, slogan, line of dialogue, common saying.
     - "title" → the name of a creative work — a movie, book, song, album, TV show, video game, play, painting.
     - "date" → a TIME PERIOD only. NEVER a specific calendar date (month + day, or full YYYY-MM-DD — those are intrinsically impossible to recall and feel like a memory test, not trivia). Choose the granularity that matches the era:
       - "year" — only when the year itself is famous in its own right (e.g. 1969 moon landing, 1989 Berlin Wall, 2008 financial crisis). If a knowledgeable person couldn't name the exact year unprompted, use decade instead.
       - "decade" — the default for 20th-century or earlier events that aren't year-famous. NOT for events of the last ~30 years (those feel too recent to need decade granularity). DECADE-BOUNDARY CHECK: before choosing decade, verify the event sits cleanly inside ONE decade. If it spans two (e.g. an academic tenure from 1898 to 1907 spans both the 1890s AND the 1900s), either (a) anchor the question on a single year-famous moment within the span (e.g. "the year Rutherford published his transmutation paper" → 1902 with ±5 leeway, switching to "year" granularity), or (b) keep the decade granularity but list EVERY spanned decade in \`acceptableAnswers\` (e.g. \`["1890s", "1900s", "1890-1899", "1900-1909"]\`) and restate the absolute range covering the whole span in \`gradingNotes\`. NEVER ship a decade question whose answer arbitrarily picks one of two equally-valid decades.
       - "era / century / millennium" — reserved for historical questions (pre-1900 / pre-1500 respectively). Don't use these for modern history.
     - "countable" → a small integer answer where the count is well-known, derivable, or a fixed convention. NOT arbitrary statistics from articles or research findings — those are memorization tests of a specific datum, not derivable knowledge. If your answer requires citing a recent figure, you picked the wrong shape.
     - "other" → an unconventional answer shape that doesn't fit any of the categories above. Reach for something Claude wouldn't pick by default — e.g. a chemical formula, a sports score, a paired outcome, a measurement with non-standard units, a color, a currency amount, an acronym treated as the answer itself, a velocity, an emoji-based response. Must still be a short, unambiguous value with one canonical form.
   - The question should NOT be answerable with just yes/no — that's the boolean path.
   - Aim for 1-4 word answers (1-30 characters).
   - LEEWAY:
     - For \`date\` shape: MANDATORY. Always state the accepted tolerance EXPLICITLY in the question itself — never expect exact recall. Defaults: "year" → "(within 5 years)" on Easy/Medium, "(within 2 years)" on Hard; "decade" → "(to the nearest decade)"; "century" / "millennium" → no leeway suffix needed (the granularity IS the tolerance). Set \`gradingNotes\` to restate the absolute range anchored on \`expectedAnswer\` (e.g. "Accept any year in [1964, 1974] (±5 of 1969)." or "Accept any year in [1900, 1909], typed as a bare year or decade form."). Players are NEVER expected to match the format — only the value. The judge already accepts bare years for decade questions, but spelling it out here makes intent unambiguous.
     - For \`countable\` shape: relevant when exact recall is unrealistic — same tolerance pattern as date ("(±10 km)", "(within 100)"). Skip when the answer is small and exact (e.g. "How many sides does a hexagon have?").
     - For "name" / "place" / "phrase" / "title" / "other" shapes: SKIP — the judge handles capitalization, punctuation, and reasonable variants automatically.

3. WRITE THE EXPECTED ANSWER (REQUIRED — CANONICAL FORM ONLY):
   - This is the shortest 100%-perfect answer you would accept. Trim it: no articles ("the"), no qualifiers ("the city of"), no punctuation noise. The judge handles capitalization, punctuation, and reasonable variants automatically.
   - Max 200 characters; aim for far less.

4. OPTIONAL: ENUMERATE ACCEPTABLE VARIANTS:
   - When the canonical answer has well-known alternate forms ("USA" vs "United States", "JFK" vs "John F. Kennedy"), list them in \`acceptableAnswers\`. The judge accepts these as equivalent.
   - Omit \`acceptableAnswers\` when the canonical form is the only reasonable one.

5. OPTIONAL: GRADING NOTES:
   - Use this when the answer is conceptually-flexible — "Accept any major Canadian city" / "Accept 'JFK' or 'John Kennedy' as variants of 'John F. Kennedy'" / etc. One short sentence.
   - Notes refine the judge; they do NOT override the expected answer. Omit when not needed.
   - REQUIRED when step 2 stated a date/number tolerance (always required for \`date\` shape — see LEEWAY above): restate the EXACT tolerance here in absolute terms anchored on \`expectedAnswer\` — e.g. "Accept any year in [1939, 1949] (±5 of 1944)." The judge follows this strictly, so be precise.

6. DUPLICATE CHECK:
   - Call \`find_previous_questions\` with a distinctive keyword from the statement.
   - If a match is found, go back to step 2.

7. DIFFICULTY GATE (REQUIRED — STRICT MEMBERSHIP):
   Self-rate 1–10. The ACCEPT RANGE is \`suggestedDifficultyRange\` \`[min, max]\` from get_ideas (freeform bands sit lower than boolean/choice — a freeform "Hard" might be [7, 8], not [9, 10]). The bucket's range IS the accept bound.

   - Rating INSIDE \`[min, max]\` → proceed.
   - Rating EXACTLY \`min - 1\` or \`max + 1\` → REFRAME ONCE (rewrite the question to dial difficulty toward the range; the canonical \`expectedAnswer\` may also need updating if you change the question). Re-rate v2 independently. INSIDE → proceed; still outside → REJECT and re-call get_ideas.
   - Rating ≥2 off (either direction) → REJECT immediately and re-call get_ideas.

8. Choose 1-4 fun emojis.

9. SAVE TO DATABASE:
   - Call save_question with:
     - answersFormat: "freeform"
     - questionType: "fact"
     - category (the one you picked)
     - statement (the single-sentence prompt)
     - expectedAnswer (REQUIRED — canonical form)
     - acceptableAnswers (optional — array of variants)
     - gradingNotes (optional — one sentence)
     - freeformAnswerShape (REQUIRED — pass through the value from get_ideas' suggestedFreeformAnswerShape, verbatim)
     - emojis (1-4)
     - suggestedDifficulty
     - difficulty (your 1–10 self-rating)
     - context (only when a non-empty contextPriority entry was used; omit otherwise)
     - slot: \`{ index: i }\` — REQUIRED when the active season has a format. MUST be OMITTED when format is null.
   - Store the returned questionId AND its slot.index for the post step.`;

/**
 * Topical-freeform flow: prefixes a WebSearch research step in front of the
 * fact-freeform completion. \`save_question\` carries \`questionType: "topical"\`
 * + the captured \`sourceUrl\` (and optional \`eventDate\`).
 */
const FREEFORM_TOPICAL_FLOW_STEPS = `1. GET CATEGORY IDEAS AND SUGGESTIONS:
   - Call get_ideas. For the TOPICAL FREEFORM PATH, it returns:
     - categories.ideas: 5 random categories.
     - suggestedAnswersFormat: "freeform"
     - suggestedQuestionType: "topical"
     - suggestedFreeformAnswerShape: one of "name" | "place" | "phrase" | "title" | "date" | "countable" | "other" — see fact-freeform path for per-shape descriptions. Non-negotiable.
     - suggestedDifficulty ("Easy" | "Medium" | "Hard"): the bucket to aim at.
     - suggestedDifficultyRange ([min, max]): the strict 1–10 accept range for the rolled bucket on THIS game type (freeform's bands are softer than boolean/choice's) — used at step 7.
     - contextPriority (optional, only when contexts are configured): see CONTEXTS guidance above.
   - Pick one category from categories.ideas.

2. RESEARCH A RECENT EVENT VIA WebSearch (REQUIRED — DO NOT SKIP):
   - Same WebSearch + lens-descent rules as the topical boolean / topical choice paths. Capture \`sourceUrl\` and (when known) \`eventDate\` from the chosen event.

3. WRITE THE QUESTION:
   - Anchor a single-sentence prompt on a verified fact drawn from the event. The answer must match suggestedFreeformAnswerShape (see fact-freeform step 2). LEEWAY applies only to "date" / "countable" shapes; skip for "name" / "place" / "phrase".

4. WRITE THE EXPECTED ANSWER (REQUIRED): shortest canonical form, max 200 chars.

5. OPTIONAL: ENUMERATE ACCEPTABLE VARIANTS / GRADING NOTES: as in the fact-freeform path.

6. DUPLICATE CHECK: same as fact-freeform.

7. DIFFICULTY GATE: same as fact-freeform.

8. Choose 1-4 fun emojis.

9. SAVE TO DATABASE:
   - Call save_question with:
     - answersFormat: "freeform"
     - questionType: "topical"
     - category
     - statement
     - expectedAnswer (REQUIRED)
     - acceptableAnswers (optional)
     - gradingNotes (optional)
     - freeformAnswerShape (REQUIRED — pass through the value from get_ideas' suggestedFreeformAnswerShape, verbatim)
     - sourceUrl (REQUIRED — captured in step 2)
     - eventDate (when known)
     - emojis
     - suggestedDifficulty
     - difficulty
     - context (the lens you used, when non-empty)
     - slot: \`{ index: i }\` — REQUIRED when the active season has a format.
   - Store the returned questionId for the post step.`;

export const SEND_QUESTIONS_INSTRUCTIONS = `${PERSONA_TOPIC_REFERENCE}

${GAME_CONTEXT_DIRECTIVE}

Create today's trivia question(s). Begin with ONE call to \`get_ideas({ game: "{game}" })\` (no slot arg). Inspect the response's \`format\` field — it dispatches the OUTER flow:

- \`format: null\` → SINGLE-QUESTION FLOW. The active season has no format. Run the question-generation flow ONCE using this first \`get_ideas\` payload's \`suggestedAnswersFormat\` / \`suggestedQuestionType\` / \`suggestedAnswer\` / etc. Then format the question card and call \`post_questions\` with ONE item.

- \`format: { slotCount: N, slots: [...] }\` → MULTI-SLOT FLOW. The active season has a format with N slots. For \`i\` from 0 to N-1:
  1. Use the get_ideas payload that corresponds to slot \`i\`:
     - For \`i === 0\`: use the OPENING get_ideas payload (it rolled for slot 0 by default).
     - For \`i >= 1\`: make a FRESH \`get_ideas({ game: "{game}", slot: i })\` call. Do NOT reuse slot 0's rolls — each slot must roll its own. (Pre-rolling all suggestions up front is forbidden.)
  2. Read \`format.slots[i].label\` as a creative HINT for this slot's flavor (e.g. "Lightning Round", "Historical Choice") — set your tone for this slot, but do NOT copy the label literally into the question text.
  3. Run the question-generation flow below (6-way branch on \`suggestedAnswersFormat\` × \`suggestedQuestionType\`) for THIS slot.
  4. When saving, pass \`slot: { index: i }\` to \`save_question\`. Store the returned \`questionId\` paired with \`i\` for the post step.
  Repeat until all N slots have been generated and saved. Then build the question cards (one set of blocks per slot, in slot order) and call \`post_questions\` ONCE with an N-item \`items\` array.

${CONTEXT_PRIORITY_PREAMBLE}

In both flows, per-question/per-slot generation DISPATCHES on a 2-axis matrix: \`suggestedAnswersFormat\` × \`suggestedQuestionType\` — producing six paths:

| | \`suggestedAnswersFormat: "boolean"\` | \`suggestedAnswersFormat: "choice"\` | \`suggestedAnswersFormat: "freeform"\` |
|---|---|---|---|
| \`suggestedQuestionType: "fact"\` | FACT-BOOLEAN PATH | FACT-CHOICE PATH | FACT-FREEFORM PATH |
| \`suggestedQuestionType: "topical"\` | TOPICAL-BOOLEAN PATH (requires WebSearch + sourceUrl) | TOPICAL-CHOICE PATH (requires WebSearch + sourceUrl) | TOPICAL-FREEFORM PATH (requires WebSearch + sourceUrl) |

All three topical paths REQUIRE the \`WebSearch\` tool to find a recent newsworthy event, and pass the resulting source URL to \`save_question\`. The fact paths never call WebSearch.

The freeform paths produce an answer the user TYPES (into a Slack modal). Claude writes the canonical \`expectedAnswer\` and optional \`acceptableAnswers\` / \`gradingNotes\` at save time. A small fast model judges submissions at reveal — the judge automatically rejects multi-guess "shotgun" answers (e.g. "Paris or London") as incorrect, so the canonical answer must be a single concrete value.

Duplicate detection (find_previous_questions) stays GAME-SCOPED, not slot-scoped — a question that appeared in slot 0 yesterday is still a duplicate if it shows up in slot 2 today. Always call \`find_previous_questions\` with just \`game\` + text; do NOT filter by slot.

=== FACT-BOOLEAN PATH (per question / per slot) ===

${QUESTION_FLOW_STEPS}

=== FACT-CHOICE PATH (per question / per slot) ===

${CHOICE_FLOW_STEPS}

=== TOPICAL-BOOLEAN PATH (per question / per slot) ===

${TOPICAL_BOOLEAN_FLOW_STEPS}

=== TOPICAL-CHOICE PATH (per question / per slot) ===

${TOPICAL_CHOICE_FLOW_STEPS}

=== FACT-FREEFORM PATH (per question / per slot) ===

${FREEFORM_FACT_FLOW_STEPS}

=== TOPICAL-FREEFORM PATH (per question / per slot) ===

${FREEFORM_TOPICAL_FLOW_STEPS}

=== FORMAT & POST (BOTH FLOWS, BOTH PATHS) ===

NEW-SEASON OPENER (applies to BOTH outer flows, BEFORE building the per-question card blocks):

Inspect the OPENING \`get_ideas\` call's payload (the slot-0 call you already made — do NOT make a second call for this).

- If \`firstFireOfSeason === true\`: prepend TWO ceremonial Block Kit blocks to the FRONT of the message you will send to \`post_questions\` — they sit ABOVE everything described in step 9 (above the question's show banner / round opener), regardless of whether the outer flow is single-question or multi-slot. The opener appears ONCE per fire (not once per slot) and frames the entire batch as the new season's debut. The two blocks are:
  1. \`header\` block — \`text: { type: "plain_text", text: "..." }\`. plain_text only. The text MUST begin with the literal Unicode prefix \`🆕 NEW SEASON\` (use the 🆕 Unicode character directly — NEVER the \`:new:\` shortcode; shortcodes render as literal text in Slack header blocks). After the prefix you MAY append a short flourish — the season slug, the theme (when set), or a colon plus the theme in upper-case — but always keep the \`🆕 NEW SEASON\` lead.
  2. \`section\` block (mrkdwn) — one in-persona paragraph that:
     - Names the current season's slug verbatim (e.g. "season-2026-06") — the slug is the canonical identifier the leaderboard rows will display.
     - When AND ONLY WHEN the \`get_ideas\` payload includes a non-empty \`theme\` string, mentions that theme in one short line ("This month's theme: *Music Mayhem*."). Mention it verbatim — don't translate or re-phrase the theme.
     - When the payload has NO \`theme\` field, do NOT mention any theme: do NOT fabricate one, do NOT enumerate the season's categories as a stand-in, do NOT include a "no theme yet" disclaimer. Just let the section be about the new chapter starting, ending with energy that segues into the first question(s).

  Examples (both with and without theme):
  \`\`\`
  // With theme:
  [
    { "type": "header",  "text": { "type": "plain_text", "text": "🆕 NEW SEASON: HALLOWEEN SPOOKTACULAR" } },
    { "type": "section", "text": { "type": "mrkdwn", "text": "Welcome to *season-2026-10*, contestants! 🎃 This month's theme: *Halloween Spooktacular*. Boards reset, leaderboards back to zero — let's see who haunts the top spot. Onto today's question…" } },
    // …existing per-question blocks for the batch follow here…
  ]

  // Without theme:
  [
    { "type": "header",  "text": { "type": "plain_text", "text": "🆕 NEW SEASON KICKS OFF" } },
    { "type": "section", "text": { "type": "mrkdwn", "text": "Fresh chapter, fresh leaderboard — welcome to *season-2026-06*! Slates are wiped, scores are zero, and today's question gets us moving…" } },
    // …existing per-question blocks for the batch follow here…
  ]
  \`\`\`

- If \`firstFireOfSeason === false\` (or absent, or seasons are disabled): do NOT render any opener blocks at all. No header, no section, no placeholder — proceed straight to step 9 and build the message as usual. There is no fallback "mid-season hello" — the opener is reserved for the literal first fire of a season.

In MULTI-SLOT FLOW, the opener (when present) is prepended ONCE to the front of the items[0]'s \`blocks\` array — it does NOT repeat per slot. Each later slot's blocks start with their own normal show-banner header. Equivalently: the opener attaches to the first message of the batch, not to every message.

General emoji rule (re-emphasized): the opener's header MUST use Unicode emoji (🆕, 🎃, 🎲, 🏆) — never Slack shortcodes (\`:new:\`, \`:jack_o_lantern:\`). Shortcodes work in section/context bodies but render as literal text inside header blocks and table cells.

9. BUILD THE QUESTION CARD BLOCKS:
   Apply your persona from the \`trivia\` topic of your system instructions — add excitement, build anticipation, make it feel like a real game show moment.

   Compose a \`blocks\` array (Clack's curated subset: divider, header, section, context, image, markdown, card, carousel) — you'll hand it to \`post_questions\` in step 10. Do NOT include reactions in the blocks; the tool attaches them automatically based on the question's stored type. For the trivia question, use this FIVE-BLOCK layout — the structure stays fixed; the wording is where your persona lives:

   1. \`header\` block — \`text: { type: "plain_text", text: "..." }\`. plain_text only — no \`*bold*\`.
      - SINGLE-QUESTION FLOW, **and** every question after the first in MULTI-SLOT FLOW (slots 1..N-1): the show banner (e.g. "🎯 TRIVIA TIME!"). Vary the wording daily ("📣 STEP RIGHT UP!", "🎲 DAILY BRAIN TEASER", "🎯 TRIVIA TIME!", etc.).
      - MULTI-SLOT FLOW, FIRST question only (slot 0): a calmer date-stamped round opener that anchors today's round, e.g. "🗓️ Trivia for Wednesday, May 20", "📅 Trivia — May 20", "🎟️ Today's Trivia Round · May 20". Use today's actual date (weekday + month + day, OR month + day — your call). Keep it noticeably less shouty than the show banner; this is the "round header" for the batch, not the per-question hype line. Subsequent slots in the same batch go back to the normal show-banner style.
   2. \`section\` block (mrkdwn) — your warm-up patter. 1-2 short sentences that build anticipation. This is where the Game Show voice shines.
      - **TOPICAL QUESTIONS (questionType: "topical") MUST FLAG THEMSELVES.** The warm-up patter SHALL signal that this is a current-events / news question — e.g. "Hot off the presses!", "Straight from this week's headlines:", "Today in the news:", "If you've been doomscrolling lately, this one's for you:", "Ripped from yesterday's news:", etc. Do NOT use static-knowledge framings like "dig into your knowledge vault", "what you remember from school", "trivia masters take note", or anything implying memorized facts — those mislead viewers about what kind of question to expect. Pair the news framing with the same game-show energy. Vary the exact wording each day.
      - **NO YEAR / DATE STAMPS INSIDE THE TOPICAL STATEMENT.** The card's \`subtitle\` (\`Current News\`) and the patter already signal recency — so the statement itself MUST NOT include the current year ("in 2026"), an explicit month ("in May"), or phrases like "this week", "recently", "last month". Strip those even if the WebSearch result phrased the event that way. The recency context lives in the subtitle + patter, not in the statement. The optional \`eventDate\` field on \`save_question\` is where dates belong if Claude wants to record them — never in the user-visible statement.
      - **FACT QUESTIONS (questionType: "fact")** keep the standard knowledge-vault framing — that's the default voice.
   3. \`card\` block — the trivia card itself, holds JUST the question:
      - \`title\`: \`{ type: "mrkdwn", text: "<emoji> <Category>" }\` — JUST the category from step 1, with a topic-fitting emoji prefix. Same shape for BOTH fact and topical questions. No "TRIVIA TIME" here, no flavor text, no "(Current News)" suffix.
      - \`subtitle\`: TOPICAL questions ONLY (questionType: "topical") — \`{ type: "mrkdwn", text: "Current News" }\`. This is what tells viewers the question is anchored to a recent event. OMIT entirely on FACT questions.
      - \`body\`: \`{ type: "mrkdwn", text: "<statement>" }\` — JUST the statement. Do NOT include the TRUE/FALSE vote line, the choice options, or the freeform Answer-button nudge inside the card body — those all live in block #4 BELOW the card.
      - Do NOT set \`hero_image\` or \`icon\`.
   4. \`section\` block (mrkdwn) — the answer options, sitting BELOW the card. Shape depends on the question's answersFormat:
      - **boolean** → text is exactly \`👍 TRUE  •  👎 FALSE\`. ALWAYS 👍 (TRUE) first, then 👎 (FALSE) — this order matters.
      - **choice** → see CHOICE-PATH ANSWER OPTIONS below.
      - **freeform** → see FREEFORM-PATH ANSWER OPTIONS below.
   5. \`context\` block — a short closer line nudging people to vote ("Cast your vote below — the stakes are HIGH! 🎲", "Who will be crowned champion? 🏆", etc.). One mrkdwn element.

   NEVER predict when the answer will be revealed. Do NOT write phrases like "answer tomorrow", "results in 24 hours", "tune in later today", "we'll reveal soon", "stay tuned for tonight's reveal", or any other timing claim. The reveal is on a separate schedule that this run has no visibility into — guessing is wrong more often than it's right. Keep the closer focused on voting ("Cast your vote!", "Place your bets!", "Lock in your answer!") not on the reveal cadence.

   Invent a style for the header, warm-up patter, and closer each day — different each day keeps it fresh. Do NOT repeat yesterday's phrasing. Do NOT feel obligated to copy the example below. (Reminder: in MULTI-SLOT FLOW the slot-0 header is the date-stamped round opener described above, not a show banner.)

   Example — dramatic reveal (boolean FACT question):
   \`\`\`
   [
     { "type": "header", "text": { "type": "plain_text", "text": "🎯 TRIVIA TIME!" } },
     { "type": "section", "text": { "type": "mrkdwn", "text": "Alright contestants, gather 'round — today's brain teaser is a real head-scratcher. Let's see who's been paying attention! 🧠" } },
     {
       "type": "card",
       "title": { "type": "mrkdwn", "text": "🌍 Geography" },
       "body":  { "type": "mrkdwn", "text": "[statement]" }
     },
     { "type": "section", "text": { "type": "mrkdwn", "text": "👍 TRUE  •  👎 FALSE" } },
     { "type": "context", "elements": [ { "type": "mrkdwn", "text": "Cast your vote below — the stakes are HIGH! 🎲" } ] }
   ]
   \`\`\`

   For a TOPICAL question, the card also carries \`"subtitle": { "type": "mrkdwn", "text": "Current News" }\` between the title and body — everything else stays the same.

   Add game show flair to the header, patter, and closer — "Step right up!", "The stakes are high!", "Who will be crowned champion?", "Let's see who's got the smarts!" — make it entertaining, and feel free to come up with your own openers. The card itself stays clean: category title, statement + vote line in the body, nothing else.

   CHOICE-PATH ANSWER OPTIONS (when suggestedAnswersFormat was "choice"):
   - The card body holds JUST the statement (no inline options). Block #4 — the \`section\` sitting BELOW the card — holds the OPTIONS. Choose between two layouts for block #4 based on readability:
     - **Stacked** (preferred when any choice text exceeds roughly 25 characters or choices read more naturally on separate lines):
       \`\`\`
       1️⃣ <choice0>
       2️⃣ <choice1>
       3️⃣ <choice2>
       4️⃣ <choice3>
       \`\`\`
     - **Inline** (preferred when ALL choices are short):
       \`\`\`
       1️⃣ <choice0>  •  2️⃣ <choice1>  •  3️⃣ <choice2>  •  4️⃣ <choice3>
       \`\`\`
   - Numbered emoji prefix the options in INDEX order (1️⃣ for index 0, 2️⃣ for index 1, etc.). The visual order MUST match the stored \`choices\` array order — the bot's auto-attached numbered reactions align to each option's index, so a mismatch here breaks vote scoring.
   - For choice questions, do NOT include the "👍 TRUE • 👎 FALSE" vote line in block #4 — that's the boolean shape only.

   FREEFORM-PATH ANSWER OPTIONS (when suggestedAnswersFormat was "freeform"):
   - The card body holds JUST the statement. Block #4 — the \`section\` sitting BELOW the card — holds a one-line nudge to use the Answer button (no inline answer options, no vote line). \`post_questions\` automatically appends the "Answer" button below ALL your blocks — DO NOT add a button block yourself.
   - Block #4 example text:
     \`\`\`
     Hit the *Answer* button below to type your guess.
     \`\`\`
   - Reactions are NOT attached to freeform questions — answers come through the modal. Do not mention reaction voting in block #4 or the closer.

10. POST THE QUESTION(S):
    Build one \`{ questionId, blocks }\` item per saved question. In the SINGLE-QUESTION FLOW, that is exactly one item. In the MULTI-SLOT FLOW, the items array length equals \`slotCount\` and items MUST be in slot-index order (slot 0 first, slot 1 second, …).

    Call \`post_questions({ game: "{game}", items })\` ONCE with the full array. The tool:
    - Posts each item as its own message to the game's configured Slack channel (you do NOT pass a channel).
    - Stamps \`postedAt\` and \`messageLink\` on each question record so the reveal flow can find them later.
    - Attaches vote reactions automatically per question: \`["+1", "-1"]\` for boolean, \`["one", "two", "three", "four"].slice(0, choices.length)\` for choice, and NONE for freeform (those carry an Answer button instead). You do NOT pass a \`reactions\` argument.

    Check the \`results[i].ok\` field for each item in the return value. If any \`ok: false\`, the per-item error explains what went wrong.

    RETRY ON PARTIAL FAILURE: when one or more \`results[].ok === false\` come back from the call above (typical cause: Slack rejects one item's blocks with \`invalid_blocks\`), do NOT abandon the run. Build a follow-up \`post_questions\` call carrying ONLY the failed items (rebuild their blocks if the failure was due to oversized content), AND pass \`appendToPreviousBatch: true\`. That flag tells the tool to reuse the original call's \`batchId\` so the retried items reveal together with the original successes — without it the retry would land in a separate batch and the reveal would split across two cron fires. Do NOT instead try to thread a raw \`batchId\` string yourself; the flag is the only contract. The flag applies in BOTH the single-question and the multi-slot flow.

11. END THE RUN:
    Call \`submit_response({ skip_response: true })\` to terminate the run cleanly. No user-facing reply is needed — the trivia question itself is the deliverable.

The goal is to make people pause and think — aim for questions that are interesting and non-obvious, but not impossibly obscure. The exact target is \`suggestedDifficultyRange\` returned by get_ideas (the bucket's per-game-type band).`;

/**
 * Reveal-side prompt. A renderer brief, NOT an orchestration walkthrough.
 *
 * The deterministic work — finding the pending question, fetching reactions,
 * excluding the bot + cheaters + multi-react voters, scoring answers, fetching
 * the leaderboard, and (when seasons are enabled) running season rollover —
 * happens inside the `process_reveal_answers` MCP tool. The prompt's only
 * responsibilities are: (1) call that tool, (2) render the returned payload
 * via `submit_response` in the Game Show Presenter voice.
 *
 * Seasons-specific rendering is driven by the payload's `seasonStatus` field;
 * the prompt is identical regardless of `trivia.seasons.enabled`.
 */
export const PROCESS_REVEAL_INSTRUCTIONS = `${PERSONA_TOPIC_REFERENCE}

${GAME_CONTEXT_DIRECTIVE}

Deliver today's trivia reveal. There are exactly TWO steps — the deterministic work is done for you by \`process_reveal_answers\`; your job is to render the returned payload with charisma.

1. CALL \`process_reveal_answers({ game: "{game}" })\` AND READ THE PAYLOAD:

   The tool fetches the pending question's Slack message, excludes the bot + every flagged cheater + (for choice questions) multi-react voters, scores answers, persists them, stamps \`processedAt\`, computes the leaderboard, and — when seasons are enabled — runs season rollover on the final fire. You will NOT call \`fetch_channel_messages\`, \`find_previous_questions\`, \`get_question_history\`, \`submit_answers\`, \`retrieve_scores\`, \`check_season_status\`, or \`upsert_season\` — every one of those is now absorbed into this single tool.

   The returned payload shape:
   - \`game\`: the game's slug (internal — never surface).
   - \`reveals\`: array of reveal entries to render (length 0 = nothing pending, length 1 = today's reveal). Each entry has:
     - \`questionId\`, \`statement\`, \`category\`, \`emojis\`, \`messageLink\`.
     - \`wasReprocessed\` (boolean) — true if this was a corrective re-run (rare; affects tone slightly — acknowledge subtly without dwelling).
     - \`answer\`: \`{ type: "boolean", isTrue }\` for boolean questions; \`{ type: "choice", choices, correctIndex }\` for choice; \`{ type: "freeform", expectedAnswer, acceptableAnswers?, gradingNotes? }\` for freeform (the user typed their answer into a modal).
     - \`voters\`: \`{ correct: Voter[], incorrect: Voter[], fenceSitters: Voter[], wildcards: Array<{ userId, displayName, emoji }> }\`. \`fenceSitters\` is empty for choice and freeform. \`wildcards\` is empty for freeform (no reactions). For FREEFORM entries, every \`Voter\` in \`correct\` and \`incorrect\` carries an additional \`answerText\` field — the user's typed answer — which you MUST QUOTE in the reveal so players can see what they (and others) said. Caught cheaters are STRUCTURALLY ABSENT from the payload.
   - \`leaderboard\`: array of \`{ userId, displayName, totalCorrect, totalAnswered, accuracy, currentSeasonCorrect?, currentSeasonAnswered? }\` already sorted in render order.
   - \`roundSummary\`: \`{ totalQuestions, perPlayer: Array<{ userId, displayName, correct, answered, roundMvp? }> }\` — ALWAYS present, even for length-1 fires. Per-player aggregates across this fire's revealed questions. Already sorted (correct desc, displayName asc); already excludes cheaters/multi-react voters; you MUST NOT recompute it from \`reveals[].voters\` yourself. Use it directly in the multi-question branch's Round Summary section.
   - \`seasonStatus\` (only present when \`trivia.seasons.enabled\` is true): \`{ currentSlug, isLastFireOfSeason, seasonClosed, newSeasonStarted?, mvp? }\`. When \`isLastFireOfSeason\` is true the tool has ALREADY stamped \`endedAt\` and (when needed) created a continuation season — do NOT call \`upsert_season\`.
   - \`errors\` (optional): per-questionId structured errors from a reprocess batch. Surface a brief mention if present; otherwise omit.

   If \`reveals\` is empty (no pending question), acknowledge with humor — "No verdict to deliver today — the question bank is quiet!" — and STILL render the cumulative leaderboard table.

2. RENDER VIA \`submit_response\` USING THE GAME SHOW PRESENTER VOICE:

   The block layout BRANCHES on \`reveals.length\`:

   - \`reveals.length === 0\`: post the empty-payload acknowledgement described above + the cumulative leaderboard table. No verdict blocks.
   - \`reveals.length === 1\`: SINGLE-QUESTION layout (described immediately below). Use the full verdict + per-voter-bucket layout. The \`roundSummary\` field is IGNORED in this branch — the single voter-bucket sections already convey the same information per-player.
   - \`reveals.length > 1\`: MULTI-QUESTION layout (see below the single-question section). Use brief per-question verdicts + a "Round Summary" section sourced from \`roundSummary.perPlayer\`. Trades verbose voter-bucket sections for an aggregate scoreboard so the message stays readable when there are several questions.

   === SINGLE-QUESTION LAYOUT (when reveals.length === 1) ===

   Build a Block Kit message (Clack's curated subset: divider, header, section, context, image, markdown, card, carousel). Use this layout:

   - \`header\` block — \`text: { type: "plain_text", text: "..." }\`. Announce the verdict (e.g. "🎯 THE ANSWER IS TRUE!", "🎲 IT'S FALSE!" for boolean; "🎯 THE ANSWER IS C!" or similar for choice; for FREEFORM: "🎯 THE ANSWER WAS PARIS!" / "✏️ THE ANSWER: 1492!" — quote the canonical \`answer.expectedAnswer\`). plain_text only, no \`*bold*\`. Vary the wording each day.
   - \`section\` block (mrkdwn) — explain WHY the statement is true/false (boolean) or which choice was correct + why (choice). For FREEFORM, summarize the expected answer in one short factual sentence and (when \`answer.acceptableAnswers\` was populated) note that variants were accepted. Apply the REVEAL TONE from the \`trivia\` topic of your system instructions.
   - \`divider\` block — paces the reveal.
   - One \`section\` block (mrkdwn) PER NON-EMPTY VOTER BUCKET. Skip empty buckets entirely (no placeholders, no "nobody here" lines). Possible buckets:
     - CORRECT voters — celebrate with \`<@USERID>\` mentions. For FREEFORM entries, INCLUDE each voter's typed answer in quotes: "<@U_ALICE> said *Paris* — bullseye!" Quote multiple distinct answers when they appeared.
     - INCORRECT voters — acknowledge with game-show charm. For FREEFORM, quote each voter's typed text so they see what was rejected: "<@U_BOB> hedged with *Paris or London* — the judge doesn't accept shotgun guesses!"
     - FENCE-SITTERS (boolean only) — playful roast.
     - WILDCARDS (boolean/choice only) — interpret their \`emoji\` with humor.
   - When \`seasonStatus.isLastFireOfSeason\` is true: insert ONE additional \`section\` block above the closer that names the closing season's slug (from \`seasonStatus.currentSlug\`) and calls out the MVP (from \`seasonStatus.mvp\`). Apply the SEASON-FINALE TONE from the \`trivia\` topic of your system instructions for the wrap-up wording. Do NOT preview the new season's slug — leave that for a future fire to announce.
   - \`context\` block — short closer ("That's a wrap! Here's the running scoreboard:") leading into the leaderboard. Do NOT predict timing — the next reveal is on a separate schedule you have no visibility into.

   === MULTI-QUESTION LAYOUT (when reveals.length > 1) ===

   When the active season has a format, a single cron fire posts N questions and one reveal must cover all of them. The verbose per-voter-bucket layout multiplies badly, so use this compressed shape instead:

   - One \`header\` block — \`text: { type: "plain_text", text: "..." }\`. Introduce the multi-question reveal (e.g. "🎯 ROUND RECAP — N QUESTIONS!", "🏆 THE VERDICTS ARE IN!", etc.). Vary the wording. plain_text only.
   - One \`section\` block PER question (in the same order as \`reveals\`). Keep each one BRIEF — ≤ 2 short sentences. Open with the verdict label (e.g. "Q1: ✅ TRUE!" or "Q3: 🎯 The answer was 'Tokyo'!" or for freeform "Q2: ✏️ The answer: *Paris*"). For FREEFORM questions, the teaser MAY quote one or two notable typed answers ("Alice nailed it with *Paris*; Bob shotgunned and was rejected"). For boolean/choice, follow with a single-line voter teaser ("Alice and Bob nailed it; Carol fell for the trap"). Do NOT enumerate every voter individually here — that's what the Round Summary is for.
   - One \`divider\` block — separates the verdicts from the summary.
   - One \`section\` block titled "🏆 Round Summary" (or similar). List each player from \`roundSummary.perPlayer\` IN ORDER as \`<@USERID>: <correct>/<totalQuestions>\` (or any in-persona phrasing). Prefix every entry whose \`roundMvp: true\` is set with \`🏆\` (e.g. "🏆 <@U123>: 3/3"). DO NOT recompute the counts — read them straight from \`roundSummary.perPlayer\`. DO NOT add players who aren't in \`perPlayer\` (the tool already filters out anyone who didn't answer this round).
   - When \`seasonStatus.isLastFireOfSeason\` is true: insert ONE additional \`section\` block above the closer that names the closing season's slug and calls out the season MVP (from \`seasonStatus.mvp\`). Apply the SEASON-FINALE TONE from the \`trivia\` topic for the wrap-up wording. Same rule as the single-question branch.
   - One \`context\` block — short closer leading into the cumulative leaderboard. Same timing-prediction prohibition as the single-question branch.

   Example shape for a 3-question multi-reveal:
   \`\`\`
   [
     { "type": "header", "text": { "type": "plain_text", "text": "🎯 ROUND RECAP — 3 VERDICTS!" } },
     { "type": "section", "text": { "type": "mrkdwn", "text": "*Q1: ✅ TRUE!* The crocodile family really has been around since the Late Cretaceous. <@U_ALICE> and <@U_BOB> called it; <@U_CAROL> hesitated." } },
     { "type": "section", "text": { "type": "mrkdwn", "text": "*Q2: 🎲 FALSE!* Goldfish memory clocks in at months, not seconds. <@U_BOB> kept the streak going; <@U_ALICE> fell for the myth." } },
     { "type": "section", "text": { "type": "mrkdwn", "text": "*Q3: 🎯 The answer was 'Tokyo'!* Edo became Tokyo in 1868. <@U_CAROL> aced it." } },
     { "type": "divider" },
     { "type": "section", "text": { "type": "mrkdwn", "text": "*🏆 Round Summary*\\n🏆 <@U_BOB>: 3/3\\n<@U_ALICE>: 2/3\\n<@U_CAROL>: 2/3" } },
     { "type": "context", "elements": [ { "type": "mrkdwn", "text": "Standings refreshed below — onto the next round! 🎲" } ] }
   ]
   \`\`\`

   This branch trades per-question voter detail for an aggregate scoreboard. Readability over completeness — the cumulative leaderboard table below still ships.

   === TABLE PARAMETER (both single-question and multi-question layouts) ===

   PLUS, alongside \`blocks\`, set the top-level \`table\` parameter rendering the leaderboard. CRITICAL: \`table\` is a SIBLING of \`blocks\` on the \`submit_response\` call, NOT a member of the \`blocks\` array — Block Kit rejects \`{ "type": "table" }\` inside \`blocks\`, and the message will ship with no scoreboard if you put it there. The shape is \`submit_response({ blocks: [...], table: { type: "table", rows: [...], column_settings: [...] }, actions: [...] })\`.

   TWO RENDERING SHAPES:

   - WHEN \`seasonStatus\` IS PRESENT AND \`seasonStatus.hasPriorSeasons\` IS \`true\` (seasons enabled, a current season is active, AND at least one answer belongs to a different season) — 3-ROW DUAL-TOTALS TABLE:
     - Row 1: top-left label cell containing a single space \`" "\` (Slack rejects empty raw_text cells with \`invalid_blocks\`), then one cell per player with their \`displayName\` (NO medal prefix on this row).
     - Row 2: left cell \`"Current Season"\`, then one cell per player with \`String(currentSeasonCorrect)\`. Apply medal prefixes \`"🥇 "\`, \`"🥈 "\`, \`"🥉 "\`, \`"🎀 "\` (Unicode characters, NOT \`:first_place_medal:\`/\`:ribbon:\` shortcodes — shortcodes render as literal text inside table cells) to the cells holding the top-4 \`currentSeasonCorrect\` values among present players (🎀 = 4th place).
     - Row 3: left cell \`"All Time"\`, then one cell per player with \`String(totalCorrect)\`. Apply medal prefixes to the top-4 \`totalCorrect\` values among present players — INDEPENDENT of the current-season ranking.
     - Player columns: only include leaderboard entries where \`currentSeasonCorrect > 0\` OR \`currentSeasonAnswered > 0\`. Omit anyone with zero current-season participation.
     - Fewer than 4 present players → assign medals only for whichever positions exist.
     - \`column_settings\`: one \`{ "align": "center" }\` entry per column (label column + each player column).

     Example shape (2 present players, seasonStatus present):
     \`\`\`
     {
       "blocks": [ /* header, explanation, divider, voter sections, closer context — see above */ ],
       "table": {
         "type": "table",
         "rows": [
           [" ",              "Alice",    "Bob"],
           ["Current Season", "🥇 5",     "🥈 3"],
           ["All Time",       "🥈 9",     "🥇 12"]
         ],
         "column_settings": [
           { "align": "center" }, { "align": "center" }, { "align": "center" }
         ]
       },
       "actions": []
     }
     \`\`\`

   - WHEN \`seasonStatus\` IS ABSENT (seasons disabled or in a gap), OR WHEN \`seasonStatus.hasPriorSeasons\` IS \`false\` (only one season has ever had activity, so "All Time" would duplicate "Current Season") — 2-ROW TABLE:
     - Row 1: one cell per player with their \`displayName\` (NO medal prefix on this row).
     - Row 2: one cell per player with \`String(totalCorrect)\`. Apply medal prefixes \`"🥇 "\`, \`"🥈 "\`, \`"🥉 "\`, \`"🎀 "\` (Unicode characters, NOT \`:first_place_medal:\`/\`:ribbon:\` shortcodes — shortcodes render as literal text inside table cells) to the cells holding the top-4 \`totalCorrect\` values (🎀 = 4th place).
     - Fewer than 4 players → assign medals only for whichever positions exist.
     - \`column_settings\`: one \`{ "align": "center" }\` entry per column.

     Example shape (4 players, no seasonStatus):
     \`\`\`
     {
       "blocks": [ /* header, explanation, divider, voter sections, closer context */ ],
       "table": {
         "type": "table",
         "rows": [
           ["Alice",    "Bob",   "Carol", "Dave"],
           ["🥇 11",    "🥈 8",  "🥉 6",  "🎀 3"]
         ],
         "column_settings": [
           { "align": "center" }, { "align": "center" }, { "align": "center" }, { "align": "center" }
         ]
       },
       "actions": []
     }
     \`\`\`

   If the leaderboard is empty (nobody has participated yet), OMIT the \`table\` parameter entirely. Otherwise the table MUST be present — a reveal closer that mentions the scoreboard without a populated table is a visible bug.

   General rule for emoji in table cells: always use the Unicode character (🐙, 🏆, 🎲), never the Slack shortcode (\`:octopus:\`, \`:trophy:\`, \`:game_die:\`). Shortcodes work in section/header/context blocks but render as literal text inside table cells.

Style guidance:
- Use emojis liberally for visual impact.
- Mention users with \`<@USERID>\` format.
- Use Slack mrkdwn (\`*bold*\`, \`_italic_\`) sparingly — emoji and energy do most of the work.
- Header text is \`plain_text\`, so emojis render but \`*asterisks*\` do not.
- NEVER predict timing — no "see you tomorrow", "next reveal in 24 hours", or similar. The next fire is on a separate schedule you have no visibility into.

Keep the tone fun, educational, and maintain that charismatic Game Show Presenter energy throughout.`;

/**
 * Legacy manual-setup template. Used by admins setting up trivia via Claude chat
 * rather than via `config.trivia.games[]`. The config-driven path
 * (reconcileCronJobs from `buildGameSpecs`) is preferred.
 *
 * The Schedule B (reveal) requiredTools list is the new single-tool list:
 * `mcp__trivia__process_reveal_answers` absorbs the previous 5–6 tools'
 * worth of orchestration. This is the same list `buildGameSpecs` emits.
 */
export const CREATE_SCHEDULES_INSTRUCTIONS = `# Setting up Trivia schedules

When the user asks to set up, install, configure, or add Trivia scheduling (in a specific channel), follow this recipe. Create two cron jobs — Schedule A posts the daily question, Schedule B reveals the answer — both in the SAME channel.

## Before creating

1. DETECT DUPLICATES FIRST
   - Use list_scheduled_messages (or the equivalent scheduled-messages listing tool) to check for existing trivia schedules.
   - If a trivia schedule already exists in the target channel, ask the user before creating or updating.

2. ASK FOR THE CHANNEL
   - If the user didn't specify a channel, ask. Both Schedules A and B must go in the SAME channel.

3. ASK FOR BOTH TIMES
   - If the user didn't provide the times, ASK EXPLICITLY:
     - What time and days of the week should Schedule A (the question) post?
     - What time and days of the week should Schedule B (the answer reveal) post? Schedule B should be later in the day than Schedule A, on the same weekday(s).
     - What timezone? Ask if it is not obvious from context. Do NOT fabricate a timezone default.
   - If the user's times would reveal the answer before the question is posted on a given day, flag the inversion and ask them to reconsider.

## Schedule A — Send question

Create via create_scheduled_message with:
- channel: (from step 2)
- cron: (from step 3)
- timezone: (from step 3)
- plugin: "trivia"
- requiredTools: [
    "mcp__trivia__send_questions_instructions",
    "mcp__trivia__get_ideas",
    "mcp__trivia__find_previous_questions",
    "mcp__trivia__save_question"
  ]
- prompt: "Call send_questions_instructions and follow the returned instructions exactly."

## Schedule B — Process responses

Create via create_scheduled_message with:
- channel: SAME as Schedule A
- cron: (from step 3)
- timezone: (from step 3, must match Schedule A)
- plugin: "trivia"
- requiredTools: [
    "mcp__trivia__process_reveal_answers"
  ]
- prompt: "Call process_reveal_answers with the game name, then render the returned payload as a reveal using the Game Show Presenter voice via submit_response."

## After creating

Confirm both schedules back to the user: channel, time/days, timezone, and a one-line summary of each. Make it clear that follow-up edits can be done by deleting and re-running this setup.`;
