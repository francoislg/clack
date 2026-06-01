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
   - When the get_ideas response does NOT include \`contextPriority\`, ignore lens handling entirely and pass no \`context\` arg to \`save_question\`.

ADMIN GUIDANCE — when get_ideas returns \`instructions\` and/or \`additionalInstructions\`:
   - \`instructions\` (string) is a single admin-authored rule resolved from the replace-cascade \`slot → season → game → workspace\`. Honor it verbatim throughout the run — apply it to the phrasing, content choice, and tone of the question you generate.
   - \`additionalInstructions\` (string) is a concatenation of admin rules from every active tier, each segment labeled (\`[Workspace]\` / \`[Game]\` / \`[Season]\` / \`[Slot N]\`) and separated by blank lines. EVERY labeled rule applies simultaneously — do NOT pick one; all must hold. Treat lower-tier (slot, season) rules as more situational than higher-tier (workspace, game) ones, but never as overrides — they stack on top.
   - STRUCTURE IS PRESERVED BY DEFAULT. The post is built from independent, individually-addressable blocks (the \`header\`, the warm-up patter \`section\`, the question \`card\`, the closer \`context\` — see step 9). For each admin rule, decide whether it EXPLICITLY calls for a structural change (add, remove, replace, or reorder a block):
     - NO (e.g. "keep the preamble short", "be funnier", "avoid politics") → keep the block layout EXACTLY as specced and apply the rule only to the content/tone of the block(s) it names — or to overall tone when it names no specific block. A rule naming one block changes ONLY that block; it does not touch its siblings. A tone or length rule is NEVER a license to drop the card or collapse the layout.
     - YES (e.g. "don't use a card for the question, use a plain section", "merge the patter into the header") → make EXACTLY that structural change and nothing more; the explicit rule wins over the default layout. Every other block keeps its default structure.
   - THE ANSWER BUTTONS ARE THE ONE EXCEPTION. \`post_questions\` appends the \`actions\` block (TRUE/FALSE, numbered choices, or the freeform Answer button) mechanically — an admin rule CANNOT remove them, and you do NOT try to suppress them in your \`blocks\` array.
   - When either field is ABSENT from the payload, ignore it entirely. Do NOT fabricate guidance, do NOT enumerate categories as a substitute, do NOT mention the absence to viewers.
   - These rules are NOT visible to viewers in the final post — they shape what you write, not what you say. Don't echo them back ("As per the admin's instruction…"). Just apply them silently.`;

/**
 * Three shared gates referenced by every generation path. Printed ONCE at the top of
 * `PER_SLOT_GENERATION_PATHS`; each path's step says "apply the X GATE" instead of
 * restating the body. Done to shrink the rendered prompt without losing nuance.
 */
const DUPLICATE_CHECK_GATE = `DUPLICATE CHECK GATE (shared across all paths — invoke whenever a path step says "apply the DUPLICATE CHECK GATE"):
   - Call \`find_previous_questions({ keywords: [3-5 distinctive terms from your statement], match: "any" })\`. Pick names, numbers, or rare nouns — words a duplicate of this fact would also have to contain in some framing. OMIT the \`games\` argument so the scan spans every game (a duplicate fact in a sibling game still counts).
   - For each returned row, inspect \`matchedKeywords\` and the row's \`statement\` to decide whether it covers the SAME underlying fact in any framing or polarity (a TRUE statement and a FALSE statement about the same fact are still duplicates).
   - If the result set is uninformatively wide (many rows hitting only a common word), re-call with sharper keywords.
   - If any candidate is a duplicate, go back to the statement-writing step and write a different question. Iterate until unique.`;

const DIFFICULTY_GATE = `DIFFICULTY GATE (REQUIRED — STRICT MEMBERSHIP — shared across all paths — invoke whenever a path step says "apply the DIFFICULTY GATE"):
   Self-rate the question on the 1-10 scale. The ACCEPT RANGE is \`suggestedDifficultyRange\` \`[min, max]\` from get_ideas — the bucket's range IS the strict accept bound, there is no separate threshold. Freeform's bands are softer than boolean/choice's; the range from get_ideas already reflects this.

   - Rating INSIDE \`[min, max]\` (inclusive) → proceed.
   - Rating EXACTLY \`min - 1\` or \`max + 1\` (one point off, above or below) → REFRAME ONCE: rewrite the question to dial difficulty toward the range. Concrete levers:
     - Too easy (rating below): swap a famous name/place for a less-iconic one; demand a mechanism or consequence rather than the headline fact; pick a more obscure detail of the same topic.
     - Too hard (rating above): pick a more iconic example of the same category; lean on a famous date/place/person; state the consequence rather than the cause.
     Re-rate v2 on the same 1–10 scale INDEPENDENTLY of the prior rating (don't anchor on "I made it easier so it must now be inside the range" — judge v2 fresh). Inside \`[min, max]\` → proceed; still outside the range (anywhere, not just ≥2 off) → REJECT and re-call get_ideas. Do NOT reframe a second time.
   - Rating ≥2 points outside \`[min, max]\` (either direction) → REJECT immediately and re-call get_ideas for a fresh roll. Do NOT reframe — the topic is wrong, not the framing. Reframing a question rated 3 to fit a Hard bucket [8,10] produces forced, awkward questions.

   Per-path reframe overrides (apply during REFRAME ONCE):
   - BOOLEAN paths: IMMEDIATELY re-run the POLARITY SELF-CHECK on the reframed statement BEFORE re-rating. Reframing-by-detail-swap can silently flip a TRUE statement to FALSE — the polarity gate is what catches this. If polarity fails on the reframe, REJECT and re-call get_ideas (you've burned your retry; don't try a second reframe).
   - CHOICE paths: the correct answer's POSITION stays LOCKED at \`suggestedCorrectIndex\` during reframe — rewrite only the question text or the distractors, never move the correct answer.
   - FREEFORM paths: the canonical \`expectedAnswer\` may need updating if the reframe changes what the question is asking about.`;

const STATEMENT_CHOICES_NON_OVERLAP_GATE = `STATEMENT–CHOICES NON-OVERLAP GATE (HARD CONSTRAINT — DO NOT SKIP — shared by all choice paths — invoke whenever a choice path step says "apply the STATEMENT–CHOICES NON-OVERLAP GATE"). The question statement MUST NOT name or substring any of the choices, correct or distractor. If a person, place, work, year, or value appears in the statement AND is also listed as an option, the statement is leaking — players who notice the overlap can read the answer off the question. Run this check explicitly after writing the choices: scan the statement for each choice string (and the entity each choice refers to, not just the literal text) and confirm zero overlap.
     - DON'T: "Which driver won the 2026 Indy 500, edging out David Malukas by 0.0233s?" with choices including "David Malukas" — the runner-up appears in BOTH the statement and the options.
     - DO: "Which driver won the 2026 Indy 500 in the closest finish in the race's history?" — runner-up details belong in the reveal patter, not in the question prompt.
     - When a contextual detail (a co-star, an opponent, a fellow honoree, an event location) would be a natural distractor, you MUST CHOOSE: either keep it in the statement and drop it from the choices, OR keep it as a distractor and rewrite the statement to omit it. Never both. The cheaper fix is almost always to trim the statement.
     - After any distractor-rewrite pass (from the plausibility gate), RE-RUN this check on the new distractor set before proceeding.`;

