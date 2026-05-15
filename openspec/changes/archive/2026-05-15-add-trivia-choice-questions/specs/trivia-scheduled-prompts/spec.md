## MODIFIED Requirements

### Requirement: Send Questions Instructions Tool

The Trivia plugin SHALL expose a `send_questions_instructions` MCP tool that returns, as plain text, the full prompt the scheduled "question posting" run must follow.

The tool SHALL be gated to the `admin` role (scheduled runs execute with the creator's role, which is admin+ for any trivia setup). The tool SHALL accept no arguments in v1.

The returned prompt SHALL open with a **Game Show Presenter persona** directive ("energetic, engaging, and fun — add showmanship to your delivery") and then **branch on `suggestedType` from `get_ideas`**:

**Boolean path** (`suggestedType: "boolean"`, the existing behavior):

1. **Get category ideas and suggestions** — Call `get_ideas`. The tool returns `categories.ideas` (5 categories, excluding the last 10 used), `suggestedType: "boolean"`, `suggestedAnswer` (a boolean), and `suggestedDifficulty` (one of `"Easy"`, `"Medium"`, `"Hard"`). Pick one category from `categories.ideas`.
2. **Research a TRUE fact** about that topic, aiming at the difficulty bucket named by `suggestedDifficulty` (Easy = 4–6 on the 1–10 scale, Medium = 7–8, Hard = 9–10).
3. **Honor `suggestedAnswer`** — if `suggestedAnswer` is `true`, keep the statement TRUE. If `suggestedAnswer` is `false`, modify a key detail to make the statement FALSE. The prompt SHALL NOT instruct Claude to "randomly decide" — the random choice has already been made server-side.
4. **Duplicate check** — Call `find_previous_questions`; if a match is found, iterate from step 2.
5. **Validate** the final statement through research — confirm it is actually TRUE or FALSE, matching the `suggestedAnswer` honored in step 3.
6. **Difficulty gate** — Self-rate 1–10. Reject and regenerate if the rating is ≤ 3/10; only proceed when ≥ 4/10.
7. **Choose emojis** relating to the topic.
8. **Save via `save_question`** with `{ type: "boolean", category, statement, isTrue, emojis }`; retain the returned `questionId`.
9. **Format using Block Kit** — a single section with the statement plus 👍 (TRUE) / 👎 (FALSE) markers in that order.
10. **Deliver via `submit_response`** with `reactions: ["+1", "-1"]` in that exact order.

**Choice path** (`suggestedType: "choice"`):

1. **Get category ideas and suggestions** — Call `get_ideas`. The tool returns `categories.ideas`, `suggestedType: "choice"`, `suggestedChoiceCount` (integer in active `[min, max]`), `suggestedCorrectIndex` (integer in `[0, suggestedChoiceCount)`), and `suggestedDifficulty`. Pick one category from `categories.ideas`.
2. **Write the CORRECT answer first.** The correct answer SHALL be the option that occupies index `suggestedCorrectIndex`. The correct answer's index is locked by `suggestedCorrectIndex` — Claude MUST NOT rewrite the correct answer later to fix a gate failure, because that defeats the server-rolled correctness position.
3. **Write `suggestedChoiceCount − 1` plausible-but-wrong distractors**, filling the remaining indices.
4. **Distractor plausibility gate (REQUIRED — DO NOT SKIP):** rate each option (correct + every distractor) 1–10 on "how plausible does this sound as the correct answer to someone who doesn't know the topic" (NOT "how true is it"). Apply all four gate conditions:
   - (a) correct answer plausibility ≥ 5
   - (b) highest distractor plausibility ≥ 4
   - (c) `correct − highest_distractor ≤ 4`
   - (d) every distractor plausibility ≥ 2

   If any condition fails, rewrite **only the failing distractor(s)**, never the correct answer. Retry budget: 3 distractor-rewrite passes per question. If the gate still fails after 3 passes, abandon the question and re-roll from `get_ideas`.
5. **Difficulty gate** — Self-rate the question as a whole 1–10 against the `suggestedDifficulty` bucket. Reject and regenerate if ≤ 3/10.
6. **Duplicate check** — Call `find_previous_questions` with a distinctive keyword from the statement; iterate if a match is found.
7. **Choose emojis** relating to the topic.
8. **Save via `save_question`** with `{ type: "choice", category, statement, emojis, choices, correctIndex }` where `correctIndex === suggestedCorrectIndex`; retain the returned `questionId`.
9. **Format using Block Kit** — choose between two layouts:
   - **Stacked** (one choice per line, `1️⃣ Option`): use when any choice text exceeds roughly 25 characters or choices read more naturally on separate lines.
   - **Inline** (`1️⃣ A • 2️⃣ B • 3️⃣ C • 4️⃣ D`): use when all choices are short and read well on one line.
10. **Deliver via `submit_response`** with `reactions` sized to `suggestedChoiceCount`:
    - 2 → `["one", "two"]`
    - 3 → `["one", "two", "three"]`
    - 4 → `["one", "two", "three", "four"]`

    Order matters — `:one:` first to ensure visual ordering matches the card layout.

#### Scenario: Returns the full prompt with both paths

- **WHEN** the tool is invoked
- **THEN** it returns a non-empty string containing numbered sequences for BOTH the boolean path and the choice path
- **AND** references `get_ideas`, `find_previous_questions`, `save_question`, and `submit_response` by their bare names

#### Scenario: Prompt branches on suggestedType

- **WHEN** the tool is invoked
- **THEN** the returned text explicitly directs Claude to branch on the `suggestedType` field from `get_ideas`
- **AND** describes the boolean path and the choice path distinctly

#### Scenario: Boolean path instructs Claude to honor suggestedAnswer

- **WHEN** the tool is invoked
- **THEN** the boolean section references `suggestedAnswer` from `get_ideas`
- **AND** instructs Claude to keep the statement TRUE when `suggestedAnswer` is `true`
- **AND** instructs Claude to modify a key detail to make the statement FALSE when `suggestedAnswer` is `false`

#### Scenario: Choice path instructs Claude to write correct answer at suggestedCorrectIndex

- **WHEN** the tool is invoked
- **THEN** the choice section instructs Claude to write the correct answer FIRST and place it at the index named by `suggestedCorrectIndex`
- **AND** explicitly states that Claude MUST NOT rewrite the correct answer to fix a gate failure

#### Scenario: Choice path enforces distractor plausibility gate

- **WHEN** the tool is invoked
- **THEN** the choice section describes the plausibility rating (1–10 on "how plausible does this sound as the correct answer to someone who doesn't know the topic")
- **AND** names all four gate conditions (correct ≥ 5, highest distractor ≥ 4, gap ≤ 4, every distractor ≥ 2)
- **AND** instructs Claude to rewrite only the failing distractor(s) on gate failure
- **AND** specifies a retry budget of 3 distractor-rewrite passes per question
- **AND** instructs Claude to abandon the question and re-roll from `get_ideas` after retries are exhausted

#### Scenario: Choice path describes both stacked and inline Block Kit layouts

- **WHEN** the tool is invoked
- **THEN** the choice section describes both stacked and inline layouts
- **AND** instructs Claude to pick by readability (stacked for long choices, inline for short choices)

#### Scenario: Choice path sizes reactions array to suggestedChoiceCount

- **WHEN** the tool is invoked
- **THEN** the choice section instructs Claude to pass `reactions` sized to `suggestedChoiceCount` to `submit_response`
- **AND** specifies the exact arrays: `["one", "two"]` for 2 choices, `["one", "two", "three"]` for 3, `["one", "two", "three", "four"]` for 4
- **AND** instructs Claude to keep `:one:` first

#### Scenario: Boolean path enforces reaction ordering

- **WHEN** the tool is invoked
- **THEN** the boolean section instructs Claude to pass `reactions: ["+1", "-1"]` to `submit_response`, in that order

#### Scenario: Difficulty gate present on both paths

- **WHEN** the tool is invoked
- **THEN** both the boolean section and the choice section reference the 1–10 difficulty self-rating
- **AND** both reject questions rated ≤ 3/10

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** the tool is absent from the session's MCP catalog

### Requirement: Process Responses Instructions Tool

The Trivia plugin SHALL expose a `process_responses_instructions` MCP tool that returns, as plain text, the full prompt the scheduled "answer reveal" run must follow.

The tool SHALL be gated to the `admin` role. The tool SHALL accept no arguments in v1.

The returned prompt SHALL open with the **Game Show Presenter persona** directive and then instruct Claude through a step flow that **resolves the question and its type BEFORE parsing reactions**, then branches on `question.type` (absence reads as `"boolean"`). The prompt SHALL NOT include any cheat-detection logic or calls to `save_cheating`. The prompt MAY consume cheat data via the admin-tier `get_question_history` tool for the sole purpose of silent voter exclusion; it MUST NOT surface cheater identities or any allusion to them in the user-facing reveal.

The step flow SHALL be:

1. **Find the most recent question message** — Call `fetch_channel_messages` with `limit ≥ 20`. Take the most recent bot message containing "TRIVIA" that does NOT contain "ANSWER", "REVEALED", or "VOTING RESULTS". Verify the message has a `reactions` object.
2. **Extract the statement** from that message (strip emojis/formatting, keep the core claim).
3. **Resolve the questionId and load type + history (REQUIRED — INTERNAL STEP, NEVER SURFACE)** — Call `find_previous_questions` with a distinctive keyword from the extracted statement to locate the matching stored question; capture its `id`, `type`, and (for choice questions) `choices`. Then call `get_question_history(questionId)` to obtain the canonical answer key (`isTrue` or `correctIndex`) AND `cheaterUserIds`.

   If `find_previous_questions` returns no match or multiple matches:
   - For boolean questions: refine the keyword or fall back to the most recently `createdAt` matching question; if still ambiguous, proceed with an empty cheater list and an internal note (not surfaced).
   - For choice questions OR when the question's type cannot be determined: post a short admin-facing error in the channel (e.g. "Couldn't resolve today's question — admin help needed") and abort. The reveal MUST NOT guess `correctIndex` or proceed with a best-effort fallback.
4. **Validate truth** — research thoroughly. For boolean questions, confirm whether the statement is actually TRUE or FALSE. For choice questions, confirm the canonical correct choice. Trust your research over any single stored field, but flag any disagreement between research and the stored answer key as an internal note (not surfaced).
5. **Compose an explanation** with supporting facts.
6. **Double-check** research accuracy.
7. **Categorize reactions, branching on `question.type`** — Before any analysis, remove the bot's own user ID from every reaction list. Claude SHALL determine the bot's user ID from session context. Then remove every user ID in `cheaterUserIds` from every reaction list (silent: never mentioned, alluded to, or stylistically signalled in user-facing output).

   **For boolean questions:** `:+1:` = TRUE vote; `:-1:` = FALSE vote. Identify fence-sitters (users who reacted with both `:+1:` AND `:-1:`) and wildcards (users who used other emojis).

   **For choice questions:** `:one:`/`:two:`/`:three:`/`:four:` reactions map to choice indices 0/1/2/3. Identify:
   - **Correct voters** — users who reacted with exactly the numbered emoji corresponding to `correctIndex`.
   - **Incorrect voters** — users who reacted with exactly one wrong numbered emoji.
   - **Multi-react voters** — users who reacted with 2 or more numbered emoji. These are silently voided: excluded from scoring, excluded from `submit_answers`, NOT mentioned in the user-facing reveal (no callout, no playful roast — different from boolean fence-sitters).
   - **Wildcards** — users who reacted only with non-numbered emojis. These continue to be read aloud with persona humor, same as boolean wildcards.
8. **Partition voters** into the appropriate disjoint groups (human users only, bot AND cheaters excluded). For boolean: Correct / Incorrect / Fence-sitters / Wildcards. For choice: Correct / Incorrect / Wildcards (multi-react voters are voided and do not form a group).
9. **Submit answers BEFORE response** — Call `submit_answers` with the appropriate payload shape:
   - **Boolean:** `[{ userId, displayName, answer: boolean }]` including ONLY single-reaction voters from the post-exclusion partition (exclude fence-sitters, wildcards, cheaters). `answer: true` for `:+1:`, `false` for `:-1:`.
   - **Choice:** `[{ userId, displayName, answerIndex: number }]` including ONLY single-reaction voters from the post-exclusion partition (exclude multi-react voters, wildcards, cheaters). `answerIndex` is the numbered-emoji index.

   Wait for completion. On failure, retry once; if it still fails, proceed with `submit_response` and mention that scoring failed. `submit_response` MUST NOT be called until `submit_answers` has completed.
10. **Deliver via `submit_response`** using Block Kit blocks. The prompt SHALL require a `header` block announcing the correct answer and a `section` block explaining why. The prompt SHALL direct Claude to present the voting results while keeping the relevant voter situations in mind — varying by question type:
    - **Boolean:** CORRECT voters, INCORRECT voters, FENCE-SITTERS, WILDCARDS.
    - **Choice:** CORRECT voters, INCORRECT voters, WILDCARDS. (Multi-react voters are silently voided and NEVER surfaced.)

    The prompt SHALL NOT prescribe a fixed number of sections, fixed headings, or fixed sub-group labels. Layout is left to Claude's Game Show Presenter judgment.

    For each situation, the prompt SHALL instruct Claude to cover it ONLY if at least one qualifying user exists, and to OMIT it entirely (no heading, no placeholder, no "nobody here" line) when empty.

    Cheater identities MUST NOT appear anywhere in the reveal — no mention, callout, footnote, or aside. If silent cheater removal empties a situation, omit it under the same "skip when empty" rule, without drawing attention to the absence.

    If nobody voted at all (after excluding the bot, cheaters, and — for choice — multi-react voters), acknowledge with game-show humor.

#### Scenario: Returns the full step flow with branching

- **WHEN** the tool is invoked
- **THEN** it returns a non-empty string containing a numbered sequence
- **AND** references `fetch_channel_messages`, `find_previous_questions`, `get_question_history`, `submit_answers`, and `submit_response` by name
- **AND** does NOT reference `save_cheating`

#### Scenario: Prompt resolves question before parsing reactions

- **WHEN** the tool is invoked
- **THEN** the returned text places the `find_previous_questions` + `get_question_history` step BEFORE the reaction-categorization step
- **AND** directs Claude to read `question.type` and branch all subsequent reaction parsing on this value

#### Scenario: Prompt enforces bot exclusion without a hardcoded ID

- **WHEN** the tool is invoked
- **THEN** the returned text directs Claude to exclude the bot's own user ID from all reaction lists before analysis
- **AND** instructs Claude to determine the bot's ID from session context rather than hardcoding a specific value
- **AND** the text does NOT contain any specific deployment's bot user ID

#### Scenario: Prompt enforces silent cheater exclusion

- **WHEN** the tool is invoked
- **THEN** the returned text directs Claude to call `get_question_history` after locating the question and to remove every user ID in `cheaterUserIds` from every reaction list before voter categorization
- **AND** explicitly forbids mentioning, alluding to, or stylistically signalling the removal in the user-facing reveal
- **AND** instructs Claude to exclude those user IDs from the `submit_answers` payload as well

#### Scenario: Prompt enforces submit_answers-before-submit_response ordering

- **WHEN** the tool is invoked
- **THEN** the returned text includes an explicit rule that `submit_response` MUST NOT be called until `submit_answers` has completed
- **AND** describes the one-retry-then-proceed fallback for `submit_answers` failures

#### Scenario: Boolean branch parses thumb reactions

- **WHEN** the tool is invoked
- **THEN** the boolean branch directs Claude to interpret `:+1:` as TRUE votes and `:-1:` as FALSE votes
- **AND** names the four voter situations: CORRECT, INCORRECT, FENCE-SITTERS, WILDCARDS
- **AND** directs Claude to submit `[{ userId, displayName, answer: boolean }]` via `submit_answers`

#### Scenario: Choice branch parses numbered reactions and silently voids multi-react

- **WHEN** the tool is invoked
- **THEN** the choice branch directs Claude to interpret `:one:`/`:two:`/`:three:`/`:four:` as choice indices 0/1/2/3
- **AND** directs Claude to treat multi-react voters (2+ numbered emoji) as silently voided — excluded from scoring, excluded from `submit_answers`, NOT mentioned in user-facing reveal
- **AND** directs Claude to submit `[{ userId, displayName, answerIndex: number }]` via `submit_answers`
- **AND** names the three surfaced voter situations for choice: CORRECT, INCORRECT, WILDCARDS

#### Scenario: Choice branch hard-fails on unresolvable question

- **WHEN** the tool is invoked
- **THEN** the prompt instructs Claude that if the question cannot be resolved AND its type is `"choice"` (or cannot be determined), post a short admin-facing error in the channel and abort the reveal
- **AND** does NOT instruct Claude to guess `correctIndex` or proceed with `submit_answers` for choice questions

#### Scenario: Boolean branch preserves best-effort fallback

- **WHEN** the tool is invoked
- **THEN** the prompt instructs Claude that if a boolean question cannot be resolved cleanly, refine the keyword or pick the most recently `createdAt` matching question
- **AND** allows proceeding with an empty cheater list and an internal note if still ambiguous

#### Scenario: Prompt instructs to skip empty voter situations

- **WHEN** the tool is invoked
- **THEN** the returned text instructs Claude to cover each voter situation ONLY if at least one qualifying user exists
- **AND** instructs Claude to omit empty situations entirely — no heading, no placeholder, no "nobody here" line
- **AND** the same skip-when-empty rule applies to situations emptied by silent cheater removal or (for choice) by multi-react voiding, without drawing attention to the absence

#### Scenario: Prompt contains no cheat-detection logic

- **WHEN** the tool is invoked
- **THEN** the returned text does NOT mention `save_cheating`
- **AND** does NOT include any DM-the-owner step
- **AND** does NOT include any `<@ASKER_ID>` placeholder
