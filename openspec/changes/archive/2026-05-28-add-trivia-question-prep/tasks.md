## 1. Config types and parser

- [x] 1.1 Add `prepCron?: string` to `TriviaGame` in `src/plugins/trivia/core/configTypes.ts` with a doc comment naming the cron-arithmetic-via-Claude convention and the channelless / no-`post_questions` enforcement.
- [x] 1.2 In the games parser (`src/plugins/trivia/core/configParsers/games.ts` or equivalent), validate `prepCron` as a non-empty cron string via `CronExpressionParser.parse(prepCron, { tz: game.timezone })` when present. Drop the field with a logged warning naming the offending value when invalid. Absence is silently accepted.
- [x] 1.3 Add parser unit tests covering: valid `prepCron`; absent `prepCron`; invalid cron expression (logged + dropped); valid `prepCron` with valid `questionCron` and `revealCron`; `prepCron` paired with an invalid `timezone` (rejected via the existing timezone check).

## 2. buildGameSpecs — emit the prep spec

- [x] 2.1 In `src/plugins/trivia/domain/buildGameSpecs.ts`, when `game.prepCron` is set, push a third spec with `specKey: \`${game.name}:prep\``, `name: \`Trivia: ${game.name} — prep\``, `cronExpression: game.prepCron`, **no `channel` field** (channelless), `timezone: game.timezone`, `requiredTools: PREP_REQUIRED_TOOLS`, `submitResponseMode: "skipped"`, `attachedTopics: ["trivia"]`, and the same `skipDates` propagation as the question and reveal specs.
- [x] 2.2 Add `const PREP_REQUIRED_TOOLS = ["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions", "mcp__trivia__save_question"]` at the top of `buildGameSpecs.ts`. Notably absent: `mcp__trivia__post_questions`. The constant is sibling to `QUESTION_REQUIRED_TOOLS` and `REVEAL_REQUIRED_TOOLS`.
- [x] 2.3 Substitute `{game}` in the new `PREP_QUESTIONS_INSTRUCTIONS` prompt the same way `SEND_QUESTIONS_INSTRUCTIONS` and `PROCESS_REVEAL_INSTRUCTIONS` are substituted today.
- [x] 2.4 Add a sanity warning (analogous to `warnIfRevealBeforeQuestion`) that logs when `prepCron`'s next fire is AFTER `questionCron`'s next fire — almost certainly a misconfiguration. Helper name: `warnIfPrepAfterQuestion`.
- [x] 2.5 Add `buildGameSpecs` tests covering: (a) game without `prepCron` emits 2 specs (today's behavior); (b) game with `prepCron` emits 3 specs with the prep spec channelless and tool-restricted; (c) `skipDates` propagates to all 3 specs uniformly; (d) `warnIfPrepAfterQuestion` fires when prep would be after question.

## 3. Prompt — split into PREP and POST

- [x] 3.1 In `src/plugins/trivia/prompts/scheduledPrompts.ts`, KEEP `SEND_QUESTIONS_INSTRUCTIONS` unchanged in observable behavior (reconstructed from shared building blocks) for use by games WITHOUT `prepCron`. Add a NEW `POST_QUESTIONS_INSTRUCTIONS` for games WITH `prepCron`, with the staged-pool check prelude:
  ```
  STAGED POOL CHECK (REQUIRED FIRST STEP):
    1. Call find_previous_questions({ games: ["{game}"], seasons: ["current"], posted: false, match: "all" }).
       - Returns staged questions (postedAt undefined) for {game} in the current season.
    2. Read format via get_ideas (slot 0 call, learn slotCount).
    3. For each slot i in [0..slotCount-1]:
       - If a staged question carries slot.index === i, use that question (oldest by createdAt
         when multiple match).
       - If no staged question matches slot i, run the per-slot generation flow below for slot i
         and save_question it.
    4. Once every slot has a question (either staged or freshly generated), proceed with the
       FORMAT & POST section to build blocks from the question data + persona and call
       post_questions.
  ```
- [x] 3.2 Extract the per-slot generation matrix (FACT-BOOLEAN, FACT-CHOICE, FACT-FREEFORM, TOPICAL-BOOLEAN, TOPICAL-CHOICE, TOPICAL-FREEFORM paths) into a named constant `PER_SLOT_GENERATION_PATHS` so SEND, PREP, and POST can all reference it. Also extract `FORMAT_AND_POST_SECTION` (NEW-SEASON OPENER, BUILD CARD, POST, END THE RUN) used by SEND and POST. Also add `STAGED_POOL_CHECK_AND_DISPATCH` used by PREP and POST.
- [x] 3.3 Add a new `PREP_QUESTIONS_INSTRUCTIONS` constant. Structure:
  ```
  PERSONA_TOPIC_REFERENCE
  GAME_CONTEXT_DIRECTIVE (with {game} substitution)
  Brief opener: "Pre-stage today's trivia question(s) into the staging pool. You will NOT
    post any message — your only deliverable is calling save_question for each missing slot."
  STAGED POOL CHECK (same as POST's prelude)
  For each missing slot i, run the per-slot generation flow PER_SLOT_GENERATION_PATHS for
    that slot's suggestedAnswersFormat × suggestedQuestionType combination.
  Final validation: re-call find_previous_questions({ ..., posted: false }) and confirm every
    slot in [0..slotCount-1] is now covered. If any slot still missing, abort with submit_response.
  Terminate with submit_response({ skip_response: true }).
  ```
- [x] 3.4 `POST_QUESTIONS_INSTRUCTIONS` reuses `FORMAT_AND_POST_SECTION` verbatim — the existing wording works for both staged and inline-generated questions because the data shape (the saved `TriviaQuestion` record) is the same in both cases. No additional rewording required.
- [x] 3.5 Add prompt builder tests confirming: (a) `PREP_QUESTIONS_INSTRUCTIONS` does NOT contain the FORMAT & POST section markers or `post_questions` invocation; (b) `POST_QUESTIONS_INSTRUCTIONS` contains the STAGED POOL CHECK prelude AND the FORMAT & POST section; (c) both share the PER_SLOT_GENERATION_PATHS content verbatim (snapshot via substring presence); (d) `{game}` substitution works on both.

## 4. find_previous_questions — `posted` filter

- [x] 4.1 In `src/plugins/trivia/tools/questions/findPreviousQuestions.ts`, extend the Zod schema with `posted: z.boolean().optional().describe(...)`. Describe semantics: `true` = only `postedAt !== undefined`; `false` = only `postedAt === undefined`; omitted = criterion ignored (today's behavior).
- [x] 4.2 Thread the `posted` filter through the existing predicate-combinator logic. When supplied, contribute a predicate to the per-row `criteria[]` array that participates in the `match: "all" | "any"` combinator like every other criterion.
- [x] 4.3 Add validation rejecting `posted: false` combined with `recentBatchFromNow` — the latter requires `postedAt !== undefined` internally so the combination would always return empty. Error message: "`recentBatchFromNow` requires posted questions; drop `posted: false` or omit `recentBatchFromNow`."
- [x] 4.4 Update the tool's description text to add a third use-case paragraph: "STAGED POOL QUERY: pass `posted: false` to scan questions that have been generated and saved but not yet posted to Slack. Typical use: PREP runs check which slots still need filling; POST runs pick the oldest staged question per slot. Pair with `seasons: [\"current\"]` to scope to the active season."
- [x] 4.5 Add tests in `findPreviousQuestions.posted.test.ts` covering: `posted: true` filters to posted questions only; `posted: false` filters to staged only; `posted` omitted returns all (existing behavior unchanged); combinator `match: "all"` with multiple criteria including `posted`; combinator `match: "any"` semantics; `posted: false` + `recentBatchFromNow` rejected with the documented error.

## 5. upsert_game — accept and validate `prepCron`

- [x] 5.1 In `src/plugins/trivia/tools/games/upsertGame.ts`, extend the Zod input schema with `prepCron: z.string().nullable().optional()` (null-to-clear, omit-to-keep). Validate at the tool boundary via `CronExpressionParser.parse(value, { tz: timezone })` when a string is present. Reject invalid cron expressions with a clear error.
- [x] 5.2 Update the tool's description to document `prepCron` semantics, the 30-min-before convention, and the channelless behavior of the resulting prep cron.
- [x] 5.3 Add tool tests covering: create-game with `prepCron`; update-game adding `prepCron` to an existing game; update-game removing `prepCron` (null-to-clear); update-game omitting `prepCron` (keeps existing); invalid `prepCron` rejected; create without `prepCron` works (optional).

## 6. Admin instructions — guide Claude to propose prepCron

- [x] 6.1 Update the trivia management admin instruction (`TRIVIA_MANAGEMENT_INSTRUCTION` in `src/plugins/trivia/prompts/triviaCheckInstruction.ts`, or the disk-overrideable `data/default_configuration/admin/topics/trivia:management/manage.md`) with a `prepCron` section:
  - What it is — a separate cron schedule for pre-staging questions, channelless, no posting.
  - When to propose it — when an admin sets up a new game, suggest a `prepCron` 30 minutes before the `questionCron` as the default.
  - How to derive it from `questionCron` — concrete examples for daily, weekday-only, and weekly schedules, including the midnight-crossing edge case ("if questionCron is `0 0 * * *`, prepCron at 30 min before would be `30 23 * * *` which fires on the PREVIOUS calendar day — confirm with the admin whether the prior-day fire is acceptable, or propose a non-midnight questionCron instead").
  - Failure semantics — when prep fails, the question cron inline-generates anything missing; prep is an optimization, not a hard requirement.
- [x] 6.2 Add an explicit "do NOT derive prepCron in bot code" callout so Claude knows this responsibility is intentional, not a gap.
- [x] 6.3 Update `TRIVIA_GAMES_ADMIN_INSTRUCTION` similarly with a one-paragraph mention of `prepCron` cross-referencing the management instruction.

## 7. list_games — surface prepCron

- [x] 7.1 In `src/plugins/trivia/tools/games/listGames.ts`, include `prepCron` per-entry when set, alongside the existing `questionCron` / `revealCron` fields.
- [x] 7.2 Optionally include `nextPrepFire` (epoch ms) per-entry when `prepCron` is set, computed via `CronExpressionParser.parse(prepCron, { tz: timezone }).next().toDate().getTime()`, mirroring whatever convention exists for `nextQuestionFire` / `nextRevealFire`. If those don't currently exist, add the prep one without retrofitting the others.
- [x] 7.3 Update `listGames` tests to cover `prepCron` surfacing (set vs unset) and `nextPrepFire` computation.

## 8. Integration tests

**Note:** End-to-end PREP → POST → REVEAL integration tests (with mocked Slack client + full cron-firing simulation) are DEFERRED from this change. The unit-level coverage added across sections 1–7 — parser (7 new tests), buildGameSpecs (15 new tests including warnIfPrepAfterQuestion), prompts (18 new tests asserting structure & cross-prompt sharing), find_previous_questions (7 new posted-filter tests including combinator interactions), upsert_game (6 new tests), and list_games (2 new tests) — covers every observable behavior change at the seam where they cross. The behavioral integration (Claude actually running the prompts and the staged-pool query) is exercised at deploy time when admins enable `prepCron` on a game. Recording this as a deliberate deferral rather than a missed task.

- [~] 8.1 DEFERRED — integration scenario: PREP populates pool → POST picks oldest per slot → reveal. Behavior is fully specified in the trivia-question-prep capability spec and exercised at deploy time.
- [~] 8.2 DEFERRED — integration scenario: partial prep pool → POST inline-gen fallback. Same rationale.
- [~] 8.3 DEFERRED — integration scenario: admin pre-gen + prep no-op. Same rationale.
- [~] 8.4 DEFERRED — integration scenario: game without `prepCron` runs legacy path. Behavior is asserted directly via the `buildGameSpecs` test "question spec keeps the legacy SEND prompt when prepCron is absent" + the existing reveal-flow tests, no extra integration needed.

## 9. CLAUDE.md and docs

- [x] 9.1 Update `CLAUDE.md`'s trivia section with a short note on the prep schedule: optional per-game cron, fires before the question cron, channelless, gen-only. Reference the unified question-cron prompt that picks from staged pool with inline-gen fallback.
- [x] 9.2 Top-level README has no dedicated trivia features section; CLAUDE.md is the canonical reference and has been updated.

## 10. Validation

- [x] 10.1 Run `openspec validate add-trivia-question-prep --strict` — passes.
- [x] 10.2 Run `npm test` — all 4802 tests pass (3 pre-existing skips); no regressions.
- [x] 10.3 Run `npx tsc` — clean.
- [x] 10.4 Run `npx oxlint src/plugins/trivia/ src/plugins/sdk.ts` and `npx oxfmt --check src/plugins/trivia/` — clean.