const HINT_DRAFTING_GATE = `HINT DRAFTING GATE (shared across all paths — invoke whenever a path's SAVE step says "apply the HINT DRAFTING GATE"):
   - If \`suggestedHintMode === "none"\`: OMIT the \`hint\` field on \`save_question\`. Skip the rest of this gate.
   - If \`suggestedHintMode === "button"\` or \`"inline"\`: draft a hint, self-review, then pass it.
     1. DRAFT: write one concise hint, ≤140 characters, that nudges toward the answer without stating it.
     2. SELF-REVIEW: ask yourself "does the draft state the answer outright, or paraphrase it in a way a player could reverse-engineer?" Use the examples below as anchors.
        - ❌ "It's a primary color you get from mixing yellow and red." → BAD (states the answer outright)
        - ❌ "Think of a color that sits between yellow and red on the color wheel." → BAD (paraphrases — a player can reverse-engineer it)
        - ✅ "It's a warm color often associated with passion." → GOOD (semantic neighborhood; doesn't reveal)
     3. REWRITE IF BAD: if the draft fails self-review, rewrite as a softer semantic-neighborhood nudge and re-review. Retry budget: 2 rewrites.
     4. OMIT IF NO USEFUL NUDGE EXISTS: if after the rewrites you still can't produce a hint that nudges without revealing, OMIT the \`hint\` field on \`save_question\` — better no hint than a hint that gives the answer away. This is an acceptable outcome, not a failure.
     5. PASS TO save_question: when the hint passes self-review, include \`hint: { mode: suggestedHintMode, text: "<final text>" }\` in the save call. The \`mode\` MUST equal the \`suggestedHintMode\` returned by \`get_ideas\`.`;

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

4. CHECK FOR DUPLICATES: apply the DUPLICATE CHECK GATE (shared definition above). If any candidate is a duplicate, go back to step 2 and write a different statement.

5. VALIDATE through research that the statement's actual truth matches suggestedAnswer (true → actually true; false → actually false). If validation reveals a mismatch (e.g. a "false" statement turned out to be accidentally true, or vice versa), return to step 2 and rewrite — do not patch.

6. DIFFICULTY RATING: apply the DIFFICULTY GATE (shared definition above) — BOOLEAN reframe rule applies (re-run the POLARITY SELF-CHECK from step 3 on any reframed statement before re-rating).

7. Choose fun emojis that relate to the topic.

8. HINT (optional): apply the HINT DRAFTING GATE (shared definition above). When \`suggestedHintMode\` is non-\`"none"\`, the gate produces an optional \`hint\` field to include in the save_question call below.

9. SAVE TO DATABASE:
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
     - hint (only when the HINT DRAFTING GATE produced one; omit otherwise — see the gate for shape)
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

   After writing the choices, apply the STATEMENT–CHOICES NON-OVERLAP GATE (shared definition above).

3. DISTRACTOR PLAUSIBILITY GATE (REQUIRED — DO NOT SKIP):
   Rate each option (correct + every distractor) 1–10 on "how plausible does this sound as the correct answer to someone who doesn't know the topic" (NOT "how true is it"). Apply ALL FOUR conditions:
   - (a) correct answer plausibility ≥ 5 — it must be defensible (a correct answer that scores 3/10 plausibility is one no one would even consider).
   - (b) highest distractor plausibility ≥ 4 — at least one real trap (otherwise the question is trivial).
   - (c) correct − highest_distractor ≤ 4 — the gap is small enough that distractors compete (otherwise the correct answer is a giveaway).
   - (d) every distractor plausibility ≥ 2 — no obvious joke filler.

   If ANY condition fails, REWRITE ONLY THE FAILING DISTRACTOR(S), never the correct answer. Repeat the gate. Retry budget: 3 distractor-rewrite passes per question. If the gate still fails after 3 passes, ABANDON this question and re-roll from get_ideas with a fresh suggestedCorrectIndex.

4. CHECK FOR DUPLICATES: apply the DUPLICATE CHECK GATE (shared definition above). If any candidate is a duplicate, go back to step 2 and write a different question.

5. DIFFICULTY GATE: apply the DIFFICULTY GATE (shared definition above) — CHOICE reframe rule applies (correct answer's POSITION stays LOCKED at \`suggestedCorrectIndex\` during reframe; rewrite only the question text or distractors).

6. Choose 1-4 fun emojis that relate to the topic.

7. HINT (optional): apply the HINT DRAFTING GATE (shared definition above). When \`suggestedHintMode\` is non-\`"none"\`, the gate produces an optional \`hint\` field to include in the save_question call below.

8. SAVE TO DATABASE:
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
     - hint (only when the HINT DRAFTING GATE produced one; omit otherwise — see the gate for shape)
     - slot: \`{ index: i }\` — REQUIRED when the active season has a format. MUST be OMITTED when format is null.
   - Store the returned questionId AND its slot.index for the post step.`;

/**
 * Topical modifier: collapses TOPICAL-BOOLEAN / TOPICAL-CHOICE / TOPICAL-FREEFORM
 * into a single block applied on top of the corresponding fact path. The WebSearch
 * step, per-shape topical levers (as nested bullets), event-keyword duplicate hint,
 * and the 2 extra save fields are all here. All gates (POLARITY SELF-CHECK on
 * boolean, DISTRACTOR PLAUSIBILITY on choice, DIFFICULTY GATE, STATEMENT-CHOICES
 * NON-OVERLAP on choice, DUPLICATE CHECK) apply identically to the fact paths.
 */
const TOPICAL_MODIFIER = `When the rolled \`suggestedQuestionType\` is \`"topical"\`, apply this modifier ON TOP OF the answer-shape path body (FACT-BOOLEAN PATH, FACT-CHOICE PATH, or FACT-FREEFORM PATH). The modifier prepends a research step, narrows the per-shape generation levers to event-anchored variants, adds an event-keyword hint to the duplicate check, and adds three fields to the save call. ALL OTHER GATES (POLARITY SELF-CHECK on boolean, DISTRACTOR PLAUSIBILITY GATE on choice, DIFFICULTY GATE, STATEMENT-CHOICES NON-OVERLAP GATE on choice, DUPLICATE CHECK GATE) apply identically to the fact path.

1. RESEARCH A RECENT EVENT VIA WebSearch (NEW STEP — REQUIRED — DO NOT SKIP, runs before the fact path's step 2):
   - Compose a WebSearch query that combines the chosen category, the chosen lens from contextPriority[0] (if applicable), and a recency hint (e.g. "this week", "yesterday", "last few days", a recent year).
   - Aim for events from the last day or two. Go back further (up to a week) only if nothing notable surfaced from the most recent days.
   - Pick ONE specific newsworthy event from the results to anchor the question on. Capture:
     - \`sourceUrl\`: the most authoritative URL that supports the claim (must begin with https://).
     - \`eventDate\` (optional but encouraged): the ISO 8601 date (YYYY-MM-DD) the event occurred, when easy to determine.
   - If the current lens (contextPriority[0]) yielded no usable event, descend per the CONTEXTS guidance. If every lens fails, re-call get_ideas.

2. ANCHOR THE QUESTION/ANSWER ON THE EVENT. The statement (boolean), correct option (choice), or canonical \`expectedAnswer\` (freeform) is derived from the event you captured. Per-shape topical levers (apply alongside the fact path's statement-writing step):
   - **BOOLEAN paths**: for FALSE statements, event-aware levers — swap a date, a name, a place, or a number to something subtly incorrect; or assert a tempting misconception about the event that the actual reporting contradicts.
   - **CHOICE paths**: distractors drawn from the same news domain work well (other people in the story, other recent similar events, related-but-wrong dates/places/numbers). WebSearch payloads love surfacing the runner-up / co-star / opponent adjacent to the winner — that detail is exactly the wrong thing to keep in the statement when you also list it as an option, so apply the STATEMENT-CHOICES NON-OVERLAP GATE accordingly.
   - **FREEFORM paths**: no shape-specific change beyond anchoring the answer on the event.

3. DUPLICATE CHECK uses event-derived keywords. Apply the DUPLICATE CHECK GATE as usual, but pick keywords from the event itself (names, places, dates from the news story). If the same event was already asked about — even with different polarity, framing, or angle — pick a different event from your WebSearch results (or re-search).

4. SAVE DELTAS (added to the fact path's save_question call):
   - questionType: "topical" (instead of "fact")
   - sourceUrl (REQUIRED — the https:// URL captured in step 1)
   - eventDate (optional — YYYY-MM-DD when known)
   All other save fields (\`answersFormat\`, category, statement, isTrue/choices/correctIndex/expectedAnswer + acceptableAnswers + gradingNotes + freeformAnswerShape, emojis, suggestedDifficulty, difficulty, context, slot) are identical to the corresponding fact-path save.`;

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

6. DUPLICATE CHECK: apply the DUPLICATE CHECK GATE (shared definition above). If any candidate is a duplicate, go back to step 2.

