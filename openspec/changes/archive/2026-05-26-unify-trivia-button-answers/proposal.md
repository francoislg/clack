## Why

Trivia today has two answer-submission paths: emoji reactions (boolean/choice) and a button-triggered modal (freeform). Reaction order on the question card is not guaranteed by Slack, which makes 1️⃣/2️⃣/3️⃣/4️⃣ multiple-choice voting routinely confusing. Reactions also conflate "I'm voting" with "I'm reacting for fun" — the reveal flow then has to filter out the fun reactions, void multi-react voters, and infer scoring from imperfect signals. Unifying every format around button-driven submission ends the ordering problem, makes the live roster footer feel coherent across formats, and turns emoji reactions into pure color commentary that the reveal flow can riff on without trying to score them.

## What Changes

- **BREAKING**: Boolean and choice questions are now answered via ordered buttons (`👍 TRUE`/`👎 FALSE` for boolean; `1️⃣ <text>`, `2️⃣ <text>`, … for choice) instead of emoji reactions. Button clicks write directly to `answers.json`.
- **BREAKING**: The `submit_answers` MCP tool is removed. `process_reveal_answers` no longer derives scoring from Slack reactions for boolean/choice — answers are read directly from disk, exactly like the freeform path already does.
- **BREAKING**: Reaction-based vote attachment (the `["+1","-1"]` / `["one","two","three","four"]` automatic reactions added by `post_questions`) is removed. Users may still react freely; reactions are read at reveal time purely as color commentary.
- **BREAKING**: The reveal payload's `voters` shape changes — `fenceSitters` is removed (structurally impossible with buttons), `wildcards` is replaced by a flat `noAnswer` bucket (reacted but didn't click) plus a per-user `reactions` array (every reactor's full emoji set, minus bot and cheaters) for commentary.
- The question card's block layout collapses from FIVE-BLOCK (header / patter / card / answer-options text / closer) to FOUR-BLOCK + actions (header / patter / card / closer + actions block). The inline `"👍 TRUE · 👎 FALSE"` / `"1️⃣ Beatles · 2️⃣ Zeppelin · …"` text block is removed — buttons carry the affordance directly.
- A live "📝 Answered" roster footer (matching freeform's existing pattern) is added to all formats. Default rendering groups answerers by the answer they picked, capped at 5 most recent per group with a `+N` overflow indicator, falls back from a compact single-line to a multiline layout when the compact form exceeds Slack's safe character window.
- New cascading config field `liveAnswersVisible: boolean` (cascade order: `slot → season → game → workspace`, default `true`) controls whether the roster footer reveals each answerer's pick alongside their name. Resolved at `post_questions` time and stamped on the question record so mid-round config edits don't flip live behavior. Applies uniformly to boolean, choice, and freeform.
- New cascading config field `revealResponses: 'no' | 'just-correctness' | 'yes'` (cascade order: `slot → season → game → workspace`, default `'yes'`) controls how much per-question participation detail the reveal renders. `'yes'` keeps today's full named-bucket rendering (and freeform answerText quoting). `'just-correctness'` enumerates named voter buckets but strips freeform `answerText` so typed answers stay anonymous. `'no'` renders just the answer plus reaction commentary plus the leaderboard — no participation info at all. Resolved at `post_questions` time and stamped on the question record alongside `liveAnswersVisible`. The leaderboard and reactions commentary always render regardless of mode.
- Cheater handling moves to read-time filtering only. `editRosterIntoCard` strips flagged cheaters from the live footer; the reveal payload builder strips them from voter buckets and the commentary list. The reaction-list cheater-stripping step (`cleanReactionLists`) is removed along with the rest of the reaction-derivation pipeline.

## Capabilities

### New Capabilities

(none — this proposal extends existing capabilities only)

### Modified Capabilities

- `trivia-question-posting`: `post_questions` no longer attaches scoring reactions for boolean/choice; appends an `actions` block with ordered buttons for all three formats. Resolves and stamps `liveAnswersVisible` on each question record at post time.
- `trivia-reveal-processor`: scoring no longer derives from Slack reactions for boolean/choice — answers are read from `answers.json` (same source as freeform). Voter payload shape becomes a discriminated union on the question's stamped `revealResponses` value (`'yes'` carries full named buckets including freeform `answerText`; `'just-correctness'` carries named buckets WITHOUT `answerText`; `'no'` carries only the `reactions` commentary list). `fenceSitters` removed, `wildcards` replaced by `noAnswer` + per-user `reactions`. Reactions are fetched purely for commentary, with bot + cheaters stripped. `roundSummary.perPlayer` is omitted from multi-question reveal payloads when any slot in the batch has `revealResponses !== 'yes'`.
- `trivia-batch-answers`: **removed**. The `submit_answers` MCP tool and its surface area are deleted; button-click handlers write directly to the data layer.
- `trivia-choice-questions`: UX rewrite — choices are presented as buttons (numbered emoji prefix + choice text), not as a numbered text list with reaction voting. The inline numbered-options block is removed.
- `trivia-games`: new optional `liveAnswersVisible?: boolean` and `revealResponses?: 'no' | 'just-correctness' | 'yes'` on `TriviaGame`, participating in their respective cascades.
- `trivia-seasons`: new optional `liveAnswersVisible?: boolean` and `revealResponses?: 'no' | 'just-correctness' | 'yes'` on `SeasonEntry` and on per-slot entries within `SeasonFormat`, participating in their respective cascades.
- `trivia-scheduled-prompts`: question-posting prompt updated to describe the FOUR-BLOCK layout and the button-driven affordance. Choice-path and boolean-path inline answer-options text instructions removed. Reveal prompt updated to describe the new voter payload shape (no fence-sitters, `noAnswer` + `reactions` for commentary).

## Impact

- **Affected code**:
  - `src/plugins/trivia/tools/questions/postQuestions.ts` — `deriveReactions` removed; `appendFreeformAnswerButton` generalized into a shape-aware action-block builder for all three formats; `liveAnswersVisible` cascade resolution + stamping
  - `src/plugins/trivia/tools/answers/submitAnswers.ts` — deleted
  - `src/plugins/trivia/tools/answers/submitAnswers.choice.test.ts` — deleted
  - `src/plugins/trivia/freeform/handlers.ts`, `freeform/modal.ts`, `freeform/roster.ts` — handlers + roster generalize to all formats (modal stays freeform-only)
  - `src/plugins/trivia/tools/reveal/categorize.ts` — `cleanReactionLists`, `categorizeBoolean`, `categorizeChoice`, `NUMBERED_REACTION_INDEX`, `THUMBS_UP_REACTIONS`, `THUMBS_DOWN_REACTIONS` removed; replaced by a small helper that partitions `answers.json` rows by `correct`
  - `src/plugins/trivia/tools/reveal/processRevealAnswers.ts` — `processOneTarget` rewritten to read from `answers.json`; reactions still fetched but only for commentary
  - `src/plugins/trivia/tools/reveal/types.ts` — `VoterBuckets` shape change
  - `src/plugins/trivia/core/types.ts` — `TriviaQuestion` gains `liveAnswersVisible?: boolean` and `revealResponses?: 'no' | 'just-correctness' | 'yes'`; `TriviaGame`, `SeasonEntry`, `SeasonFormat` slot entries gain the same two optional fields
  - `src/plugins/trivia/core/configParsers/` — parsers updated to accept the new field with proper validation
  - `src/plugins/trivia/prompts/scheduledPrompts.ts` — block layout instructions rewritten (FIVE-BLOCK → FOUR-BLOCK); reveal prompt updated for new voter payload shape
  - `src/plugins/trivia/index.ts` — `submit_answers` tool registration removed; freeform handler registration broadened to cover all three formats
  - Tests across the trivia plugin — `choiceFlow.integration.test.ts`, `format.integration.test.ts`, `categorize.test.ts`, `processRevealAnswers.test.ts`, `postQuestions.test.ts`, `submitAnswers.choice.test.ts`, plus any freeform handler tests
- **Affected data**: no migration required — `answers.json` already supports both `answer` and `answerIndex` shapes; new `liveAnswersVisible` field on question records is optional and reads-as-`true` on legacy rows
- **Operational note**: no in-flight back-compat code. Deploy during a quiet window after all pending questions have been revealed
- **External APIs**: none — the Slack API surface used (`chat.postMessage`, `chat.update`, button action callbacks) is already in use for freeform
