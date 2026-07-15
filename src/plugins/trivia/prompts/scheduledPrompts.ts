/**
 * Prompt text returned by the plugin's scheduled-run instruction tools.
 * Each `*_INSTRUCTIONS` constant below is the full on-demand prompt that Claude
 * receives when the matching tool is invoked.
 */

import { t } from "../i18n/t.js";

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
 * Shared gates referenced by every generation path. Printed ONCE at the top of
 * `PER_SLOT_GENERATION_PATHS`; each path's step says "apply the X GATE" instead of
 * restating the body. Done to shrink the rendered prompt without losing nuance.
 */
const DUPLICATE_CHECK_GATE = `DUPLICATE CHECK GATE (shared across all paths — invoke whenever a path step says "apply the DUPLICATE CHECK GATE"):
   - Call \`find_previous_questions({ keywords: [...], match: "any" })\`. The keyword set is NOT optional and MUST include BOTH of these two terms, plus 1-3 more distinctive words (names, numbers, rare nouns):
     1. The PRIMARY SUBJECT — the specific entity the question HINGES on, i.e. the part that VARIES within its category, NOT the template words the whole category shares. For the category "country that is a primary producer of X", the subject is \`X\` itself (e.g. \`coffee\`) — NOT "country", "primary", or "producer", which every question in that category contains and which therefore can never discriminate a repeat. For "is Mount Everest the tallest mountain?", the subject is \`Everest\`.
     2. The ANSWER — the correct response as a search term (the country/person/place/thing for choice & freeform; the claim's subject for boolean). Include it to WIDEN the candidate net: the search matches choice options, freeform answer text, and image subject titles too, so the answer term surfaces prior questions the statement words alone would miss. But the answer is a RECALL AID, NOT a duplication verdict — a prior row sharing the same answer in a DIFFERENT context (a different subject or framing) is NOT a duplicate. Judge duplication by the subject and framing, never by the answer alone.
   - OMIT the \`games\` argument so the scan spans every game (a duplicate fact in a sibling game still counts).
   - For each returned row, inspect \`matchedKeywords\` and the row's \`statement\` to decide whether it covers the SAME underlying fact in any framing or polarity (a TRUE statement and a FALSE statement about the same fact are still duplicates).
   - If the result set is uninformatively wide (many rows hitting only a common word), re-call with sharper keywords while always keeping the PRIMARY SUBJECT in the set.
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
   - BOOLEAN paths: dial difficulty by PLAUSIBILITY, not obscurity — too easy → make the statement more subtly either-way (a subtler swap, less obviously true/false); too hard → make it more recognizable (a more familiar claim, or a more clearly-off swap). Do NOT raise boolean difficulty by reaching for a more obscure fact. Then IMMEDIATELY re-run the POLARITY SELF-CHECK on the reframed statement BEFORE re-rating. Reframing-by-detail-swap can silently flip a TRUE statement to FALSE — the polarity gate is what catches this. If polarity fails on the reframe, REJECT and re-call get_ideas (you've burned your retry; don't try a second reframe).
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

const POINTS_GATE = `POINTS GATE (shared across all paths — invoke whenever a path's SAVE step says "apply the POINTS GATE"):
   - If \`get_ideas\` returned NO \`maxPoints\`: OMIT the \`points\` field on \`save_question\`. The question is worth 1, like every other. Skip the rest of this gate — do NOT infer a cap from anywhere else, and do NOT treat a hard question as grounds to invent one.
   - If \`get_ideas\` returned \`maxPoints\` (it always comes with \`pointsGuidance\`): choose an integer in \`[1, maxPoints]\` and pass it as \`points\`.
     1. READ \`pointsGuidance\` — it is the admin's rule for this game, and it is the ONLY thing that justifies a value above 1. Follow it literally (e.g. "easy 1, hard 3" means map the difficulty you actually landed on in the DIFFICULTY GATE, not the one you aimed at).
     2. DEFAULT TO 1. \`maxPoints\` is a ceiling, not a target or an expectation. If the guidance does not clearly call for more on THIS question, pass 1 (or omit \`points\` — identical meaning). A normal question at 1 point is the expected outcome, not a failure to use the axis.
     3. NEVER spend points for reasons the guidance doesn't name — not to make a slot feel special, not because the topic is interesting, not to vary the board.
     4. The value you pass is what the question PAYS on the leaderboard and what players see on the card ("Worth N points"), so it must be defensible from the guidance alone.`;

const EMOJI_SELECTION_GATE = `EMOJI SELECTION GATE (shared across all paths — invoke whenever a path step says "apply the EMOJI SELECTION GATE"):
   The \`emojis\` you pick render into the card title at QUESTION time as \`<emoji> <Category>\` — BEFORE anyone votes. They decorate the CATEGORY, nothing more. So pick emojis for the category, never for the answer or the question's specific subject.
   - HARD CONSTRAINT: no emoji may depict, encode, or hint at the answer or the specific thing the question is about. A topic-literal emoji that lets a player read the answer off the card is a SPOILER and is forbidden.
     - ❌ "What colors are on Ecuador's flag?" → 🇪🇨 (the flag literally shows the colors)
     - ❌ "What's the fastest land animal?" → 🐆 (names the answer)
     - ❌ "How many sides does a stop sign have?" → 🛑 (the octagon reveals the count)
   - DO: stay at the CATEGORY level or go generic — 🌍 / 🏳️ for a geography/flag question, 🐾 for an animal question, 🪧 for a road-sign question. Same principle the visual paths already apply to \`media.altText\` ("a national flag", not "the flag of Ecuador").
   - Quick self-check before saving: "Could a player narrow down or read the answer off any of these emojis?" If yes for any emoji, swap it for a category-level or generic one.`;

const PUZZLE_QUALITY_GATE = `PUZZLE QUALITY GATE (shared across all paths — invoke whenever a path's step says "apply the PUZZLE QUALITY GATE"). Before saving, STOP and REASON about the question as a puzzle — write out your judgment for each check, don't just assert "pass." If a check fails, fix it; if you can't fix it, RE-ROLL — re-rolling beats shipping a weak question.
   1. SOLVABLE BY KNOWING, NOT GUESSING. A knowledgeable player must be able to REASON to the answer. The truth must NOT hinge on recalling an isolated datum disconnected from understanding — an exact year, a raw figure, a one-off statistic, or (for choice) a set of options that are all years or close numbers.
      - DON'T: "The Berlin Wall fell in 1989." (T/F — just remembering a number) / "In what year did X happen? A) 1972 B) 1976 C) 1980" (a memory test).
      - DO: "The Berlin Wall fell during the Reagan administration." (T/F) / ask WHO / WHAT / WHERE / WHY / the consequence — things a player can reason about. If a category only yields date-anchored facts, re-roll the category rather than writing a year question.
   2. NO SURFACE TELL. Strip the truth value and read it cold: phrasing, specificity, length, or confidence must NOT tilt a clueless player toward the answer. boolean — a TRUE and a FALSE framing of this fact must read equally plausible (don't let an over-specific statement read as obviously true); choice — the correct option must not stand out from the distractors in length, specificity, or confidence; freeform — the prompt must not telegraph the answer.
   3. DOUBT FITS THE DIFFICULTY. The answer must be genuinely ambiguous on the surface yet resolvable by a player with relevant knowledge and reasoning. Difficulty comes from that doubt, NEVER from obscurity or memorization — a harder question is more plausibly either-way, not about a rarer fact.
   4. FLAVOR NEVER LEAKS. Surfaced non-question text (patter, subtitle, emojis, hint, alt text) must not narrow or reveal the answer. This is enforced in full by the NO-SPOILER GATE at post time — just confirm here that nothing you've drafted leaks.
   5. WORTH CARING ABOUT. The subject should be something the audience would find interesting or relevant (for topical, genuinely salient) — not a "who cares" datum.`;

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

7. Choose 1-4 emojis: apply the EMOJI SELECTION GATE (shared definition above).

8. HINT (optional): apply the HINT DRAFTING GATE (shared definition above). When \`suggestedHintMode\` is non-\`"none"\`, the gate produces an optional \`hint\` field to include in the save_question call below.

9. PUZZLE QUALITY GATE: apply the PUZZLE QUALITY GATE (shared definition above) — reason through all five checks; revise or re-roll on failure.

10. SAVE TO DATABASE:
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
     - points: apply the POINTS GATE (shared definition above) — include only when it produced a value above 1; omit otherwise
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
     - suggestedChoiceEmojiStyle ("numbers" | "themed"): whether the vote buttons get the standard numbered prefixes or per-option themed emojis you pick. Used at step 6b.
     - contextPriority (optional, only when contexts are configured): see CONTEXTS guidance above.
   - Pick one category from categories.ideas.

2. WRITE THE CORRECT ANSWER FIRST (REQUIRED — NEVER SHIFT THE CORRECT POSITION):
   - Research a verified true fact about the topic and write the correct option text FIRST. This option will occupy the index named by suggestedCorrectIndex. The correct answer's POSITION is LOCKED — you MUST NOT rewrite or swap the correct answer later to fix a gate failure, because that defeats the server-rolled suggestedCorrectIndex (which is what keeps the leaderboard fair).
   - Then write (suggestedChoiceCount − 1) plausible-but-wrong distractors. Each distractor should be a confident-sounding but incorrect option a knowledgeable person could be tempted by — not joke filler.

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

6. Choose 1-4 emojis: apply the EMOJI SELECTION GATE (shared definition above).

6b. CHOICE BUTTON EMOJIS (only when \`suggestedChoiceEmojiStyle\` is \`"themed"\`): follow the \`choiceEmojiGuidance\` from get_ideas — pick ONE unique Unicode emoji per option (actual emoji characters, never :shortcodes:), each evoking ITS OWN option's subject so the set gives away nothing about which is correct. These prefix the vote buttons and label the live answer roster. If no fitting set exists, skip this step (buttons fall back to numbered prefixes). When the style is \`"numbers"\`, skip this step and do NOT pass \`choiceEmojis\`.

7. HINT (optional): apply the HINT DRAFTING GATE (shared definition above). When \`suggestedHintMode\` is non-\`"none"\`, the gate produces an optional \`hint\` field to include in the save_question call below.

8. PUZZLE QUALITY GATE: apply the PUZZLE QUALITY GATE (shared definition above) — reason through all five checks; revise or re-roll on failure.

9. SAVE TO DATABASE:
   - Call save_question with:
     - answersFormat: "choice"
     - questionType: "fact"
     - category (the one you picked from get_ideas)
     - statement (a single-sentence question prompt — what is being asked)
     - choices (array of suggestedChoiceCount strings — the correct answer at suggestedCorrectIndex, distractors at the other positions)
     - correctIndex (MUST equal suggestedCorrectIndex)
     - choiceEmojis (only when step 6b produced a set; omit otherwise)
     - emojis (array of 1-4 emoji strings)
     - suggestedDifficulty (the bucket from get_ideas in step 1)
     - difficulty (your 1–10 self-rating from step 5)
     - context (only when a non-empty contextPriority entry was used; omit otherwise)
     - hint (only when the HINT DRAFTING GATE produced one; omit otherwise — see the gate for shape)
     - points: apply the POINTS GATE (shared definition above) — include only when it produced a value above 1; omit otherwise
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
   - SALIENCE BAR: pick an event the general audience (this workspace's members) would recognize as genuinely newsworthy and interesting — trending, breaking, or widely-reported — not a niche item only specialists track, so a knowledgeable player has a reasoning foothold. Prefer SALIENCE over recency: a widely-reported event from the past week beats a trivial one from this morning.
   - Pick ONE specific newsworthy event from the results to anchor the question on. Capture:
     - \`sourceUrl\`: the most authoritative URL that supports the claim (must begin with https://).
     - \`eventDate\` (optional but encouraged): the ISO 8601 date (YYYY-MM-DD) the event occurred, when easy to determine.
   - If the current lens (contextPriority[0]) yielded no usable event, descend per the CONTEXTS guidance. If no lens yields an event that clears the SALIENCE BAR, FALL BACK to the fact path for the same answersFormat (preferred — it keeps the slot productive); re-call get_ideas only if the fact path is unsuitable. Do NOT force an obscure event.

2. ANCHOR THE QUESTION/ANSWER ON THE EVENT. The statement (boolean), correct option (choice), or canonical \`expectedAnswer\` (freeform) is derived from the event you captured. Per-shape topical levers (apply alongside the fact path's statement-writing step):
   - **BOOLEAN paths**: for FALSE statements, swap exactly ONE element of the event's SUBSTANCE — the person, the place, what-happened, or the consequence — to something plausibly incorrect; or assert a tempting misconception the actual reporting contradicts. NEVER make it false by swapping a date or a number: the "Current News" frame already asserts recency and the statement carries no date stamp, so a date/number swap contradicts the frame and degrades the question into a recall-only test rather than a reasoning one.
   - **CHOICE paths**: distractors drawn from the same news domain work well (other people in the story, other recent similar events, related-but-wrong dates/places/numbers). WebSearch payloads love surfacing the runner-up / co-star / opponent adjacent to the winner — that detail is exactly the wrong thing to keep in the statement when you also list it as an option, so apply the STATEMENT-CHOICES NON-OVERLAP GATE accordingly.
   - **FREEFORM paths**: no shape-specific change beyond anchoring the answer on the event.

3. DUPLICATE CHECK uses event-derived keywords. Apply the DUPLICATE CHECK GATE as usual, but pick keywords from the event itself (names, places, dates from the news story). If the same event was already asked about — even with different polarity, framing, or angle — pick a different event from your WebSearch results (or re-search).

4. SAVE DELTAS (added to the fact path's save_question call):
   - questionType: "topical" (instead of "fact")
   - sourceUrl (REQUIRED — the https:// URL captured in step 1)
   - eventDate (optional — YYYY-MM-DD when known)
   All other save fields (\`answersFormat\`, category, statement, isTrue/choices/correctIndex/expectedAnswer + acceptableAnswers + gradingNotes + freeformAnswerShape, emojis, suggestedDifficulty, difficulty, context, slot) are identical to the corresponding fact-path save.`;

/**
 * Prediction modifier: when `suggestedQuestionType === "prediction"`, the question is
 * about an UPCOMING event whose outcome is unknown at write time, so it is saved WITHOUT
 * an answer key and settled later. Mirrors TOPICAL_MODIFIER's structure (WebSearch step +
 * save deltas) but the answer-key gates are skipped and the key fields are OMITTED.
 */
const PREDICTION_MODIFIER = `When the rolled \`suggestedQuestionType\` is \`"prediction"\`, apply this modifier ON TOP OF the answer-shape path body (boolean / choice / freeform). A prediction asks about an UPCOMING real-world event whose outcome is NOT yet known — so it is SAVED WITHOUT AN ANSWER KEY and settled at reveal time via \`settle_question\`.

1. RESEARCH AN UPCOMING EVENT VIA WebSearch (NEW STEP — REQUIRED — runs before the path body's statement step):
   - Search for a SCHEDULED/upcoming event in the chosen category whose outcome resolves SOON (before this game's reveal cron) and is objectively checkable afterward — a match result, a vote tally, a release, an official announcement. Capture the schedule/fixture \`sourceUrl\` and (optionally) \`eventDate\`.
   - The outcome MUST be genuinely unknown right now AND knowable by reveal time. REJECT events that won't resolve before the reveal, or whose result would be subjective/disputable.
2. WRITE THE QUESTION ABOUT THE FUTURE OUTCOME — but DO NOT decide the answer:
   - BOOLEAN: a claim that will be TRUE or FALSE once the event happens ("Brazil will beat Argentina tomorrow"). DO NOT run the POLARITY SELF-CHECK and DO NOT pass \`isTrue\` — the truth value is unknown.
   - CHOICE: write the option set covering the possible outcomes ("Brazil" / "Argentina" / "Draw"). Honor \`suggestedChoiceCount\`, but DO NOT pass \`correctIndex\` (no plausibility gate — there are no "distractors", every option is a real outcome).
   - FREEFORM: write the prompt + pass through \`freeformAnswerShape\`; DO NOT pass \`expectedAnswer\`/\`acceptableAnswers\`/\`gradingNotes\` (the canonical answer is prepared at settle time).
3. GATES: the DIFFICULTY GATE and DUPLICATE CHECK GATE apply to the QUESTION framing as usual. The answer-key gates (POLARITY SELF-CHECK, DISTRACTOR PLAUSIBILITY GATE) DO NOT apply — there is no known answer to check yet.
4. SAVE DELTAS (vs the fact path's save_question call):
   - questionType: "prediction" (instead of "fact")
   - sourceUrl (REQUIRED — the upcoming-event URL); eventDate optional.
   - OMIT the answer key entirely: no \`isTrue\` (boolean), no \`correctIndex\` (choice), no \`expectedAnswer\`/\`acceptableAnswers\`/\`gradingNotes\` (freeform). \`save_question\` stamps \`resolved: false\`.
   The question is NOT scorable until \`settle_question\` provides the outcome at reveal time.`;

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

8. Choose 1-4 emojis: apply the EMOJI SELECTION GATE (shared definition above).

9. HINT (optional): apply the HINT DRAFTING GATE (shared definition above). When \`suggestedHintMode\` is non-\`"none"\`, the gate produces an optional \`hint\` field to include in the save_question call below.

10. PUZZLE QUALITY GATE: apply the PUZZLE QUALITY GATE (shared definition above) — reason through all five checks; revise or re-roll on failure.

11. SAVE TO DATABASE:
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
     - points: apply the POINTS GATE (shared definition above) — include only when it produced a value above 1; omit otherwise
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
- \`format.flexible: true\` (on the multi-slot \`format\` above) → \`slotCount\` is a CEILING, not a mandate. Fill a PREFIX of the slots — see FLEXIBLE PREFIX at the end of this loop.

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

Repeat until every slot index in \`[0..slotCount-1]\` is covered (either FILLED from the pool or freshly saved).

FLEXIBLE PREFIX (ONLY when \`format.flexible: true\`): the loop fills a PREFIX, not every slot. Walk slot indices in order. A slot is SATISFIED when it is FILLED from the staged pool OR you freshly generate a question that PASSES the quality gates. At the FIRST slot that is neither — i.e. it is MISSING from the pool AND you cannot produce a question that passes the gates (no fresh/usable material for this slot) — STOP the loop immediately: do NOT force a weak question, and do NOT skip ahead to a later slot. The fire posts only the slots already SATISFIED below that index (indices \`0..i-1\`). If the FIRST uncovered slot (lowest missing index, normally slot 0) yields no usable question, save nothing — the fire posts ZERO questions and the day is skipped (post_questions is not called; terminate per the POST step's zero-question handling). A flexible fire therefore posts anywhere from 0 to \`slotCount\` questions.`;

/**
 * The six per-slot generation paths (FACT × BOOLEAN/CHOICE/FREEFORM and TOPICAL × same).
 * Shared verbatim between PREP and POST — both prompts include this content as the
 * substantive generation guidance for any slot that needs to be freshly written.
 */
/**
 * Image-medium gates + the shared subject-discovery subflow. The six visual paths
 * (image × {boolean, choice, freeform} × {fact, topical}) share VISUAL_RESEARCH_SUBFLOW
 * for the discovery half and diverge on statement-writing per answersFormat. Topical
 * variants layer the existing TOPICAL_MODIFIER on top (the WebSearch step grounds the
 * SUBJECT in a recent event before the subflow searches for its image).
 */
const IMAGE_INSPECTION_GATE = `IMAGE INSPECTION GATE (shared across all visual paths — invoke wherever the VISUAL RESEARCH SUBFLOW says "apply the IMAGE INSPECTION GATE"). The image-search tool returns the picture INLINE — actually LOOK at it before writing anything. Evaluate four things:
   1. SUBJECT MATCH: does the image actually depict the subject the metadata claims? (Upstream "main images" are sometimes a diagram, coat of arms, map, or tangential photo rather than a canonical depiction.)
   2. SUBJECT CLARITY: is the subject clearly visible — no heavy obstruction, no competing subjects, adequate resolution and angle for a player to recognize it?
   3. ANSWER LEAKAGE: does the image contain text, captions, watermarks, labels, or other in-image content that reveals the answer (a flag with the country name baked in, a jersey with the team name, a museum placard)?
   4. DISTINGUISHING FEATURES: note what is visually evident — this informs distractor choice (choice) or the confusable identity-swap (boolean).
   If check (1), (2), or (3) FAILS → re-roll per the subflow's retry budget. The failure is silent (no tool error), same as a duplicate hit.`;

const IMAGE_IS_QUESTION_GATE = `IMAGE-IS-QUESTION GATE (shared across all visual paths — invoke wherever a visual path step says "apply the IMAGE-IS-QUESTION GATE"). Thought experiment: "If I removed the image and showed ONLY the statement, could a player still answer?" If YES → the image is decorative → REJECT and rewrite so the image is REQUIRED to answer.
   - VALID (image required): "Who is this?" / "This is the flag of Ecuador. T/F" / "This bird species is native to Europe. T/F" (with a Cardinal photo).
   - INVALID (image decorative): "Birds have hollow bones. T/F" (true regardless of which bird is shown) / "The capital of France is Paris. T/F" (with an Eiffel Tower photo) / "How many planets are in our solar system?" (with a Saturn photo).
   Run this BEFORE the polarity / plausibility / difficulty gates — a question that fails here is wrong-shaped and shouldn't be difficulty-rated.`;

const VISUAL_VERIFIABILITY_GATE = `VISUAL VERIFIABILITY GATE (shared across all visual paths — invoke wherever a visual path step says "apply the VISUAL VERIFIABILITY GATE"). A visual question's answer MUST be an OBJECTIVE, CANONICAL FACT about the IDENTIFIED subject — something every knowledgeable player would agree on and could look up. It MUST NOT be a perceptual judgment read off the pixels: counting visible features, estimating quantities, naming "how many colors / shades / spots / stars / people / windows", judging size/brightness/mood, or anything whose answer changes with crop, lighting, resolution, or where you draw the line. The image's ONLY job is to let the player IDENTIFY the subject; the answer then comes from KNOWLEDGE about that subject, not from measuring the picture.
   Decisive test: "Must the player KNOW the answer (or know it from recognizing the subject), or could they DERIVE it by reading / counting / measuring what's in the picture?" If it can be derived from the picture → REJECT and rewrite (or, on the freeform \`countable\` shape, re-anchor the count to a fact you can only KNOW — see below). The answer must NOT be visible in, or countable from, the image itself.
   - VALID (must be known from recognizing the subject — not readable off the picture): "Who painted this?" / "What country's flag is this?" / "What breed of dog is this?" / "How many moons does this planet have?" (shown Jupiter — you must recognize Jupiter and KNOW the count; the moons aren't all in frame) / "How many official languages does this country have?" (shown a flag — recognize the country, recall the count).
   - INVALID (answer is visible / countable / measurable in the picture, or purely subjective): "How many distinct colors does this whale's body display?" / "How many stars are in this picture?" / "How many people are in this crowd?" / "How many strings does this instrument have?" (just count them) / "How big is this building?" / "What mood does this painting convey?" / "How many spots does this leopard have?" — each is answered (or fudged) by eyeballing the image rather than by knowing anything about the subject.
   Run this immediately AFTER the IMAGE-IS-QUESTION GATE and BEFORE the difficulty gate.`;

const VISUAL_RESEARCH_SUBFLOW = `VISUAL RESEARCH SUBFLOW (subject discovery — shared by all 6 visual paths; the statement-writing half diverges per answersFormat below):
   a. Pick one category from \`categories.ideas\` (the SAME pool as text medium — there is no separate visual pool).
   b. Brainstorm 3–5 candidate subjects in that category. (For \`topical\` variants, the TOPICAL MODIFIER's WebSearch step runs FIRST and grounds these candidates in a recent event.)
   c. PICK AN IMAGE-SEARCH TOOL: survey your available tools and identify any whose DESCRIPTION marks it as a trivia image source — it takes a subject \`query\` and returns an image inline plus a \`{ source, subjectId, title, imageUrl, … }\` metadata block. Judge by the description, NOT by the tool's name (names are not load-bearing — e.g. \`mcp__commons-image-search__find_subject\`, \`mcp__brave-image-search__find_image\`). Choose the one whose description best fits the rolled category (e.g. a Wikimedia/Commons source for flags / people / landmarks / paintings; a movies-or-TV source for film; a generic web-image search as the long-tail fallback). **If NONE of your available tools is such an image source, ABORT the visual path IMMEDIATELY — do NOT consume the retry budget — and fall back to the TEXT-medium path for the same \`answersFormat × questionType\` (treat this run as a text roll). This is the graceful "no image provider installed" path; no error surfaces.**
   d. Call the chosen tool with \`query: <candidate subject>\`. It returns a multimodal result: an inline image block PLUS a text metadata block carrying \`{ source, subjectId, title, imageUrl, license?, attribution? }\`. (On a structured error — notFound / rateLimit / network / keyMissing / etc. — treat it as a failed candidate and re-roll per the retry budget.)
   e. Apply the IMAGE INSPECTION GATE (shared definition above) on the returned image.
   f. Parse \`subjectId\` from the metadata block and call \`find_previous_subjects({ game: "{game}", subjectId })\`. If it returns ANY match, this subject was already asked about — re-roll.
   g. RETRY BUDGET (covers inspection-gate failures, image-is-question-gate failures, tool errors, and dedup hits): up to 3 candidate re-rolls within the same category (a different \`query\`, OR a different available image-search tool), THEN up to 2 category re-rolls (a different entry in \`categories.ideas\`). If all attempts are exhausted, ABORT the visual path and fall back to the TEXT-medium path for the same \`answersFormat × questionType\`.
   The subject's \`title\`, \`imageUrl\`, \`subjectId\`, \`license\`, \`attribution\`, plus a \`altText\` you compose become the \`media\` object passed to save_question.`;

const VISUAL_CHOICE_FLOW_STEPS = `1. Run the VISUAL RESEARCH SUBFLOW (shared definition above) to discover + inspect a subject. get_ideas also returned \`suggestedChoiceCount\` and \`suggestedCorrectIndex\` — honor both exactly.
2. WRITE AN IDENTIFICATION PROMPT that REQUIRES the image ("Who is this?", "What animal is this?", "Which landmark is shown?"). Place the subject's \`title\` (from the metadata block) at \`suggestedCorrectIndex\`; write (suggestedChoiceCount − 1) same-category-sibling distractors (other plausible identities of the same kind). Apply the STATEMENT–CHOICES NON-OVERLAP GATE (shared definition above).
3. DISTRACTOR PLAUSIBILITY GATE (shared definition above — same four conditions; rewrite ONLY distractors, never the correct title at suggestedCorrectIndex).
4. Apply the IMAGE-IS-QUESTION GATE (shared definition above), then the VISUAL VERIFIABILITY GATE (shared definition above).
5. DIFFICULTY GATE (shared definition above) — CHOICE reframe rule (correct POSITION locked at suggestedCorrectIndex). (Dedup is handled by \`find_previous_subjects\` inside the subflow — do NOT also run the text DUPLICATE CHECK GATE here; the templated "Which … is shown?" prompt would false-positive against every prior visual question.)
6. Choose 1–4 emojis: apply the EMOJI SELECTION GATE (shared definition above). Compose \`media.altText\` — an accessibility description of the image that does NOT reveal the answer (describe generically, e.g. "a national flag" not "the flag of Ecuador").
7. HINT (optional): apply the HINT DRAFTING GATE (shared definition above).
8. PUZZLE QUALITY GATE: apply the PUZZLE QUALITY GATE (shared definition above) — reason through all five checks; revise or re-roll on failure.
9. SAVE: call save_question with \`promptMedium: "image"\`, \`answersFormat: "choice"\`, \`questionType: "fact"\`, category, statement, choices, correctIndex (= suggestedCorrectIndex), \`media: { kind: "image", url: <imageUrl>, altText, subjectId, title, license?, attribution? }\`, emojis, suggestedDifficulty, difficulty, context?, hint?, points? (apply the POINTS GATE), slot?. Store the returned questionId AND slot.index for the post step.`;

const VISUAL_BOOLEAN_FLOW_STEPS = `1. Run the VISUAL RESEARCH SUBFLOW (shared definition above). get_ideas also returned \`suggestedAnswer\` — the truth value the claim MUST have.
2. WRITE A CLAIM-BASED STATEMENT about the image's subject. Branch on suggestedAnswer:
   - TRUE: assert the correct identity ("This is the flag of Ecuador.") OR a true image-grounded property ("This bird species is native to North America." + a Cardinal photo).
   - FALSE: swap to a CONFUSABLE subject ("This is the flag of Colombia." shown an Ecuador flag) OR assert an image-grounded property that is WRONG for the shown subject ("This bird species is native to Europe." + a Cardinal photo). Use the distinguishing features noted during inspection to pick the most confusable swap.
   The claim MUST require identifying the subject FROM THE IMAGE — generic category facts ("Birds have feathers") are decoration, not visual questions.
3. POLARITY SELF-CHECK (REQUIRED — same as the boolean path body): state suggestedAnswer, what your claim actually asserts, and whether they match. If not, rewrite.
4. DUAL DEDUP CHECK (REQUIRED for image+boolean only): the subflow already ran \`find_previous_subjects\`. ADDITIONALLY apply the DUPLICATE CHECK GATE (shared definition above) against the CLAIM TEXT — an image+boolean claim ("This is the flag of Ecuador") can recur with a different image, so the claim must also be unique. Re-roll if EITHER check hits. (Image+choice and image+freeform do NOT use this dual-check — only image+boolean.)
5. Apply the IMAGE-IS-QUESTION GATE (shared definition above), then the VISUAL VERIFIABILITY GATE (shared definition above).
6. DIFFICULTY GATE (shared definition above) — BOOLEAN reframe rule (re-run the POLARITY SELF-CHECK on any reframe).
7. Choose 1–4 emojis: apply the EMOJI SELECTION GATE (shared definition above). Compose \`media.altText\` (generic; never reveal the answer).
8. HINT (optional): apply the HINT DRAFTING GATE (shared definition above).
9. PUZZLE QUALITY GATE: apply the PUZZLE QUALITY GATE (shared definition above) — reason through all five checks; revise or re-roll on failure.
10. SAVE: call save_question with \`promptMedium: "image"\`, \`answersFormat: "boolean"\`, \`questionType: "fact"\`, category, statement, isTrue (= suggestedAnswer), \`media: { kind: "image", url: <imageUrl>, altText, subjectId, title, license?, attribution? }\`, emojis, suggestedDifficulty, difficulty, context?, hint?, points? (apply the POINTS GATE), slot?. Store the returned questionId AND slot.index.`;

const VISUAL_FREEFORM_FLOW_STEPS = `1. Run the VISUAL RESEARCH SUBFLOW (shared definition above). get_ideas also returned \`suggestedFreeformAnswerShape\` — pass it through to save unchanged.
2. WRITE A TYPED-IDENTIFICATION PROMPT that REQUIRES the image ("Who is this?", "What animal is this?", "Which landmark is shown?"). Set \`expectedAnswer\` to the subject's \`title\` from the metadata block (canonical, trimmed form — no articles/qualifiers). Optionally populate \`acceptableAnswers\` with observed variants ("Eiffel Tower" / "La Tour Eiffel" / "Sagarmatha") and \`gradingNotes\` when a category-level acceptance pattern helps the reveal-time judge. No polarity gate, no plausibility gate (no distractors, no polarity to flip).
   COUNTABLE-SHAPE WARNING: when \`suggestedFreeformAnswerShape\` is \`"countable"\`, do NOT ask the player to COUNT things visible in the image ("how many colors / spots / people / windows / strings" — those are read straight off the picture and fail the VISUAL VERIFIABILITY GATE). Instead, FIRST identify the subject, then ask a count the player must KNOW and that is NOT visible in the frame ("How many moons does this planet have?" shown Jupiter; "How many official languages does this country have?" shown a flag). If the identified subject has no such known, off-frame count, ABANDON the countable framing and write a plain identification prompt ("What animal is this?") instead — the shape is a nudge, not a mandate.
3. Apply the IMAGE-IS-QUESTION GATE (shared definition above), then the VISUAL VERIFIABILITY GATE (shared definition above). (Dedup is handled by \`find_previous_subjects\` inside the subflow — do NOT run the text DUPLICATE CHECK GATE; the templated prompt would false-positive.)
4. DIFFICULTY GATE (shared definition above) — FREEFORM reframe rule.
5. Choose 1–4 emojis: apply the EMOJI SELECTION GATE (shared definition above). Compose \`media.altText\` (generic; never reveal the answer).
6. HINT (optional): apply the HINT DRAFTING GATE (shared definition above).
7. PUZZLE QUALITY GATE: apply the PUZZLE QUALITY GATE (shared definition above) — reason through all five checks; revise or re-roll on failure.
8. SAVE: call save_question with \`promptMedium: "image"\`, \`answersFormat: "freeform"\`, \`questionType: "fact"\`, category, statement, expectedAnswer, acceptableAnswers?, gradingNotes?, freeformAnswerShape (= suggestedFreeformAnswerShape), \`media: { kind: "image", url: <imageUrl>, altText, subjectId, title, license?, attribution? }\`, emojis, suggestedDifficulty, difficulty, context?, hint?, points? (apply the POINTS GATE), slot?. Store the returned questionId AND slot.index.`;

const PER_SLOT_GENERATION_PATHS = `Per-question/per-slot generation DISPATCHES on a 3-axis matrix: \`suggestedPromptMedium\` × \`suggestedAnswersFormat\` × \`suggestedQuestionType\`.

PROMPT-MEDIUM DISPATCH (FIRST — read \`suggestedPromptMedium\`):
- \`"text"\` (default): use the TEXT-MEDIUM path bodies below (boolean / choice / freeform), selected by \`suggestedAnswersFormat\` and modified by \`suggestedQuestionType\` exactly as before.
- \`"image"\`: use the IMAGE-MEDIUM (VISUAL) path bodies below. ALL six visual paths first run the VISUAL RESEARCH SUBFLOW (which short-circuits to text when no image-search tool is available), then diverge on \`suggestedAnswersFormat\`. \`suggestedQuestionType: "topical"\` layers the TOPICAL MODIFIER on top (its WebSearch step grounds the SUBJECT in a recent event before the subflow searches for its image).

Within either medium, the answer-shape axis (boolean / choice / freeform) selects ONE OF THREE PATH BODIES. The question-type axis (fact / topical) is a MODIFIER: \`"fact"\` runs the path body unchanged; \`"topical"\` applies the TOPICAL MODIFIER (which prepends a WebSearch step and adds save fields) on top of the same path body.

| | \`suggestedAnswersFormat: "boolean"\` | \`suggestedAnswersFormat: "choice"\` | \`suggestedAnswersFormat: "freeform"\` |
|---|---|---|---|
| \`suggestedQuestionType: "fact"\` | FACT-BOOLEAN PATH = BOOLEAN path body | FACT-CHOICE PATH = CHOICE path body | FACT-FREEFORM PATH = FREEFORM path body |
| \`suggestedQuestionType: "topical"\` | TOPICAL-BOOLEAN PATH = BOOLEAN path body + TOPICAL MODIFIER | TOPICAL-CHOICE PATH = CHOICE path body + TOPICAL MODIFIER | TOPICAL-FREEFORM PATH = FREEFORM path body + TOPICAL MODIFIER |
| \`suggestedQuestionType: "prediction"\` | PREDICTION-BOOLEAN = BOOLEAN path body + PREDICTION MODIFIER | PREDICTION-CHOICE = CHOICE path body + PREDICTION MODIFIER | PREDICTION-FREEFORM = FREEFORM path body + PREDICTION MODIFIER |

All three topical combinations REQUIRE the \`WebSearch\` tool (via the TOPICAL MODIFIER) to find a recent newsworthy event, and pass the resulting source URL to \`save_question\`. The fact combinations never call WebSearch. The prediction combinations also REQUIRE \`WebSearch\` (via the PREDICTION MODIFIER) — they research an UPCOMING event and SAVE WITHOUT AN ANSWER KEY (settled later at reveal). Most games never roll prediction (default weight 0); it appears only when a game's \`questionType\` cascade opts in.

The freeform paths produce an answer the user TYPES (into a Slack modal). Claude writes the canonical \`expectedAnswer\` and optional \`acceptableAnswers\` / \`gradingNotes\` at save time. A small fast model judges submissions at reveal — the judge automatically rejects multi-guess "shotgun" answers (e.g. "Paris or London") as incorrect, so the canonical answer must be a single concrete value.

Duplicate detection is intentionally CROSS-GAME and is not slot-scoped — a question that appeared in slot 0 yesterday is still a duplicate if it shows up in slot 2 today, and a duplicate fact in a sibling game still counts. Always call \`find_previous_questions\` with \`keywords: [...]\` + \`match: "any"\`, OMITTING the \`games\` argument; do NOT filter by slot.

=== SHARED GATES (referenced by every path body below — read once, apply wherever a path step says "apply the X GATE") ===

${DUPLICATE_CHECK_GATE}

${DIFFICULTY_GATE}

${STATEMENT_CHOICES_NON_OVERLAP_GATE}

${HINT_DRAFTING_GATE}

${POINTS_GATE}

${EMOJI_SELECTION_GATE}

${PUZZLE_QUALITY_GATE}

=== BOOLEAN PATH BODY (per question / per slot) ===

${QUESTION_FLOW_STEPS}

=== CHOICE PATH BODY (per question / per slot) ===

${CHOICE_FLOW_STEPS}

=== FREEFORM PATH BODY (per question / per slot) ===

${FREEFORM_FACT_FLOW_STEPS}

=== TOPICAL MODIFIER (applied on top of any path body when suggestedQuestionType === "topical") ===

${TOPICAL_MODIFIER}

=== PREDICTION MODIFIER (applied on top of any path body when suggestedQuestionType === "prediction") ===

${PREDICTION_MODIFIER}

=== IMAGE-MEDIUM (VISUAL) PATHS (used when suggestedPromptMedium === "image") ===

The six visual paths share these gates + the subject-discovery subflow, then diverge on answersFormat. The VISUAL RESEARCH SUBFLOW short-circuits to the text path when no image-search tool is available, so these paths are safe to attempt unconditionally.

${IMAGE_INSPECTION_GATE}

${IMAGE_IS_QUESTION_GATE}

${VISUAL_VERIFIABILITY_GATE}

${VISUAL_RESEARCH_SUBFLOW}

--- VISUAL CHOICE PATH BODY (image + choice) ---

${VISUAL_CHOICE_FLOW_STEPS}

--- VISUAL BOOLEAN PATH BODY (image + boolean) ---

${VISUAL_BOOLEAN_FLOW_STEPS}

--- VISUAL FREEFORM PATH BODY (image + freeform) ---

${VISUAL_FREEFORM_FLOW_STEPS}

For the THREE topical visual combinations (image + topical + {choice, boolean, freeform}), apply the TOPICAL MODIFIER above ON TOP OF the matching visual path body: its WebSearch step grounds the SUBJECT in a recent event (which person / landmark / work is in the news), then the VISUAL RESEARCH SUBFLOW searches for that subject's image. Save with the modifier's extra fields (\`questionType: "topical"\`, \`sourceUrl\`, \`eventDate?\`) alongside the visual save fields (\`promptMedium: "image"\`, \`media\`).`;

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

   NO-SPOILER GATE (HARD CONSTRAINT — DO NOT SKIP — applies to the ENTIRE message you post: the new-season opener, the show-banner / round-opener \`header\`, the warm-up \`section\` patter, the card \`title\` / \`subtitle\`, the closer \`context\`, EVERY emoji, and any image \`altText\`). NOTHING outside the card \`body\` statement itself may contain, quote, restate, encode, or telegraph the answer — or, for choice questions, ANY option string (correct or distractor). The answer is NEVER surfaced at question time; it lives only in the separate reveal run. A player must not be able to read or infer the answer off any part of the post.
   - MOST dangerous for FREEFORM "name the famous line / phrase / quote / person / place" questions, where there is no button layer hiding the answer: the literal expected answer (and any near-paraphrase of it) MUST NOT appear in the header, patter, title, or closer. Theme the flavor around the SUBJECT, never the ANSWER.
   - DON'T: a freeform question "What is the famous phrase James Bond uses when ordering his Martini?" under a \`header\` reading "🍸 SHAKEN, NOT STIRRED — QUESTION 3!" — the header literally IS the answer.
   - DO: keep the flavor evocative but answer-free — e.g. "🕶️ SECRET AGENT SHOWDOWN — QUESTION 3!" or a plain "🎯 QUESTION 3!" — it sets the spy vibe without naming the line.
   - SELF-CHECK before handing the blocks to \`post_questions\`: take the question's answer (and every choice string, for choice questions) and scan the header, patter, card title / subtitle, closer, emojis, and altText for it — including paraphrases and the underlying entity it refers to, not just the literal text. If it appears ANYWHERE outside the card \`body\` statement, rewrite that block before posting.

   Compose a \`blocks\` array (Clack's curated subset: divider, header, section, context, image, markdown, card, carousel) — you'll hand it to \`post_questions\` in step 10. Do NOT include the answer affordance (buttons) in the blocks; \`post_questions\` appends an \`actions\` block for ALL formats automatically — boolean gets \`[👍 TRUE, 👎 FALSE]\`, choice gets \`[1️⃣, 2️⃣, …]\` sized to \`choices.length\` (or the record's stamped \`choiceEmojis\` prefixes when themed), freeform gets a single \`Answer\` button that opens the modal. The tool inserts that actions block between your card (#3) and your closer context (#4) at post-time. Use this FOUR-BLOCK layout — the structure stays fixed; the wording is where your persona lives:

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
      - Do NOT set \`hero_image\` or \`icon\`. **IMAGE-MEDIUM questions (promptMedium: "image"):** keep the card \`title\` + \`body\` only, then add a SEPARATE \`image\` block right AFTER the card (and before the closer context) — \`{ "type": "image", "image_url": "<media.url>", "alt_text": "<media.altText>" }\` built from the record's \`media\`. A natural touch: prefix the card \`title\` emoji with 📷 to cue that this is a visual question.
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
     - **choice** → \`choices.length\` buttons labeled \`1️⃣ <choice0>\`, \`2️⃣ <choice1>\`, … in the stored \`choices\` array order — or, when the record carries stamped \`choiceEmojis\` (themed style), each button is prefixed by its stamped emoji instead of the number. The button's index IS the vote — keep the array order stable.
     - **freeform** → one \`Answer\` button that opens a Slack modal for the user to type their guess.
   - **Choice-label length cap.** \`save_question\` rejects any choice longer than 40 characters (after trim). Keep each choice label short and self-contained — if the option needs more prose to be intelligible, put the disambiguating context in the card \`body\` (e.g. "Which of these is the largest ocean?") and let the button label render just the option (1️⃣ Pacific, 2️⃣ Atlantic, …). The button label is the option text — disambiguation belongs in the body, not in the button.
   - You do NOT add a button block, an "answer options" section, or any inline "TRUE • FALSE" / "1️⃣ … • 2️⃣ …" text — the buttons ARE the affordance. Adding them yourself duplicates what the tool appends.

10. POST THE QUESTION(S):
    Build one \`{ questionId, blocks }\` item per saved question. In the SINGLE-QUESTION FLOW, that is exactly one item. In the MULTI-SLOT FLOW, the items array length equals \`slotCount\` and items MUST be in slot-index order (slot 0 first, slot 1 second, …).

    FLEXIBLE FORMAT (\`format.flexible: true\`): the items array is the PREFIX of slots you actually SATISFIED — anywhere from 0 to \`slotCount\` items, still in slot-index order. If you saved ZERO questions (the flexible day was skipped — no usable material for even the first slot), do NOT call \`post_questions\` at all; go straight to END THE RUN below.

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

  FLEXIBLE FORMAT (\`format.flexible: true\`): treat \`N\` as a CEILING, not a mandate. Walk slots \`0..N-1\` in order; at the FIRST slot where you cannot generate a question that passes the quality gates (no fresh/usable material), STOP — do NOT force a weak question and do NOT skip ahead to a later slot. Post only the slots already saved (\`0..i-1\`). If even slot 0 yields nothing, save and post NOTHING — the day is skipped (see step 10's zero-question handling). A flexible fire posts 0 to N questions.

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
   After saving every MISSING slot identified above, re-call \`find_previous_questions({ games: ["{game}"], seasons: ["current"], posted: false, match: "all" })\` and confirm that every slot index in \`[0..slotCount-1]\` is now covered (either by the records that were already staged, or by the records you just saved). If any slot is still missing — for example because a \`save_question\` call failed mid-loop — log the gap mentally (you will not DM admins from this run) and continue to termination so the next prep fire or the question cron's inline-gen fallback can recover. (When \`format.flexible: true\`, full coverage is NOT expected — the FLEXIBLE PREFIX may legitimately stop early or stage nothing; do not force-fill a slot that has no usable material.)

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
 * LOCK-cron prompt — drives the `<game>:lock` cron spec when the game has `lockCron`
 * configured. A single mechanical tool call: `lock_questions` freezes every posted,
 * not-yet-revealed question (strips the answer buttons, shows a "locked in" notice).
 * The cron is channelless and `submitResponseMode: "skipped"`, so the run posts no
 * Slack message and terminates with `submit_response({ skip_response: true })`.
 */
export const LOCK_QUESTIONS_INSTRUCTIONS = `Freeze voting for game \`{game}\`.

Call \`lock_questions({ game: "{game}" })\` exactly once. It locks every question that is posted but not yet revealed — removing its answer buttons and replacing them with a "locked in — waiting on results" notice. It posts no new message and is safe to run even when there is nothing to lock (it simply reports zero locked).

Then call \`submit_response({ skip_response: true })\` to terminate the run. Do not post any other message — locking only edits existing cards.`;

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
 *
 * Built as a function (not a top-level `const`) because its leaderboard row labels
 * and season-finale podium labels are localized via the plugin translator `t()`,
 * which is wired to the workspace language by `setTriviaT(sdk.t)` at plugin init.
 * Evaluating at call time (from `buildGameSpecs`, post-init) picks up the configured
 * language; the EN dictionary values equal the prior literals, so English output is
 * byte-stable. Free prose (closers, transitions, verdicts) still relies on the
 * LANGUAGE directive — only the dictated structural labels are pre-localized here.
 */
export function buildProcessRevealInstructions(): string {
  return `${PERSONA_TOPIC_REFERENCE}

${GAME_CONTEXT_DIRECTIVE}

Deliver today's trivia reveal. The deterministic SCORING is done for you by \`compute_answers\`; you then EDIT the question cards, (on the season's last fire) ROLL OVER the season, and RENDER the payload with charisma. Call the tools in this order:

0. SETTLE ANY PREDICTIONS FIRST (only relevant when the game uses \`questionType: "prediction"\`; harmless to skip otherwise — \`compute_answers\` will tell you if a decision is needed). A prediction was saved WITHOUT an answer key and stays unscored until you decide it. If \`compute_answers\` returns \`code: "UNDECIDED_PREDICTIONS"\`, it lists the pending question ids — for EACH one:
   - Use \`WebSearch\` to find the now-known result of that prediction's event.
   - If the result IS known: call \`settle_question({ game: "{game}", questionId, outcome })\` — \`outcome\` is the boolean truth (boolean), the winning option's index or exact text (choice), or the canonical answer text (freeform; optionally also \`acceptableAnswers\`/\`gradingNotes\`).
   - If the result is NOT yet available (event postponed/unfinished) or is genuinely unresolvable: call \`settle_question({ game: "{game}", questionId, invalidate: true, invalidatedReason: "<short reason>" })\` to mark it invalidated (worth 0, shown as "invalidated"). EVERY prediction in the batch MUST be either answered or invalidated. This decision is REVERSIBLE — an admin can later undo it with \`settle_question({ game: "{game}", questionId, reopen: true })\` if the result becomes known.
   - Then RE-CALL \`compute_answers\` — it now scores the answered predictions and lists any \`invalidatedQuestions\` for you to mention.

1. CALL \`compute_answers({ game: "{game}" })\` AND READ THE PAYLOAD:

   The tool fetches the pending question's Slack message, excludes the bot + every flagged cheater, scores answers from the stored button clicks (boolean/choice) and modal submissions (freeform), persists them, stamps \`processedAt\`, and computes the leaderboard. It does NOT edit any Slack card and does NOT roll over the season — those are steps 2 and 3 below. Reactions are still fetched but ONLY as commentary, not as votes. You will NOT call \`fetch_channel_messages\`, \`find_previous_questions\`, \`get_question_history\`, \`submit_answers\`, \`retrieve_scores\`, \`check_season_status\`, or \`upsert_season\`.

   Note the \`reveals[].questionId\` values on the payload — you pass them (as \`questionIds\`) to \`refresh_question_cards\` in step 2.

   The returned payload shape:
   - \`game\`: the game's slug (internal — never surface).
   - \`reveals\`: array of reveal entries to render (length 0 = nothing pending, length 1 = today's reveal). Each entry has:
     - \`questionId\`, \`statement\`, \`category\`, \`emojis\`, \`messageLink\`.
     - \`wasReprocessed\` (boolean) — true if this was a corrective re-run (rare; affects tone slightly — acknowledge subtly without dwelling).
     - \`answer\`: \`{ type: "boolean", isTrue }\` for boolean questions; \`{ type: "choice", choices, correctIndex }\` for choice; \`{ type: "freeform", expectedAnswer, acceptableAnswers?, gradingNotes? }\` for freeform (the user typed their answer into a modal).
     - \`media\` (OPTIONAL — present ONLY on image-medium questions): \`{ title, attribution?, license? }\`. When present, append ONE \`context\` block to that question's reveal: \`{ type: "context", elements: [{ type: "mrkdwn", text: "📷 Image: <attribution> · <license>" }] }\`. Use the 📷 Unicode char (NEVER \`:camera:\`). Omit \` · <license>\` when \`license\` is absent; omit the whole block when BOTH \`attribution\` and \`license\` are absent. The block goes immediately AFTER that question's verdict/answer section (in multi-question reveals, before the next question's divider); the cumulative leaderboard table stays last. This honors source license terms (CC-BY-SA requires attribution).
     - \`points\` (OPTIONAL — present ONLY when the question was worth MORE than 1): what this question paid each player who got it right. It was shown on the question card as "Worth N points" before anyone answered, so treat it as known stakes, not a reveal-time twist: work it into that question's verdict naturally when it adds drama ("the 3-pointer went to…"). Absent means the ordinary 1 point — say nothing about scoring value.
     - \`voters\`: a DISCRIMINATED UNION keyed on \`voters.revealResponses\` (the per-question reveal-mode stamped at post-time by \`post_questions\`). One of four variants:
       - \`{ revealResponses: "yes", correct: Voter[], incorrect: Voter[], noAnswer: Voter[], reactions: Array<{ userId, displayName, emojis: string[] }> }\` — full per-bucket detail; for FREEFORM entries, every \`Voter\` in \`correct\` and \`incorrect\` carries an additional \`answerText\` field (the user's typed answer) which you MUST QUOTE in the reveal.
       - \`{ revealResponses: "just-correctness", correct: Voter[], incorrect: Voter[], noAnswer: Voter[], reactions: Array<{ userId, displayName, emojis: string[] }> }\` — same bucket structure as \`"yes"\`, BUT freeform \`Voter\`s have NO \`answerText\` field (admin chose to hide the typed strings). You MUST NOT invent or speculate about what they typed.
       - \`{ revealResponses: "just-winners", correct: Voter[], incorrectCount: number, noAnswerCount: number, reactions: Array<{ userId, displayName, emojis: string[] }> }\` — names the \`correct\` voters ONLY (freeform winners carry \`answerText\`, which you MUST QUOTE). There are NO \`incorrect\`/\`noAnswer\` named arrays — only anonymous counts. You MUST NOT name, invent, or imply who got it wrong; use the counts for flair only ("the other 3 missed it", "everyone got fooled!").
       - \`{ revealResponses: "no", reactions: Array<{ userId, displayName, emojis: string[] }> }\` — NO per-user vote info at all; only the reaction-commentary list. You MUST NOT speculate about who voted what — render the answer + reactions + closer + leaderboard only.
     - \`reactions\` (present in all four variants) is COMMENTARY, not votes. Each entry lists every emoji a user reacted with so you can riff on it ("<@U_ALICE> piped in with 🤔🔥"). Caught cheaters are STRUCTURALLY ABSENT from every list — they never appear in correct/incorrect/noAnswer/reactions.
   - \`leaderboard\`: array of \`{ userId, displayName, totalCorrect, totalAnswered, totalPoints, accuracy, currentSeasonCorrect?, currentSeasonAnswered?, currentSeasonPoints? }\` already sorted in render order (by POINTS). \`totalPoints\`/\`currentSeasonPoints\` are the SCORE — each correct answer pays its question's worth, so they equal the correct counts when every question is worth 1 point, and exceed them when variable points are in play. The table's score cells render POINTS (see LEADERBOARD TABLE); the correct counts are context, not the ranking.
   - \`roundSummary\` (ALWAYS present): \`{ totalQuestions, perPlayer: Array<{ userId, displayName, correct, answered, points, roundMvp?, perfectRound? }> }\` — the per-player round scoreboard. \`points\` is what the player EARNED this fire (each correct question pays its own worth; equals \`correct\` on an all-1-point fire) and is what the \`This Round\` row renders. It is an AGGREGATE computed from scored answers, INDEPENDENT of \`revealResponses\` (which only controls per-question display), so it is here every round in every mode. It is the SOLE source for the \`This Round\` leaderboard-table row — there is NO separate prose "Round Summary" block. \`perPlayer\` is EMPTY only when nobody answered this round — in that case skip the \`This Round\` row. \`perfectRound: true\` (present only on a fire of ≥3 questions where the player answered them ALL correctly — completeness, NOT points) drives the \`This Round\` star — see LEADERBOARD TABLE. \`roundMvp\` follows POINTS, so on a weighted fire the MVP and the perfect player can be different people; report what the flags say rather than reconciling them. Already sorted (points desc, displayName asc); already excludes cheaters; you MUST NOT recompute it from \`reveals[].voters\` yourself.
   - \`includeRevealInQuestions\` (\`"yes" | "no"\`, ALWAYS present): the game's resolved card-narrative mode. \`"yes"\` → author per-card narrative via \`set_reveal_narrative\` BEFORE step 2 (see "AUTHOR PER-CARD NARRATIVE" below); \`"no"\` (today's default) → cards stay facts-only and the narrative lives in the step-4 summary.
   - \`finalRevealSummary\` (\`"yes" | "no" | "in-thread"\`, ALWAYS present): the game's resolved placement for the reveal NARRATIVE (verdict header + WHY + per-bucket voter breakdown + per-question verdicts). It governs ONLY that narrative — the leaderboard \`table\` (and, on the last fire, the season finale) ALWAYS posts top-level. See "SUMMARY PLACEMENT" in step 4. \`"yes"\` (default) = narrative top-level alongside the leaderboard (today's behavior); \`"no"\` = narrative omitted entirely; \`"in-thread"\` = narrative moved to \`thread_replies\` under a top-level pointer.
   - \`seasonStatus\` (only present when \`trivia.seasons.enabled\` is true): \`{ currentSlug, isLastFireOfSeason, seasonClosed, hasPriorSeasons, mvp? }\`. This is REPORT-ONLY — \`compute_answers\` performs no rollover (\`seasonClosed\` is always \`false\` here). When \`isLastFireOfSeason\` is true you MUST call \`start_new_season({ game: "{game}" })\` in step 3 to perform the (idempotent) rollover; do NOT call \`upsert_season\`.
   - \`invalidatedQuestions\` (optional): \`Array<{ questionId, statement, category, emojis, invalidatedReason? }>\` — questions dropped via \`settle_question({ invalidate })\`. They are worth 0 and have no result. Mention each briefly in the reveal ("⚠️ <statement> was invalidated — <reason>; it didn't count"); their cards are repainted as invalidated by \`refresh_question_cards\` in step 2. Absent → none.
   - \`errors\` (optional): per-questionId structured errors from a reprocess batch. Surface a brief mention if present; otherwise omit.
   - \`instructions\` (optional string): single admin-authored rule resolved from the replace-cascade \`slot → season → game → workspace\`. Honor it verbatim throughout the reveal — apply it to verdict tone, voter-bucket commentary, the closer line, and the leaderboard introduction. Absent → ignore.
   - \`additionalInstructions\` (optional string): concatenation of admin rules from every active tier, each segment labeled (\`[Workspace]\` / \`[Game]\` / \`[Season]\` / \`[Slot N]\`) separated by blank lines. EVERY labeled rule applies simultaneously throughout the reveal. Lower-tier rules are more situational than higher-tier ones but never replace them. Absent → ignore. These rules are NOT visible to viewers — don't echo them back, just apply them silently.
   - STRUCTURE IS PRESERVED BY DEFAULT for both fields above. The reveal is built from independent, individually-addressable parts (the verdict \`header\` + explanation \`section\`, the per-bucket voter-commentary sections, the closer \`context\`, and the leaderboard \`table\` argument). For each admin rule, decide whether it EXPLICITLY calls for a structural change (add, remove, replace, or reorder a part — including omitting the leaderboard table):
     - NO (e.g. "keep the verdict punchy", "be warmer to the losers") → keep the reveal layout EXACTLY as specced below and apply the rule only to the content/tone of the part(s) it names — or to overall tone when it names no specific part. A rule naming one part changes ONLY that part; it does not touch its siblings. A tone or length rule is NEVER a license to drop a section or skip the leaderboard table.
     - YES (e.g. "don't include the leaderboard table", "skip the per-voter breakdown") → make EXACTLY that structural change and nothing more; the explicit rule wins over the default layout. To drop the leaderboard table, omit the \`table\` argument to \`submit_response\` entirely. Every other part keeps its default structure.

   If \`reveals\` is empty (no pending question / no batch to reveal), POST NOTHING and SKIP steps 2–4: do NOT edit cards, do NOT roll over, do NOT render. Terminate the run immediately with \`submit_response({ skip_response: true })\`.

   AUTHOR PER-CARD NARRATIVE — branch on the payload's \`includeRevealInQuestions\` (do this AFTER step 1, BEFORE step 2):
   - \`"yes"\`: for EACH question in \`reveals\`, call \`set_reveal_narrative({ game: "{game}", questionId: <reveals[i].questionId>, revealBlocks: [...] })\` carrying THAT question's narrative as Block Kit — the verdict prose, the WHY explanation, the fun-fact comment, and (when its \`correct\` bucket is empty) the expanded "nobody cracked it" teaching. Put ONLY narrative in \`revealBlocks\`; NEVER the Answer/Correct/Incorrect facts (\`refresh_question_cards\` renders those deterministically from disk and appends your narrative beneath them). Author every revealed question's narrative BEFORE you call \`refresh_question_cards\` in step 2, so each card shows facts + that narrative.
   - \`"no"\`: do NOT call \`set_reveal_narrative\` at all — cards stay facts-only (today's flow) and the per-question narrative lives in the step-4 summary instead.

2. CALL \`refresh_question_cards({ game: "{game}", questionIds: <every reveals[].questionId from step 1> })\`:

   This edits each revealed question's original Slack card into its final static state (drops the vote buttons, appends the results footer, adds the "See your answer" button) — deterministically, from the scored answers on disk. It does NOT score, judge, or post a new message. SKIP this call when \`reveals\` was empty.

3. ON THE SEASON'S LAST FIRE ONLY, CALL \`start_new_season({ game: "{game}" })\`:

   Call this IF AND ONLY IF \`seasonStatus.isLastFireOfSeason === true\`. It stamps \`endedAt\` and (when no continuation is queued) creates next month's season. It is idempotent — safe if already rolled over. When seasons are disabled or \`isLastFireOfSeason\` is false, SKIP this call. NEVER pass \`force\` from the reveal flow — the tool self-verifies the last fire and on a genuine last fire closes without it; if it returns \`requiresConfirmation: true\`, that means this is NOT the last fire, so do NOT retry, just SKIP.

4. RENDER VIA \`submit_response\` USING THE GAME SHOW PRESENTER VOICE:

   === MENTION POLICY — BRANCH ON \`tagPlayers\` (applies to EVERY block, top-level AND thread) ===

   The payload's \`tagPlayers\` boolean governs how you name players EVERYWHERE in this reveal — verdict voter shout-outs, the season-finale podium + participation tail, every per-question teaser, and any thread reply.
   - \`tagPlayers: true\` (default): name players with real \`<@USERID>\` Slack mentions, exactly as the layouts below instruct.
   - \`tagPlayers: false\`: NEVER emit \`<@USERID>\`. Render every player as plain-text \`@displayName\` (take the \`displayName\` from the same payload object you'd have taken the \`userId\` from — \`voters.*\`, \`roundSummary.perPlayer\`, \`leaderboard\`). This is a hard no-ping mode: a single \`<@…>\` anywhere in the output is a bug. The leaderboard \`table\` already uses bare \`displayName\` cells, so it is unaffected either way.
   Wherever an example or instruction below writes \`<@U_ALICE>\`, treat it as "\`<@USERID>\` when \`tagPlayers\`, else \`@displayName\`".

   The block layout BRANCHES on \`reveals.length\`:

   - \`reveals.length === 0\`: POST NOTHING. Call \`submit_response({ skip_response: true })\` to terminate the run cleanly — no acknowledgement, no leaderboard, no blocks. There was no batch to reveal, and a silent skip is the desired outcome.
   - \`reveals.length === 1\`: SINGLE-QUESTION layout (described immediately below). Use the verdict header + explanation + per-bucket sections appropriate to the entry's \`voters.revealResponses\` mode. The top-level \`roundSummary\` always drives the \`This Round\` leaderboard row (see LEADERBOARD TABLE) whenever \`roundSummary.perPlayer\` is non-empty — independent of the reveal mode.
   - \`reveals.length > 1\`: MULTI-QUESTION layout (see below the single-question section). Use brief per-question verdicts; the per-player round scoreboard is carried by the \`This Round\` leaderboard-table row (see LEADERBOARD TABLE), not a prose block.

   === SUMMARY PLACEMENT — BRANCH ON \`finalRevealSummary\` (applies to BOTH layouts below) ===

   Build the message exactly as the SINGLE- or MULTI-QUESTION layout specifies, then PLACE its parts per \`finalRevealSummary\`. Two part groups:
   - NARRATIVE = the verdict \`header\`, the WHY \`section\`, the \`divider\`, the per-bucket voter sections (plus the NOBODY-GOT-IT expanded detail), and — in the multi-question layout — the per-question verdict \`section\`s. Everything EXCEPT the closer and the leaderboard.
   - LEADERBOARD SURFACE = the closer \`context\` + the top-level \`table\` on a normal reveal, OR the ENTIRE SEASON FINALE LAYOUT (transition, podium, participation tail, gated all-time \`table\`, finale closer) on the last fire. This ALWAYS posts TOP-LEVEL in EVERY mode — the standings are never hidden, never moved to a thread.

   - \`"yes"\` (default — today's behavior): ONE \`submit_response\` with \`blocks: [ ...NARRATIVE, ...LEADERBOARD-SURFACE blocks ]\` plus the \`table\` parameter. No \`thread_replies\`.
   - \`"no"\`: OMIT the NARRATIVE entirely. Post \`blocks: [ ...LEADERBOARD-SURFACE blocks ]\` plus the \`table\` parameter — closer + leaderboard (or the full finale) ONLY. No verdict, no WHY, no voter breakdown. No \`thread_replies\`.
   - \`"in-thread"\`: keep the HEADLINE top-level and move the detail to a thread. TOP-LEVEL, in this order: (1) the verdict \`header\` — HOIST it out of the NARRATIVE so it leads the top message in BOTH the single- and multi-question layouts; (2) a \`context\` pointer block with text EXACTLY \`"${t("reveal.see_in_thread")}"\`; (3) the LEADERBOARD SURFACE — the normal closer \`context\` + the \`table\` parameter on a normal reveal. Then pass the REMAINING NARRATIVE (everything EXCEPT the hoisted header — the WHY \`section\`, the \`divider\`, the per-bucket voter sections, and in the multi-question layout the per-question verdict \`section\`s) as \`thread_replies: [{ blocks: [ ...remaining NARRATIVE ] }]\`, so the full WHY/voter detail lands as a threaded reply UNDER the top-level headline + standings. You MUST include BOTH the top-level header+pointer AND the \`thread_replies\` payload — a pointer with no thread reply is a bug.
     - ON THE LAST FIRE (finale) in \`"in-thread"\`: the SEASON FINALE LAYOUT stays TOP-LEVEL (podium + standings are the headline); hoist the verdict \`header\` above the pointer as usual, place the pointer \`context\` just before the finale transition, and the day's REMAINING NARRATIVE (WHY, per-bucket / per-question verdicts) STILL moves to \`thread_replies\`.

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
   - **NOBODY GOT IT — expanded answer detail.** When the \`correct\` bucket is EMPTY (no one answered correctly), do NOT lead with a list of who missed. Instead teach the room the answer: render a "Nobody cracked this one — here's the full story:" line followed by an EXPANDED explanation of the correct answer (more depth than the WHY \`section\` above — the teaching moment stands in for the celebration). In \`"yes"\`/\`"just-correctness"\` modes this REPLACES the INCORRECT names section entirely (don't enumerate missers when nobody won). In \`"just-winners"\` mode, pair the expanded detail with the existing anonymous "everyone got fooled / nobody nailed it" line — name no misser (the payload carries none). This applies whether everyone tried and missed or nobody answered at all (both leave \`correct\` empty).
   - When \`seasonStatus.isLastFireOfSeason\` is true: do NOT render the normal \`context\` closer or the leaderboard \`table\` — instead follow the SEASON FINALE LAYOUT below (winners podium → participation tail → gated all-time table → finale closer). The verdict header, explanation, divider, and per-bucket sections above STILL render; only the closer + table are replaced.
   - \`context\` block — short closer ("That's a wrap! Here's the running scoreboard:") leading into the leaderboard. Do NOT predict timing — the next reveal is on a separate schedule you have no visibility into.

   === MULTI-QUESTION LAYOUT (when reveals.length > 1) ===

   When the active season has a format, a single cron fire posts N questions and one reveal must cover all of them. The verbose per-voter-bucket layout multiplies badly, so use this compressed shape instead:

   - One \`header\` block — \`text: { type: "plain_text", text: "..." }\`. Introduce the multi-question reveal (e.g. "🎯 ROUND RECAP — N QUESTIONS!", "🏆 THE VERDICTS ARE IN!", etc.). Vary the wording. plain_text only.
   - One \`section\` block PER question (in the same order as \`reveals\`). Keep each one BRIEF — ≤ 2 short sentences. Open with the verdict label (e.g. "Q1: ✅ TRUE!" or "Q3: 🎯 The answer was 'Tokyo'!" or for freeform "Q2: ✏️ The answer: *Paris*"). The voter teaser depends on the entry's \`voters.revealResponses\`:
     - **\`"yes"\` or \`"just-correctness"\`** — follow the verdict label with a single-line voter teaser ("Alice and Bob nailed it; Carol fell for the trap"). For FREEFORM \`"yes"\` entries the teaser MAY quote one or two notable typed answers; for \`"just-correctness"\` entries name-only — do NOT invent text content.
     - **\`"just-winners"\`** — follow the verdict label naming \`voters.correct\` only ("Alice and Bob nailed it"), optionally tagging an anonymous miss count from \`incorrectCount\`/\`noAnswerCount\` ("…the other 3 missed it"); when \`correct\` is empty use an "everyone missed it" line. NEVER name or imply who got it wrong.
     - **\`"no"\`** — the brief verdict line stands on its own. Do NOT name voters or describe who got it right — the payload carries no per-user info for this question. ("Q3: 🎯 The answer was 'Tokyo'." — full stop.)
     - Do NOT enumerate every voter individually in any mode — the per-player tally lives in the \`This Round\` leaderboard-table row.
     - When a question's \`correct\` bucket is EMPTY (nobody got it), the verdict line SHOULD say so ("Q2: 🎲 FALSE! Nobody saw it coming —") and lean its ≤2 sentences into explaining the answer rather than naming missers.
   - One \`divider\` block — separates the verdicts from the closer + leaderboard.
   - The per-player round scoreboard is NOT a prose block — it is the \`This Round\` row of the leaderboard \`table\` below (see LEADERBOARD TABLE), driven by \`roundSummary.perPlayer\`. Do NOT add a "Round Summary" \`section\` block; it would just duplicate that row.
   - When \`seasonStatus.isLastFireOfSeason\` is true: do NOT render the normal \`context\` closer or the leaderboard \`table\` — instead follow the SEASON FINALE LAYOUT below. The per-question verdicts above STILL render; only the closer + table are replaced.
   - One \`context\` block — short closer leading into the cumulative leaderboard. Same timing-prediction prohibition as the single-question branch.

   Example shape for a 3-question multi-reveal:
   \`\`\`
   [
     { "type": "header", "text": { "type": "plain_text", "text": "🎯 ROUND RECAP — 3 VERDICTS!" } },
     { "type": "section", "text": { "type": "mrkdwn", "text": "*Q1: ✅ TRUE!* The crocodile family really has been around since the Late Cretaceous. <@U_ALICE> and <@U_BOB> called it; <@U_CAROL> hesitated." } },
     { "type": "section", "text": { "type": "mrkdwn", "text": "*Q2: 🎲 FALSE!* Goldfish memory clocks in at months, not seconds. <@U_BOB> kept the streak going; <@U_ALICE> fell for the myth." } },
     { "type": "section", "text": { "type": "mrkdwn", "text": "*Q3: 🎯 The answer was 'Tokyo'!* Edo became Tokyo in 1868. <@U_CAROL> aced it." } },
     { "type": "divider" },
     { "type": "context", "elements": [ { "type": "mrkdwn", "text": "Standings refreshed below — onto the next round! 🎲" } ] }
   ]
   \`\`\`

   This branch trades per-question voter detail for an aggregate scoreboard. Readability over completeness — the cumulative leaderboard table below still ships.

   === SEASON FINALE LAYOUT (when \`seasonStatus.isLastFireOfSeason === true\`) ===

   On the season's LAST fire, REPLACE the normal closer + leaderboard table with this dedicated finale. The verdict blocks above (header, explanation, per-question verdicts) render exactly as on any reveal; only the closer + \`table\` are swapped for the sequence below. "pts" everywhere means \`currentSeasonPoints\` — the player's earned SCORE, which equals their correct count on an all-1-point season and exceeds it when variable points are in play. Never render a correct count where "pts" is called for.

   1. TRANSITION \`section\` — introduce the winners in the SEASON-FINALE TONE from the \`trivia\` topic (e.g. "🏆 *And now — your season champions!*").
   2. SEASON WINNERS PODIUM — ONE \`section\` (mrkdwn) listing the FINAL current-season standings as a ranked vertical list. Rank by DISTINCT \`currentSeasonPoints\` value: the top distinct value is \`🥇 ${t("leaderboard.first_place")}\`, the 2nd \`🥈 ${t("leaderboard.second_place")}\`, the 3rd \`🥉 ${t("leaderboard.third_place")}\`. Players TIED on a value SHARE that place and medal (e.g. "🥇 *${t("leaderboard.first_place")}:* <@U_A> & <@U_B> — 18 pts"). Name each with \`<@USERID>\` and their pts. OMIT players with zero current-season participation. Use the place labels EXACTLY as written here (already in the output language) — do NOT translate or re-word them.
   3. PARTICIPATION TAIL — ONE \`section\` line listing every remaining participant (everyone below the top-3 distinct values) with pts, comma-separated, e.g. "*${t("leaderboard.participation")}:* 🎀 <@U_D> (8 pts), <@U_E> (5 pts)". The player(s) at the 4th distinct value carry the \`🎀\` ribbon; the rest are plain. Omit zero-participation players. If nobody falls below the podium, skip this line.
   4. ALL-TIME TABLE — set the \`table\` parameter as a standalone all-time scoreboard ONLY when \`seasonStatus.hasPriorSeasons === true\` AND \`showAllTimeRow !== false\`. Introduce it with a one-line \`section\` ("And the all-time leaderboard:"). The table is a names-header row + an \`All Time\` row of \`String(totalPoints)\`, columns ordered by \`totalPoints\` descending, medaled by the DENSE-RANK MEDAL RULE below. When the gate fails — a single season (\`hasPriorSeasons\` false, where All Time would just duplicate the podium) OR \`showAllTimeRow\` is false (e.g. \`allTimeRow: "never"\`) — OMIT the \`table\` entirely.
   5. \`context\` CLOSER — e.g. "Thanks for playing — see you next season! 🎉". Do NOT preview the next season's slug even when \`seasonStatus.newSeasonStarted\` is present, and do NOT predict timing. The in-tool rollover already stamped the closing season's \`endedAt\` (and may have started a continuation) before returning — do NOT call \`upsert_season\` as a follow-up.

   === LEADERBOARD TABLE (NORMAL reveals — the SEASON FINALE LAYOUT above replaces this on the last fire) ===

   On every reveal EXCEPT the finale, set the top-level \`table\` parameter alongside \`blocks\`. CRITICAL: \`table\` is a SIBLING of \`blocks\` on the \`submit_response\` call, NOT a member of the \`blocks\` array — Block Kit rejects \`{ "type": "table" }\` inside \`blocks\`. Shape: \`submit_response({ blocks: [...], table: { type: "table", rows: [...], column_settings: [...] }, actions: [...] })\`.

   STEP 1 — DECIDE THE COLUMN ORDER ONCE. A player owns exactly ONE column across EVERY row (Slack tables require uniform column widths). Decide the ordered player list a SINGLE time, then every row (names header, \`This Round\`, \`Current Season\`, \`All Time\`) fills its cells in that SAME order. NEVER sort an individual row's cells independently — that desyncs the columns.
   - When \`roundSummary.perPlayer\` is non-empty: order columns by \`roundSummary.perPlayer\` order (already sorted by \`points\` descending) — for each player, look up the entry by \`userId\` — then append any remaining columned players (on the leaderboard but ABSENT from \`perPlayer\`, i.e. didn't answer this round) ordered by \`currentSeasonPoints\` descending. Those em-dash players sort LAST.
   - When \`roundSummary.perPlayer\` is empty (nobody answered this round): order columns by \`currentSeasonPoints\` descending (or \`totalPoints\` descending when seasons are off).
   - CONSEQUENCE: the leftmost column is the ROUND leader, who need NOT be the season or all-time leader. That's intended.

   STEP 2 — WHICH PLAYERS GET A COLUMN.
   - Seasons ON (\`seasonStatus\` present): include only leaderboard entries with current-season participation (\`currentSeasonCorrect > 0\` OR \`currentSeasonAnswered > 0\`). Anyone in \`roundSummary.perPlayer\` necessarily qualifies (their this-round answer is stamped with the current season), so the \`This Round\` source set is always a subset of the columns.
   - Seasons OFF (\`seasonStatus\` absent): include every leaderboard entry.

   STEP 3 — THE ROWS are ADDITIVE (each present or absent independently; all share the STEP-1 column order):
   - NAMES HEADER (always): top-left label cell of a single space \`" "\` (Slack rejects empty \`""\` cells with \`invalid_blocks\`), then one \`displayName\` cell per column, NO medals. EXCEPTION — the seasons-off no-\`This Round\` case (below) uses a compact 2-row shape with NO label column, so its names row has no leading label cell.
   - \`This Round\` (TOP data row, whenever \`roundSummary.perPlayer\` is non-empty — ANY reveal count, single- or multi-question, ANY reveal mode): label \`"${t("leaderboard.this_round")}"\`; each cell is \`String(points)\` from \`roundSummary.perPlayer\` (looked up by \`userId\`), or the literal em-dash \`"—"\` for a columned player absent from \`perPlayer\`. OMITTED only when \`perPlayer\` is empty (nobody answered this round). The reveal mode (\`revealResponses\`) NEVER affects this row.
     - PERFECT-ROUND STAR: when a player's \`roundSummary.perPlayer\` entry carries \`perfectRound: true\`, append \` ⭐\` (one space, then the Unicode star \`⭐\`) to that player's \`This Round\` cell AFTER the medal-and-score content — e.g. \`"🥇 3"\` becomes \`"🥇 3 ⭐"\`. Read the flag from the payload; do NOT re-derive perfection from \`correct\`/\`totalQuestions\` yourself. The star is appended ONLY in the \`This Round\` row, ONLY on entries with the flag — never on an em-dash \`"—"\` cell, never on a player without \`perfectRound\`, and never in the \`Current Season\` / \`All Time\` rows. It is orthogonal to the medal (a perfect cell keeps its 🥇 and gains the trailing ⭐).
   - \`Current Season\` (seasons ON, ALWAYS — the anchor row): label \`"${t("leaderboard.current_season")}"\`; each cell \`String(currentSeasonPoints)\`.
   - \`All Time\` (seasons ON, ONLY when \`seasonStatus.hasPriorSeasons === true\` AND \`showAllTimeRow !== false\`): label \`"${t("leaderboard.all_time")}"\`; each cell \`String(totalPoints)\`. \`showAllTimeRow\` is the tool's resolved \`allTimeRow\` decision — when the field is ABSENT, treat it as \`true\`. OMIT this row when \`hasPriorSeasons\` is false (one season makes "All Time" redundant with "Current Season") or when \`showAllTimeRow\` is false (e.g. the default \`"end-of-season-only"\` on a non-finale day).
   - SEASONS-OFF totals (\`seasonStatus\` ABSENT — no Current Season / All Time split): render ONE totals row of \`String(totalPoints)\`. When a \`This Round\` row is present, label both rows (\`"${t("leaderboard.this_round")}"\` / \`"${t("leaderboard.all_time")}"\`) WITH a leading label column; when \`This Round\` is absent, use the compact 2-row shape (names + scores, NO label column).
   - LABEL CELLS ARE PRE-LOCALIZED. The row-label cells above (and in the examples below) are already rendered in the session's output language — use them EXACTLY as written. Do NOT translate, re-word, or substitute English equivalents. The medal glyphs, \`String(...)\` numbers, em-dash \`"—"\`, and the single-space \`" "\` header cell are language-neutral and stay as-is.

   DENSE-RANK MEDAL RULE — applied to EACH medaled row INDEPENDENTLY (\`This Round\`, \`Current Season\`, \`All Time\`, the seasons-off totals row, AND the finale podium/all-time table). Rank by DISTINCT value, descending: the 1st distinct value gets \`"🥇 "\`, the 2nd \`"🥈 "\`, the 3rd \`"🥉 "\`, the 4th \`"🎀 "\`. EVERY cell holding a value gets that value's medal — TIES SHARE (two players at the top value BOTH get \`"🥇 "\`). Cells with value \`0\`, em-dash cells, and absent players receive NO medal — never, not even to fill an otherwise-empty top-4 slot. Fewer than 4 distinct values → medal only the distinct values that exist. Use the Unicode glyphs, NOT \`:first_place_medal:\`/\`:ribbon:\` shortcodes (shortcodes render as literal text inside table cells).

   \`column_settings\`: one \`{ "align": "center" }\` per column (the label column, when present, counts as one).

   Example — seasons ON, prior seasons, \`showAllTimeRow\` true, 3-question fire. Alice & Bob TIE at the top of This Round (both 🥇) AND both swept all 3 (\`perfectRound\`), so each This Round cell gets a trailing ⭐; Dave got 0 this round (no medal, no star); Bob is the all-time leader yet sits in column 2 because his round was weaker than Alice's lead:
   \`\`\`
   {
     "blocks": [ /* header, verdicts, divider, voter/round-summary sections, closer context */ ],
     "table": {
       "type": "table",
       "rows": [
         [" ",              "Alice",    "Bob",      "Carol",  "Dave"],
         ["${t("leaderboard.this_round")}",     "🥇 3 ⭐", "🥇 3 ⭐", "🥈 1",   "0"   ],
         ["${t("leaderboard.current_season")}", "🥉 5",    "🥇 12",   "🎀 3",   "🥈 8"],
         ["${t("leaderboard.all_time")}",       "🥈 9",    "🥇 30",   "🎀 4",   "🥉 6"]
       ],
       "column_settings": [
         { "align": "center" }, { "align": "center" }, { "align": "center" }, { "align": "center" }, { "align": "center" }
       ]
     },
     "actions": []
   }
   \`\`\`

   Example — single season (\`hasPriorSeasons\` false): no \`All Time\` row; the anchor row is the labeled \`Current Season\` (this REPLACES the old unlabeled two-row single-season shape):
   \`\`\`
   { "table": { "type": "table", "rows": [
       [" ",              "Alice",  "Bob"],
       ["${t("leaderboard.this_round")}",     "🥇 2",   "🥈 1"],
       ["${t("leaderboard.current_season")}", "🥇 5",   "🥈 3"]
     ], "column_settings": [ { "align": "center" }, { "align": "center" }, { "align": "center" } ] } }
   \`\`\`

   Example — seasons OFF. With a \`This Round\` row → labeled rows; without → compact 2-row (no label column):
   \`\`\`
   { "table": { "type": "table", "rows": [
       [" ",          "Alice",  "Bob"],
       ["${t("leaderboard.this_round")}", "🥇 2",   "🥈 1"],
       ["${t("leaderboard.all_time")}",   "🥇 11",  "🥈 8"]
     ], "column_settings": [ { "align": "center" }, { "align": "center" }, { "align": "center" } ] } }
   \`\`\`
   \`\`\`
   { "table": { "type": "table", "rows": [
       ["Alice",  "Bob",   "Carol", "Dave"],
       ["🥇 11",  "🥈 8",  "🥉 6",  "🎀 3"]
     ], "column_settings": [ { "align": "center" }, { "align": "center" }, { "align": "center" }, { "align": "center" } ] } }
   \`\`\`

   If the leaderboard is empty (nobody has participated yet), OMIT the \`table\` parameter entirely. Otherwise the table MUST be present — a reveal closer that mentions the scoreboard without a populated table is a visible bug.

Slack mechanics: mention users with \`<@USERID>\`; \`*bold*\` does NOT render inside \`plain_text\` headers (emojis do); use mrkdwn sparingly elsewhere — emoji and energy do most of the work.

NEVER predict timing — no "see you tomorrow", "next reveal in 24 hours", or similar. The next fire is on a separate schedule you have no visibility into.`;
}