7. DIFFICULTY GATE: apply the DIFFICULTY GATE (shared definition above) — FREEFORM reframe rule applies (canonical \`expectedAnswer\` may need updating if the reframe changes what the question is asking about).

8. Choose 1-4 fun emojis.

9. HINT (optional): apply the HINT DRAFTING GATE (shared definition above). When \`suggestedHintMode\` is non-\`"none"\`, the gate produces an optional \`hint\` field to include in the save_question call below.

10. SAVE TO DATABASE:
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
     - hint (only when the HINT DRAFTING GATE produced one; omit otherwise — see the gate for shape)
     - slot: \`{ index: i }\` — REQUIRED when the active season has a format. MUST be OMITTED when format is null.
   - Store the returned questionId AND its slot.index for the post step.`;

/**
 * Staged-pool check + per-slot fill loop dispatch. Shared between PREP and POST.
 * Both prompts open with this section: read what's already staged, learn the format,
 * determine which slot indices still need a question. The downstream behavior diverges
 * (PREP saves and exits; POST renders and posts) but the entry sequence is identical.
 */
const STAGED_POOL_CHECK_AND_DISPATCH = `STAGED POOL CHECK (REQUIRED FIRST STEP):
   1. Call \`find_previous_questions({ games: ["{game}"], seasons: ["current"], posted: false, match: "all" })\`.
      The response lists every question already pre-staged for this game in the current season —
      these are questions that were generated and saved but have not yet been posted to Slack
      (\`postedAt\` is undefined).
   2. Call \`get_ideas({ game: "{game}" })\` (no slot arg). Inspect the response's \`format\` field — it dispatches the OUTER flow:

- \`format: null\` → SINGLE-QUESTION FLOW. The active season has no format. ONE question per fire.
- \`format: { slotCount: N, slots: [...] }\` → MULTI-SLOT FLOW. The active season has a format with N slots.

PER-SLOT FILL LOOP (REQUIRED — applies to BOTH flows; for \`format: null\` treat as one slot at index 0):

   For each slot index \`i\` in \`[0..slotCount-1]\` (slotCount = 1 when \`format: null\`):
   - Check the staged-pool response from step 1 for a question with \`slot.index === i\` (or with no \`slot\` field when \`format: null\`):
     - If multiple staged questions match this slot, the OLDEST by \`createdAt\` is the one to use later.
     - When a staged question covers this slot, do NOT regenerate — that slot is already FILLED.
   - When no staged question covers this slot, the slot is MISSING. Generate one now:
     1. For \`i === 0\` in MULTI-SLOT FLOW: reuse the OPENING \`get_ideas\` payload from step 2 above.
        For \`i >= 1\` in MULTI-SLOT FLOW: make a FRESH \`get_ideas({ game: "{game}", slot: i })\` call. Do NOT reuse slot 0's rolls — each slot must roll its own. (Pre-rolling all suggestions up front is forbidden.)
        For SINGLE-QUESTION FLOW: reuse the step-2 payload.
     2. In MULTI-SLOT FLOW, read \`format.slots[i].label\` as a creative HINT for this slot's flavor (e.g. "Lightning Round", "Historical Choice") — set your tone for this slot, but do NOT copy the label literally into the question text.
     3. Run the per-slot generation flow below (6-way branch on \`suggestedAnswersFormat\` × \`suggestedQuestionType\`) for THIS slot.
     4. When saving, pass \`slot: { index: i }\` to \`save_question\` when \`format\` is non-null. Store the returned \`questionId\` paired with \`i\`.
     5. SAVE BEFORE ADVANCING. The \`save_question\` call for slot \`i\` MUST complete before you call \`get_ideas\` (or do any other work) for slot \`i+1\`. Do NOT batch saves at the end of the loop, and do NOT carry multiple un-saved drafts forward — finish slot \`i\` (gen + save) as a unit, then start slot \`i+1\` fresh.
   - When a slot was already FILLED from the staged pool, no \`get_ideas\` call is needed for that slot — the staged record carries its own resolved values from when it was generated.

Repeat until every slot index in \`[0..slotCount-1]\` is covered (either FILLED from the pool or freshly saved).`;

/**
 * The six per-slot generation paths (FACT × BOOLEAN/CHOICE/FREEFORM and TOPICAL × same).
 * Shared verbatim between PREP and POST — both prompts include this content as the
 * substantive generation guidance for any slot that needs to be freshly written.
 */
const PER_SLOT_GENERATION_PATHS = `Per-question/per-slot generation DISPATCHES on a 2-axis matrix: \`suggestedAnswersFormat\` × \`suggestedQuestionType\`. The answer-shape axis (boolean / choice / freeform) selects ONE OF THREE PATH BODIES below. The question-type axis (fact / topical) is a MODIFIER: \`"fact"\` runs the path body unchanged; \`"topical"\` applies the TOPICAL MODIFIER (which prepends a WebSearch step and adds save fields) on top of the same path body.

| | \`suggestedAnswersFormat: "boolean"\` | \`suggestedAnswersFormat: "choice"\` | \`suggestedAnswersFormat: "freeform"\` |
|---|---|---|---|
| \`suggestedQuestionType: "fact"\` | FACT-BOOLEAN PATH = BOOLEAN path body | FACT-CHOICE PATH = CHOICE path body | FACT-FREEFORM PATH = FREEFORM path body |
| \`suggestedQuestionType: "topical"\` | TOPICAL-BOOLEAN PATH = BOOLEAN path body + TOPICAL MODIFIER | TOPICAL-CHOICE PATH = CHOICE path body + TOPICAL MODIFIER | TOPICAL-FREEFORM PATH = FREEFORM path body + TOPICAL MODIFIER |

All three topical combinations REQUIRE the \`WebSearch\` tool (via the TOPICAL MODIFIER) to find a recent newsworthy event, and pass the resulting source URL to \`save_question\`. The fact combinations never call WebSearch.

The freeform paths produce an answer the user TYPES (into a Slack modal). Claude writes the canonical \`expectedAnswer\` and optional \`acceptableAnswers\` / \`gradingNotes\` at save time. A small fast model judges submissions at reveal — the judge automatically rejects multi-guess "shotgun" answers (e.g. "Paris or London") as incorrect, so the canonical answer must be a single concrete value.

Duplicate detection is intentionally CROSS-GAME and is not slot-scoped — a question that appeared in slot 0 yesterday is still a duplicate if it shows up in slot 2 today, and a duplicate fact in a sibling game still counts. Always call \`find_previous_questions\` with \`keywords: [...]\` + \`match: "any"\`, OMITTING the \`games\` argument; do NOT filter by slot.

=== SHARED GATES (referenced by every path body below — read once, apply wherever a path step says "apply the X GATE") ===

${DUPLICATE_CHECK_GATE}

${DIFFICULTY_GATE}

${STATEMENT_CHOICES_NON_OVERLAP_GATE}

${HINT_DRAFTING_GATE}

=== BOOLEAN PATH BODY (per question / per slot) ===

${QUESTION_FLOW_STEPS}

=== CHOICE PATH BODY (per question / per slot) ===

${CHOICE_FLOW_STEPS}

=== FREEFORM PATH BODY (per question / per slot) ===

${FREEFORM_FACT_FLOW_STEPS}

=== TOPICAL MODIFIER (applied on top of any path body when suggestedQuestionType === "topical") ===

${TOPICAL_MODIFIER}`;

/**
 * The presentation half of the post-cron prompt — opener gating, card layout, post + retry,
 * end-of-run. POST_QUESTIONS_INSTRUCTIONS pulls this in after the staged-pool check and the
 * per-slot generation paths; PREP_QUESTIONS_INSTRUCTIONS does NOT include any of it (prep
 * never posts).
 */
const FORMAT_AND_POST_SECTION = `=== FORMAT & POST (BOTH FLOWS, BOTH PATHS) ===

NEW-SEASON OPENER (applies to BOTH outer flows, BEFORE building the per-question card blocks):

Inspect the OPENING \`get_ideas\` call's payload (the slot-0 call you already made — do NOT make a second call for this).

- If \`firstFireOfSeason === true\`: prepend TWO ceremonial Block Kit blocks to the FRONT of the message you will send to \`post_questions\` — they sit ABOVE everything described in step 9 (above the question's show banner / round opener), regardless of whether the outer flow is single-question or multi-slot. The opener appears ONCE per fire (not once per slot) and frames the entire batch as the new season's debut. The two blocks are:
  1. \`header\` block — \`text: { type: "plain_text", text: "..." }\`. plain_text only. The text MUST begin with the 🆕 Unicode character (use the 🆕 character directly — NEVER the \`:new:\` shortcode; shortcodes render as literal text in Slack header blocks), immediately followed by a short "NEW SEASON" label. Render that label in the session's output language per the LANGUAGE directive (English \`NEW SEASON\`, French \`NOUVELLE SAISON\`) — translate the wording, but always keep the 🆕 lead. After the label you MAY append a short flourish — the season slug, the theme (when set), or a colon plus the theme in upper-case.
  2. \`section\` block (mrkdwn) — one in-persona paragraph that:
     - Names the current season's slug verbatim (e.g. "season-2026-06") — the slug is the canonical identifier the leaderboard rows will display.
     - When AND ONLY WHEN the \`get_ideas\` payload includes a non-empty \`theme\` string, mentions that theme in one short line ("This month's theme: *Music Mayhem*."). Mention it verbatim — don't translate or re-phrase the theme.
     - When the payload has NO \`theme\` field, do NOT mention any theme: do NOT fabricate one, do NOT enumerate the season's categories as a stand-in, do NOT include a "no theme yet" disclaimer. Just let the section be about the new chapter starting, ending with energy that segues into the first question(s).

  Examples (English illustration — translate the wording per the LANGUAGE directive; keep the 🆕 lead):
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

   Compose a \`blocks\` array (Clack's curated subset: divider, header, section, context, image, markdown, card, carousel) — you'll hand it to \`post_questions\` in step 10. Do NOT include the answer affordance (buttons) in the blocks; \`post_questions\` appends an \`actions\` block for ALL formats automatically — boolean gets \`[👍 TRUE, 👎 FALSE]\`, choice gets \`[1️⃣, 2️⃣, …]\` sized to \`choices.length\`, freeform gets a single \`Answer\` button that opens the modal. The tool inserts that actions block between your card (#3) and your closer context (#4) at post-time. Use this FOUR-BLOCK layout — the structure stays fixed; the wording is where your persona lives:

   1. \`header\` block — \`text: { type: "plain_text", text: "..." }\`. plain_text only — no \`*bold*\`.
      - SINGLE-QUESTION FLOW, **and** every question after the first in MULTI-SLOT FLOW (slots 1..N-1): the show banner (e.g. "🎯 TRIVIA TIME!"). Vary the wording daily ("📣 STEP RIGHT UP!", "🎲 DAILY BRAIN TEASER", "🎯 TRIVIA TIME!", etc.).
      - MULTI-SLOT FLOW, FIRST question only (slot 0): a calmer date-stamped round opener that anchors today's round, e.g. "🗓️ Trivia for Wednesday, May 20", "📅 Trivia — May 20", "🎟️ Today's Trivia Round · May 20". Use today's actual date (weekday + month + day, OR month + day — your call). Keep it noticeably less shouty than the show banner; this is the "round header" for the batch, not the per-question hype line. Subsequent slots in the same batch go back to the normal show-banner style.
   2. \`section\` block (mrkdwn) — your warm-up patter (this is THE "preamble" / "opener" / "warm-up" admin instructions refer to). 1-2 short sentences that build anticipation. This is where the Game Show voice shines.
      - **TOPICAL QUESTIONS (questionType: "topical") MUST FLAG THEMSELVES.** The warm-up patter SHALL signal that this is a current-events / news question — e.g. "Hot off the presses!", "Straight from this week's headlines:", "Today in the news:", "If you've been doomscrolling lately, this one's for you:", "Ripped from yesterday's news:", etc. Do NOT use static-knowledge framings like "dig into your knowledge vault", "what you remember from school", "trivia masters take note", or anything implying memorized facts — those mislead viewers about what kind of question to expect. Pair the news framing with the same game-show energy. Vary the exact wording each day.
      - **NO YEAR / DATE STAMPS INSIDE THE TOPICAL STATEMENT.** The card's \`subtitle\` (the localized Current News label) and the patter already signal recency — so the statement itself MUST NOT include the current year ("in 2026"), an explicit month ("in May"), or phrases like "this week", "recently", "last month". Strip those even if the WebSearch result phrased the event that way. The recency context lives in the subtitle + patter, not in the statement. The optional \`eventDate\` field on \`save_question\` is where dates belong if Claude wants to record them — never in the user-visible statement.
      - **FACT QUESTIONS (questionType: "fact")** keep the standard knowledge-vault framing — that's the default voice.
   3. \`card\` block — the trivia card itself, holds JUST the question:
      - \`title\`: \`{ type: "mrkdwn", text: "<emoji> <Category>" }\` — JUST the category from step 1, with a topic-fitting emoji prefix. Same shape for BOTH fact and topical questions. No "TRIVIA TIME" here, no flavor text, no "(Current News)" suffix.
      - \`subtitle\`: TOPICAL questions ONLY (questionType: "topical") — \`{ type: "mrkdwn", text: "<Current News label>" }\`, a short "Current News" label rendered in the session's output language per the LANGUAGE directive (English \`Current News\`, French \`Actualités\`). This is what tells viewers the question is anchored to a recent event. OMIT entirely on FACT questions.
      - \`body\`: \`{ type: "mrkdwn", text: "<statement>" }\` — JUST the statement. For choice questions, the choices themselves render as buttons (see ANSWER BUTTONS below); the card body holds the question text only. Do NOT include any inline TRUE/FALSE vote line, numbered choice list, or freeform Answer-button nudge inside the card body — buttons replace all of those.
      - Do NOT set \`hero_image\` or \`icon\`.
   4. \`context\` block — a short closer line nudging people to vote ("Cast your vote below — the stakes are HIGH! 🎲", "Who will be crowned champion? 🏆", etc.). One mrkdwn element. The tool's appended \`actions\` block lands BETWEEN the card (#3) and this closer (#4), so the buttons sit right above your closer.

   NEVER predict when the answer will be revealed. Do NOT write phrases like "answer tomorrow", "results in 24 hours", "tune in later today", "we'll reveal soon", "stay tuned for tonight's reveal", or any other timing claim. The reveal is on a separate schedule that this run has no visibility into — guessing is wrong more often than it's right. Keep the closer focused on voting ("Cast your vote!", "Place your bets!", "Lock in your answer!") not on the reveal cadence.

   Invent a style for the header, warm-up patter, and closer each day — different each day keeps it fresh. Do NOT repeat yesterday's phrasing. Do NOT feel obligated to copy the example below. (Reminder: in MULTI-SLOT FLOW the slot-0 header is the date-stamped round opener described above, not a show banner.)

   Example — boolean FACT question (the actions block with \`[👍 TRUE, 👎 FALSE]\` is appended by \`post_questions\` between the card and the closer — do NOT include it yourself):
   \`\`\`
   [
     { "type": "header", "text": { "type": "plain_text", "text": "🎯 TRIVIA TIME!" } },
     { "type": "section", "text": { "type": "mrkdwn", "text": "Alright contestants, gather 'round — today's brain teaser is a real head-scratcher. Let's see who's been paying attention! 🧠" } },
     {
       "type": "card",
       "title": { "type": "mrkdwn", "text": "🌍 Geography" },
       "body":  { "type": "mrkdwn", "text": "[statement]" }
     },
     { "type": "context", "elements": [ { "type": "mrkdwn", "text": "Cast your vote below — the stakes are HIGH! 🎲" } ] }
   ]
   \`\`\`

   For a TOPICAL question, the card also carries a \`subtitle\` holding the localized Current News label (see step 9.3 — English \`Current News\`, French \`Actualités\`) between the title and body — everything else stays the same.

   Add game show flair to the header, patter, and closer — "Step right up!", "The stakes are high!", "Who will be crowned champion?", "Let's see who's got the smarts!" — make it entertaining, and feel free to come up with your own openers. The card itself stays clean: category title and statement, nothing else.

   ANSWER BUTTONS (appended automatically by post_questions, NOT by you):
   - \`post_questions\` reads each question's stored \`answersFormat\` and appends one \`actions\` block per item between your card (#3) and your closer (#4):
     - **boolean** → two buttons labeled \`👍 TRUE\` and \`👎 FALSE\` (TRUE first, FALSE second — order matches the boolean's \`isTrue\` mapping).
     - **choice** → \`choices.length\` buttons labeled \`1️⃣ <choice0>\`, \`2️⃣ <choice1>\`, … in the stored \`choices\` array order. The button's index IS the vote — keep the array order stable.
     - **freeform** → one \`Answer\` button that opens a Slack modal for the user to type their guess.
   - **Choice-label length cap.** \`save_question\` rejects any choice longer than 40 characters (after trim). Keep each choice label short and self-contained — if the option needs more prose to be intelligible, put the disambiguating context in the card \`body\` (e.g. "Which of these is the largest ocean?") and let the button label render just the option (1️⃣ Pacific, 2️⃣ Atlantic, …). The button label is the option text — disambiguation belongs in the body, not in the button.
   - You do NOT add a button block, an "answer options" section, or any inline "TRUE • FALSE" / "1️⃣ … • 2️⃣ …" text — the buttons ARE the affordance. Adding them yourself duplicates what the tool appends.

10. POST THE QUESTION(S):
    Build one \`{ questionId, blocks }\` item per saved question. In the SINGLE-QUESTION FLOW, that is exactly one item. In the MULTI-SLOT FLOW, the items array length equals \`slotCount\` and items MUST be in slot-index order (slot 0 first, slot 1 second, …).

    Call \`post_questions({ game: "{game}", items })\` ONCE with the full array. The tool:
    - Posts each item as its own message to the game's configured Slack channel (you do NOT pass a channel).
    - Appends an \`actions\` block with answer buttons sized to the question's \`answersFormat\` (boolean → 2 buttons, choice → \`choices.length\` buttons, freeform → 1 \`Answer\` button that opens the modal). You do NOT pass a reactions or buttons argument — the tool builds the block from the stored question record.
    - Stamps \`postedAt\`, \`messageLink\`, \`liveAnswersVisible\` (resolved per the slot → season → game → workspace → \`true\` cascade), and \`revealResponses\` (resolved per the slot → season → game → workspace → \`"yes"\` cascade) on each question record so the reveal flow can find them later.

    Check the \`results[i].ok\` field for each item in the return value. If any \`ok: false\`, the per-item error explains what went wrong.

    RETRY ON PARTIAL FAILURE: when one or more \`results[].ok === false\` come back from the call above (typical cause: Slack rejects one item's blocks with \`invalid_blocks\`), do NOT abandon the run. Build a follow-up \`post_questions\` call carrying ONLY the failed items (rebuild their blocks if the failure was due to oversized content), AND pass \`appendToPreviousBatch: true\`. That flag tells the tool to reuse the original call's \`batchId\` so the retried items reveal together with the original successes — without it the retry would land in a separate batch and the reveal would split across two cron fires. Do NOT instead try to thread a raw \`batchId\` string yourself; the flag is the only contract. The flag applies in BOTH the single-question and the multi-slot flow.

11. END THE RUN:
    Call \`submit_response({ skip_response: true })\` to terminate the run cleanly. No user-facing reply is needed — the trivia question itself is the deliverable.

The goal is to make people pause and think — aim for questions that are interesting and non-obvious, but not impossibly obscure. The exact target is \`suggestedDifficultyRange\` returned by get_ideas (the bucket's per-game-type band).`;

/**
 * Legacy combined-gen-and-post prompt. Driven by the question cron of any game that does
 * NOT have a `prepCron` configured. Behavior is unchanged from before the prep/post split:
 * Claude generates ONE batch of questions and posts them in a single cron fire. Games with
 * `prepCron` set use the new `POST_QUESTIONS_INSTRUCTIONS` (which adds a staged-pool check
 * + inline-gen fallback) for their question cron, and `PREP_QUESTIONS_INSTRUCTIONS` for the
 * prep cron.
 */
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

${PER_SLOT_GENERATION_PATHS}

${FORMAT_AND_POST_SECTION}`;

/**
 * PREP-cron prompt — gen-only, never posts. Drives the `<game>:prep` cron spec when the
 * game has `prepCron` configured. Claude reads the staged pool first, learns the format,
 * and only generates questions for slot indices that are MISSING. Terminates with
 * `submit_response({ skip_response: true })` after the last save — there is no rendering
 * step, no `post_questions` call, no Slack delivery. The cron spec is channelless AND
 * `post_questions` is excluded from its `requiredTools` list, so accidental posting is
 * structurally impossible.
 */
export const PREP_QUESTIONS_INSTRUCTIONS = `${PERSONA_TOPIC_REFERENCE}

${GAME_CONTEXT_DIRECTIVE}

Pre-stage today's trivia question(s) into the staging pool for game \`{game}\`. You will NOT post any Slack message — your only deliverable is calling \`save_question\` for each MISSING slot. The downstream question cron picks the oldest staged question per slot and posts them at fire time. If every slot is already FILLED when this run begins, the correct behavior is to NO-OP (call \`save_question\` zero times) and exit cleanly.

EACH \`save_question\` CALL IS A CHECKPOINT. Treat the per-slot save as a commit, not a deferred bookkeeping step: once slot \`i\` is persisted, its draft no longer needs to occupy your working context, and if this run dies mid-loop the saved slots survive — the next prep fire (or the post-cron's inline-gen fallback) will fill only the slots that are still missing. Saving slot-by-slot is materially cheaper than holding all drafts in context and saving at the end.

${STAGED_POOL_CHECK_AND_DISPATCH}

${CONTEXT_PRIORITY_PREAMBLE}

${PER_SLOT_GENERATION_PATHS}

=== END OF PREP RUN ===

FINAL VALIDATION (REQUIRED):
   After saving every MISSING slot identified above, re-call \`find_previous_questions({ games: ["{game}"], seasons: ["current"], posted: false, match: "all" })\` and confirm that every slot index in \`[0..slotCount-1]\` is now covered (either by the records that were already staged, or by the records you just saved). If any slot is still missing — for example because a \`save_question\` call failed mid-loop — log the gap mentally (you will not DM admins from this run) and continue to termination so the next prep fire or the question cron's inline-gen fallback can recover.

END THE RUN:
   Call \`submit_response({ skip_response: true })\` to terminate. Do NOT call \`post_questions\` — it is not in your tool allowlist for this run, and the cron is channelless, so attempting to post would fail at the SDK boundary. The trivia question records you saved (with \`postedAt\` undefined) are the deliverable.`;

/**
 * POST-cron prompt — runs at the question cron for games with `prepCron` configured.
 * Reads the staged pool, inline-generates anything that's missing, then renders and posts.
 * Equivalent to the legacy `SEND_QUESTIONS_INSTRUCTIONS` when the staged pool is empty
 * (everything gets inline-generated); equivalent to a pure picker when the staged pool is
 * complete (no generation needed, just rendering). Games WITHOUT `prepCron` continue to
 * use `SEND_QUESTIONS_INSTRUCTIONS` directly to avoid the wasted `find_previous_questions`
 * call on a pool that will always be empty.
 */
export const POST_QUESTIONS_INSTRUCTIONS = `${PERSONA_TOPIC_REFERENCE}

${GAME_CONTEXT_DIRECTIVE}

Deliver today's trivia question(s) for game \`{game}\`. Some or all of today's questions may already be PRE-STAGED in the pool (generated by an earlier prep cron); for any slot that's missing, inline-generate it here. Then assemble the message and post.

${STAGED_POOL_CHECK_AND_DISPATCH}

${CONTEXT_PRIORITY_PREAMBLE}

${PER_SLOT_GENERATION_PATHS}

${FORMAT_AND_POST_SECTION}`;

/**
 * Reveal-side prompt. A renderer brief, NOT an orchestration walkthrough.
 *
 * The deterministic work — finding the pending question, fetching reactions
 * (now commentary only, no longer used for voting), excluding the bot +
 * cheaters, scoring answers from button clicks and modal submissions, fetching
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

   The tool fetches the pending question's Slack message, excludes the bot + every flagged cheater, scores answers from the stored button clicks (boolean/choice) and modal submissions (freeform), persists them, stamps \`processedAt\`, computes the leaderboard, and — when seasons are enabled — runs season rollover on the final fire. Reactions are still fetched but ONLY as commentary, not as votes. You will NOT call \`fetch_channel_messages\`, \`find_previous_questions\`, \`get_question_history\`, \`submit_answers\`, \`retrieve_scores\`, \`check_season_status\`, or \`upsert_season\` — every one of those is now absorbed into this single tool.

   The returned payload shape:
   - \`game\`: the game's slug (internal — never surface).
   - \`reveals\`: array of reveal entries to render (length 0 = nothing pending, length 1 = today's reveal). Each entry has:
     - \`questionId\`, \`statement\`, \`category\`, \`emojis\`, \`messageLink\`.
     - \`wasReprocessed\` (boolean) — true if this was a corrective re-run (rare; affects tone slightly — acknowledge subtly without dwelling).
     - \`answer\`: \`{ type: "boolean", isTrue }\` for boolean questions; \`{ type: "choice", choices, correctIndex }\` for choice; \`{ type: "freeform", expectedAnswer, acceptableAnswers?, gradingNotes? }\` for freeform (the user typed their answer into a modal).
     - \`voters\`: a DISCRIMINATED UNION keyed on \`voters.revealResponses\` (the per-question reveal-mode stamped at post-time by \`post_questions\`). One of four variants:
       - \`{ revealResponses: "yes", correct: Voter[], incorrect: Voter[], noAnswer: Voter[], reactions: Array<{ userId, displayName, emojis: string[] }> }\` — full per-bucket detail; for FREEFORM entries, every \`Voter\` in \`correct\` and \`incorrect\` carries an additional \`answerText\` field (the user's typed answer) which you MUST QUOTE in the reveal.
       - \`{ revealResponses: "just-correctness", correct: Voter[], incorrect: Voter[], noAnswer: Voter[], reactions: Array<{ userId, displayName, emojis: string[] }> }\` — same bucket structure as \`"yes"\`, BUT freeform \`Voter\`s have NO \`answerText\` field (admin chose to hide the typed strings). You MUST NOT invent or speculate about what they typed.
       - \`{ revealResponses: "just-winners", correct: Voter[], incorrectCount: number, noAnswerCount: number, reactions: Array<{ userId, displayName, emojis: string[] }> }\` — names the \`correct\` voters ONLY (freeform winners carry \`answerText\`, which you MUST QUOTE). There are NO \`incorrect\`/\`noAnswer\` named arrays — only anonymous counts. You MUST NOT name, invent, or imply who got it wrong; use the counts for flair only ("the other 3 missed it", "everyone got fooled!").
       - \`{ revealResponses: "no", reactions: Array<{ userId, displayName, emojis: string[] }> }\` — NO per-user vote info at all; only the reaction-commentary list. You MUST NOT speculate about who voted what — render the answer + reactions + closer + leaderboard only.
     - \`reactions\` (present in all four variants) is COMMENTARY, not votes. Each entry lists every emoji a user reacted with so you can riff on it ("<@U_ALICE> piped in with 🤔🔥"). Caught cheaters are STRUCTURALLY ABSENT from every list — they never appear in correct/incorrect/noAnswer/reactions.
   - \`leaderboard\`: array of \`{ userId, displayName, totalCorrect, totalAnswered, accuracy, currentSeasonCorrect?, currentSeasonAnswered? }\` already sorted in render order.
   - \`roundSummary\` (OPTIONAL): \`{ totalQuestions, perPlayer: Array<{ userId, displayName, correct, answered, roundMvp? }> }\` — present ONLY when every entry in \`reveals\` was stamped \`revealResponses === "yes"\`. When ANY entry is \`"just-correctness"\`, \`"just-winners"\`, or \`"no"\`, \`roundSummary\` is OMITTED (the tool cannot produce per-player aggregates without per-user vote info). The multi-question layout MUST handle the missing case by skipping the Round Summary section. Already sorted (correct desc, displayName asc); already excludes cheaters; you MUST NOT recompute it from \`reveals[].voters\` yourself.
   - \`seasonStatus\` (only present when \`trivia.seasons.enabled\` is true): \`{ currentSlug, isLastFireOfSeason, seasonClosed, newSeasonStarted?, mvp? }\`. When \`isLastFireOfSeason\` is true the tool has ALREADY stamped \`endedAt\` and (when needed) created a continuation season — do NOT call \`upsert_season\`.
   - \`errors\` (optional): per-questionId structured errors from a reprocess batch. Surface a brief mention if present; otherwise omit.
   - \`instructions\` (optional string): single admin-authored rule resolved from the replace-cascade \`slot → season → game → workspace\`. Honor it verbatim throughout the reveal — apply it to verdict tone, voter-bucket commentary, the closer line, and the leaderboard introduction. Absent → ignore.
   - \`additionalInstructions\` (optional string): concatenation of admin rules from every active tier, each segment labeled (\`[Workspace]\` / \`[Game]\` / \`[Season]\` / \`[Slot N]\`) separated by blank lines. EVERY labeled rule applies simultaneously throughout the reveal. Lower-tier rules are more situational than higher-tier ones but never replace them. Absent → ignore. These rules are NOT visible to viewers — don't echo them back, just apply them silently.
   - STRUCTURE IS PRESERVED BY DEFAULT for both fields above. The reveal is built from independent, individually-addressable parts (the verdict \`header\` + explanation \`section\`, the per-bucket voter-commentary sections, the closer \`context\`, and the leaderboard \`table\` argument). For each admin rule, decide whether it EXPLICITLY calls for a structural change (add, remove, replace, or reorder a part — including omitting the leaderboard table):
     - NO (e.g. "keep the verdict punchy", "be warmer to the losers") → keep the reveal layout EXACTLY as specced below and apply the rule only to the content/tone of the part(s) it names — or to overall tone when it names no specific part. A rule naming one part changes ONLY that part; it does not touch its siblings. A tone or length rule is NEVER a license to drop a section or skip the leaderboard table.
     - YES (e.g. "don't include the leaderboard table", "skip the per-voter breakdown") → make EXACTLY that structural change and nothing more; the explicit rule wins over the default layout. To drop the leaderboard table, omit the \`table\` argument to \`submit_response\` entirely. Every other part keeps its default structure.

   If \`reveals\` is empty (no pending question / no batch to reveal), POST NOTHING. Do NOT render an acknowledgement, and do NOT render the leaderboard — a silent skip is better than a "nothing to reveal" message. Terminate the run immediately with \`submit_response({ skip_response: true })\` (see the \`reveals.length === 0\` branch in step 2).

2. RENDER VIA \`submit_response\` USING THE GAME SHOW PRESENTER VOICE:

   The block layout BRANCHES on \`reveals.length\`:

   - \`reveals.length === 0\`: POST NOTHING. Call \`submit_response({ skip_response: true })\` to terminate the run cleanly — no acknowledgement, no leaderboard, no blocks. There was no batch to reveal, and a silent skip is the desired outcome.
   - \`reveals.length === 1\`: SINGLE-QUESTION layout (described immediately below). Use the verdict header + explanation + per-bucket sections appropriate to the entry's \`voters.revealResponses\` mode. The top-level \`roundSummary\` field is IGNORED in this branch.
   - \`reveals.length > 1\`: MULTI-QUESTION layout (see below the single-question section). Use brief per-question verdicts; when \`roundSummary\` is present, follow them with a "Round Summary" section sourced from \`roundSummary.perPlayer\`. When \`roundSummary\` is absent (any entry is non-\`"yes"\` mode), skip the Round Summary block entirely.

   === SINGLE-QUESTION LAYOUT (when reveals.length === 1) ===

   Build a Block Kit message (Clack's curated subset: divider, header, section, context, image, markdown, card, carousel). Use this layout:

   - \`header\` block — \`text: { type: "plain_text", text: "..." }\`. Announce the verdict (e.g. "🎯 THE ANSWER IS TRUE!", "🎲 IT'S FALSE!" for boolean; "🎯 THE ANSWER IS C!" or similar for choice; for FREEFORM: "🎯 THE ANSWER WAS PARIS!" / "✏️ THE ANSWER: 1492!" — quote the canonical \`answer.expectedAnswer\`). plain_text only, no \`*bold*\`. Vary the wording each day.
   - \`section\` block (mrkdwn) — explain WHY the statement is true/false (boolean) or which choice was correct + why (choice). For FREEFORM, summarize the expected answer in one short factual sentence and (when \`answer.acceptableAnswers\` was populated) note that variants were accepted. Apply the REVEAL TONE from the \`trivia\` topic of your system instructions.
   - \`divider\` block — paces the reveal.
   - **Per-bucket sections — BRANCH ON \`reveals[0].voters.revealResponses\`.** Skip empty arrays entirely in every branch (no placeholders, no "nobody here" lines).
     - **\`"yes"\` mode** — render up to four sections (CORRECT / INCORRECT / NO-ANSWER / REACTIONS), one per non-empty array:
       - CORRECT voters — celebrate with \`<@USERID>\` mentions. For FREEFORM entries, INCLUDE each voter's typed answer in quotes: "<@U_ALICE> said *Paris* — bullseye!" Quote multiple distinct answers when they appeared.
       - INCORRECT voters — acknowledge with game-show charm. For FREEFORM, quote each voter's typed text so they see what was rejected: "<@U_BOB> hedged with *Paris or London* — the judge doesn't accept shotgun guesses!"
       - NO-ANSWER voters (anyone in \`voters.noAnswer\`) — a playful nudge ("<@U_CAROL> kept their cards close — no vote logged.").
       - REACTIONS commentary (when \`voters.reactions\` is non-empty) — ONE section listing each reactor by display name with the emoji set they used ("<@U_DAVE> piped in with 🤔🔥, <@U_EVE> dropped a 👀"). Reactions are NOT votes — frame them as color/commentary on the round.
     - **\`"just-correctness"\` mode** — same four-section structure as \`"yes"\`, BUT freeform \`Voter\`s in \`correct\`/\`incorrect\` do NOT carry \`answerText\`. Name them only — DO NOT invent or speculate about what they typed. The admin chose to suppress the typed strings; respect that.
     - **\`"just-winners"\` mode** — render at most three sections, in order: (1) a CORRECT section naming \`voters.correct\` and celebrating them (quote freeform \`answerText\` when present); SKIP it when \`correct\` is empty. (2) an anonymous MISS line derived from \`voters.incorrectCount\` + \`voters.noAnswerCount\` — e.g. "(3 others fell for it)" or, when \`correct\` is empty and \`incorrectCount > 0\`, an "everyone got fooled / nobody nailed it this time" closer; SKIP entirely when both counts are 0. You MUST NOT name, invent, or imply WHO missed — the payload carries no misser names, only counts. (3) the REACTIONS commentary section when \`voters.reactions\` is non-empty (same framing as \`"yes"\`).
     - **\`"no"\` mode** — render NO per-bucket sections at all. After the divider, jump straight to (optional) reactions commentary if \`voters.reactions\` is non-empty, then the closer + leaderboard. You MUST NOT speculate about who voted what — the payload carries no per-user vote info for this question.
   - When \`seasonStatus.isLastFireOfSeason\` is true: insert ONE additional \`section\` block above the closer that names the closing season's slug (from \`seasonStatus.currentSlug\`) and calls out the MVP (from \`seasonStatus.mvp\`). Apply the SEASON-FINALE TONE from the \`trivia\` topic of your system instructions for the wrap-up wording. Do NOT preview the new season's slug — leave that for a future fire to announce.
   - \`context\` block — short closer ("That's a wrap! Here's the running scoreboard:") leading into the leaderboard. Do NOT predict timing — the next reveal is on a separate schedule you have no visibility into.

   === MULTI-QUESTION LAYOUT (when reveals.length > 1) ===

   When the active season has a format, a single cron fire posts N questions and one reveal must cover all of them. The verbose per-voter-bucket layout multiplies badly, so use this compressed shape instead:

   - One \`header\` block — \`text: { type: "plain_text", text: "..." }\`. Introduce the multi-question reveal (e.g. "🎯 ROUND RECAP — N QUESTIONS!", "🏆 THE VERDICTS ARE IN!", etc.). Vary the wording. plain_text only.
   - One \`section\` block PER question (in the same order as \`reveals\`). Keep each one BRIEF — ≤ 2 short sentences. Open with the verdict label (e.g. "Q1: ✅ TRUE!" or "Q3: 🎯 The answer was 'Tokyo'!" or for freeform "Q2: ✏️ The answer: *Paris*"). The voter teaser depends on the entry's \`voters.revealResponses\`:
     - **\`"yes"\` or \`"just-correctness"\`** — follow the verdict label with a single-line voter teaser ("Alice and Bob nailed it; Carol fell for the trap"). For FREEFORM \`"yes"\` entries the teaser MAY quote one or two notable typed answers; for \`"just-correctness"\` entries name-only — do NOT invent text content.
     - **\`"just-winners"\`** — follow the verdict label naming \`voters.correct\` only ("Alice and Bob nailed it"), optionally tagging an anonymous miss count from \`incorrectCount\`/\`noAnswerCount\` ("…the other 3 missed it"); when \`correct\` is empty use an "everyone missed it" line. NEVER name or imply who got it wrong.
     - **\`"no"\`** — the brief verdict line stands on its own. Do NOT name voters or describe who got it right — the payload carries no per-user info for this question. ("Q3: 🎯 The answer was 'Tokyo'." — full stop.)
     - Do NOT enumerate every voter individually in any mode — that's what the Round Summary is for when it's present.
   - One \`divider\` block — separates the verdicts from the summary.
   - **Round Summary section — GATED on \`roundSummary\` presence.** When \`roundSummary\` is present (every entry is \`"yes"\` mode), render ONE \`section\` block titled "🏆 Round Summary" (or similar): list each player from \`roundSummary.perPlayer\` IN ORDER as \`<@USERID>: <correct>/<totalQuestions>\` (or any in-persona phrasing). Prefix every entry whose \`roundMvp: true\` is set with \`🏆\` (e.g. "🏆 <@U123>: 3/3"). DO NOT recompute the counts — read them straight from \`roundSummary.perPlayer\`. DO NOT add players who aren't in \`perPlayer\` (the tool already filters out anyone who didn't answer this round). When \`roundSummary\` is ABSENT (any entry in this round is \`"just-correctness"\`, \`"just-winners"\`, or \`"no"\`), SKIP this Round Summary block entirely — the per-question verdicts and the cumulative leaderboard table below carry the closer on their own.
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

   === TABLE PARAMETER (single-question, multi-question, AND empty-reveals layouts) ===

   PLUS, alongside \`blocks\`, set the top-level \`table\` parameter rendering the leaderboard. CRITICAL: \`table\` is a SIBLING of \`blocks\` on the \`submit_response\` call, NOT a member of the \`blocks\` array — Block Kit rejects \`{ "type": "table" }\` inside \`blocks\`, and the message will ship with no scoreboard if you put it there. The shape is \`submit_response({ blocks: [...], table: { type: "table", rows: [...], column_settings: [...] }, actions: [...] })\`.

   "THIS ROUND" ROW — gated on \`reveals.length > 1\` AND \`roundSummary\` presence:

   When \`reveals.length > 1\` AND \`roundSummary\` is present in the payload, PREPEND a \`This Round\` row to the leaderboard table immediately ABOVE the \`Current Season\` / \`All Time\` rows. Source the per-player counts from \`roundSummary.perPlayer\` (the same array the Round Summary section reads): for each player column, look up the entry by \`userId\` and render \`String(correct)\`. Players who appear on the leaderboard (i.e., have a column) but are ABSENT from \`roundSummary.perPlayer\` (didn't answer this round) — render the literal Unicode em-dash \`"—"\`. The empty string \`""\` is FORBIDDEN here: Slack rejects empty raw_text cells with \`invalid_blocks\`. Apply medal prefixes (\`"🥇 "\`, \`"🥈 "\`, \`"🥉 "\`, \`"🎀 "\`) ONLY to cells where \`correct > 0\`, ranked top-4 by \`roundSummary.perPlayer\` array order (already pre-sorted by the reveal tool). Cells with \`correct === 0\` and em-dash cells receive NO medal — under no circumstances does an em-dash or a zero get a 🎀 to fill a top-4 slot.

   The \`This Round\` row is OMITTED in three cases (use the legacy shapes below): (a) \`reveals.length === 1\` — single-question reveal; (b) \`reveals.length === 0\` — empty-reveals acknowledgement; (c) \`reveals.length > 1\` AND \`roundSummary\` is ABSENT (the latter happens whenever any reveal entry's \`revealResponses\` is \`"just-correctness"\`, \`"just-winners"\`, or \`"no"\` — the same gate that drops the Round Summary section block above). The Round Summary section block and the \`This Round\` row share that gate; they ship together or skip together.

   FOUR RENDERING SHAPES (gated on \`seasonStatus.hasPriorSeasons\` × whether \`This Round\` is rendered):

   - WHEN \`seasonStatus\` IS PRESENT AND \`seasonStatus.hasPriorSeasons\` IS \`true\` (seasons enabled, a current season is active, AND at least one answer belongs to a different season):

     - **Legacy 3-ROW DUAL-TOTALS TABLE** — applies to single-question reveals, empty-reveals acknowledgements, AND multi-question reveals where \`roundSummary\` is absent:
       - Row 1: top-left label cell containing a single space \`" "\` (Slack rejects empty raw_text cells with \`invalid_blocks\`), then one cell per player with their \`displayName\` (NO medal prefix on this row).
       - Row 2: left cell \`"Current Season"\`, then one cell per player with \`String(currentSeasonCorrect)\`. Apply medal prefixes \`"🥇 "\`, \`"🥈 "\`, \`"🥉 "\`, \`"🎀 "\` (Unicode characters, NOT \`:first_place_medal:\`/\`:ribbon:\` shortcodes — shortcodes render as literal text inside table cells) to the cells holding the top-4 \`currentSeasonCorrect\` values among present players (🎀 = 4th place).
       - Row 3: left cell \`"All Time"\`, then one cell per player with \`String(totalCorrect)\`. Apply medal prefixes to the top-4 \`totalCorrect\` values among present players — INDEPENDENT of the current-season ranking.

     - **4-ROW DUAL-TOTALS TABLE** — applies to multi-question reveals where \`roundSummary\` IS present:
       - Row 1: same as legacy 3-row Row 1 (label cell \`" "\` + per-player \`displayName\` cells, no medals).
       - Row 2 (NEW — \`This Round\`): left cell \`"This Round"\`, then per-player cells per the "This Round" row policy above. Medal prefixes apply only to cells where \`correct > 0\`, top-4 by \`roundSummary.perPlayer\` order; em-dash for players absent from \`perPlayer\`.
       - Row 3: same as legacy 3-row Row 2 (\`"Current Season"\` + per-player \`currentSeasonCorrect\` with independent top-4 medals).
       - Row 4: same as legacy 3-row Row 3 (\`"All Time"\` + per-player \`totalCorrect\` with independent top-4 medals).

     Shared rules across both shape variants under this gate:
     - Player columns: only include leaderboard entries where \`currentSeasonCorrect > 0\` OR \`currentSeasonAnswered > 0\`. Omit anyone with zero current-season participation. The \`This Round\` row inherits this same column set (no column may exist in one row and be missing in another — Slack tables require uniform row widths).
     - Fewer than 4 present players → assign medals only for whichever positions exist, on each row INDEPENDENTLY.
     - \`column_settings\`: one \`{ "align": "center" }\` entry per column (label column + each player column).

     Example shape — legacy 3-row, 2 present players (single-question OR multi-question without \`roundSummary\`):
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

     Example shape — 4-row, 3 present players (multi-question with \`roundSummary\` present; Carol is on the leaderboard but did not answer this round, so her \`This Round\` cell is the em-dash):
     \`\`\`
     {
       "blocks": [ /* header, per-question verdicts, divider, Round Summary section, closer context — see above */ ],
       "table": {
         "type": "table",
         "rows": [
           [" ",              "Alice",    "Bob",     "Carol"],
           ["This Round",     "🥇 2",     "🥈 1",    "—"    ],
           ["Current Season", "🥇 5",     "🥈 3",    "🥉 1" ],
           ["All Time",       "🥈 9",     "🥇 12",   "🥉 4" ]
         ],
         "column_settings": [
           { "align": "center" }, { "align": "center" }, { "align": "center" }, { "align": "center" }
         ]
       },
       "actions": []
     }
     \`\`\`

   - WHEN \`seasonStatus\` IS ABSENT (seasons disabled or in a gap), OR WHEN \`seasonStatus.hasPriorSeasons\` IS \`false\` (only one season has ever had activity, so "All Time" would duplicate "Current Season"):

     - **Legacy 2-ROW TABLE** (NO label column) — applies to single-question reveals, empty-reveals acknowledgements, AND multi-question reveals where \`roundSummary\` is absent:
       - Row 1: one cell per player with their \`displayName\` (NO medal prefix on this row, NO leading label cell).
       - Row 2: one cell per player with \`String(totalCorrect)\`. Apply medal prefixes \`"🥇 "\`, \`"🥈 "\`, \`"🥉 "\`, \`"🎀 "\` (Unicode characters, NOT \`:first_place_medal:\`/\`:ribbon:\` shortcodes — shortcodes render as literal text inside table cells) to the cells holding the top-4 \`totalCorrect\` values (🎀 = 4th place).

     - **3-ROW LABELED TABLE** (NEW label column) — applies to multi-question reveals where \`roundSummary\` IS present. This shape gains a left-side label column that the legacy 2-row shape lacks; the column is necessary because the \`This Round\` and \`All Time\` rows now need named labels.
       - Row 1: top-left label cell containing a single space \`" "\` (Slack rejects empty raw_text cells with \`invalid_blocks\`), then one cell per player with their \`displayName\` (NO medal prefix on this row).
       - Row 2 (NEW — \`This Round\`): left cell \`"This Round"\`, then per-player cells per the "This Round" row policy above. Medal prefixes apply only to cells where \`correct > 0\`, top-4 by \`roundSummary.perPlayer\` order; em-dash for players absent from \`perPlayer\`.
       - Row 3: left cell \`"All Time"\`, then one cell per player with \`String(totalCorrect)\` and top-4 medals on the \`totalCorrect\` values.

     Shared rules across both shape variants under this gate:
     - Fewer than 4 players → assign medals only for whichever positions exist, on each row INDEPENDENTLY.
     - \`column_settings\`: one \`{ "align": "center" }\` entry per column (and when the labeled variant ships, the label column counts as one of those entries).

     Example shape — legacy 2-row, 4 players (single-question OR multi-question without \`roundSummary\`):
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

     Example shape — 3-row labeled, 3 players (multi-question with \`roundSummary\` present; Carol did not answer this round → em-dash):
     \`\`\`
     {
       "blocks": [ /* header, per-question verdicts, divider, Round Summary section, closer context */ ],
       "table": {
         "type": "table",
         "rows": [
           [" ",          "Alice",    "Bob",     "Carol"],
           ["This Round", "🥇 2",     "🥈 1",    "—"    ],
           ["All Time",   "🥇 11",    "🥈 8",    "🥉 6" ]
         ],
         "column_settings": [
           { "align": "center" }, { "align": "center" }, { "align": "center" }, { "align": "center" }
         ]
       },
       "actions": []
     }
     \`\`\`

   If the leaderboard is empty (nobody has participated yet), OMIT the \`table\` parameter entirely. Otherwise the table MUST be present — a reveal closer that mentions the scoreboard without a populated table is a visible bug.

Slack mechanics: mention users with \`<@USERID>\`; \`*bold*\` does NOT render inside \`plain_text\` headers (emojis do); use mrkdwn sparingly elsewhere — emoji and energy do most of the work.

NEVER predict timing — no "see you tomorrow", "next reveal in 24 hours", or similar. The next fire is on a separate schedule you have no visibility into.`;

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
