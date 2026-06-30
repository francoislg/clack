## Why

The `submit_response` required-tools gate (`src/tools/presentation/submitResponse.ts`) refuses to terminate a run until **every** tool in `requiredTools` has been called, and its rejection message instructs Claude to "Call them before submitting." In effect the gate *force-calls* every listed tool — even ones the prompt legitimately skips. Several trivia required-tools entries are **conditional** (called only sometimes), so the gate misfires on real runs.

Production transcripts confirm this is the steady state, not an edge case. Across every recent `fifa-predictions` fire (both crons), the gate bounced the first `submit_response`:

- **question** fires bounced on `find_previous_questions` + `find_previous_subjects` (the dedup gate is skipped for prediction questions; `find_previous_subjects` is image-only) — a wasted round-trip every fire.
- **reveal** fires bounced on `start_new_season` + `update_question`, then force-called the conditional tools. One reveal force-called `settle_question` with **fabricated arguments** (`override: true`, an `outcome` read off the payload) and *re-settled an already-settled question* — harmless only by luck (`rescored: 0`).

The fix is to make each list contain **only tools that are called on 100% of valid runs** — so the gate stops forcing conditional, sometimes-mutating tools.

## What Changes

- Prune `PREP_REQUIRED_TOOLS`, `QUESTION_REQUIRED_TOOLS`, and `REVEAL_REQUIRED_TOOLS` in `src/plugins/trivia/domain/buildGameSpecs.ts` to only always-called tools:
  - **PREP** → `["mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions"]` (drop `save_question`, `find_previous_subjects`).
  - **QUESTION** → `["mcp__trivia__get_ideas", "mcp__trivia__post_questions"]` for non-flexible games; `["mcp__trivia__get_ideas"]` when `game.format?.flexible` is `true` (drop `find_previous_questions`, `find_previous_subjects`, `save_question`).
  - **REVEAL** → `["mcp__trivia__compute_answers"]` (drop `settle_question`, `update_answers_block`, `start_new_season`, `update_question`).
  - **LOCK** → unchanged (`["mcp__trivia__lock_questions"]` — already minimal and idempotent).
- Update `buildGameSpecs.test.ts` to assert the pruned lists, including the flexible-vs-non-flexible question branch.
- **Delete the dead `CREATE_SCHEDULES_INSTRUCTIONS` constant** (`src/plugins/trivia/prompts/scheduledPrompts.ts`) and its test (`src/plugins/trivia/tools/seasons/seasons.test.ts`). It is a vestige of the old manual `create_scheduled_message` admin flow — it has zero production consumers and references the unregistered `send_questions_instructions` tool. Schedules are now internally managed by `buildGameSpecs` auto-reconcile, so this second hardcoded-`requiredTools` source is obsolete; removing it (rather than pruning it) eliminates the drift permanently.
- Correct the spec drift discovered in the process: both `trivia-managed-schedules` ("Required Tools…") and `trivia-scheduled-prompts` ("requiredTools per spec") still describe the pre-prune lists (and name the obsolete `process_reveal_answers`); `trivia-scheduled-prompts` additionally has a "Reveal `requiredTools` includes `update_question`" requirement that directly contradicts the prune. The deltas restate the current, pruned reality and remove the contradicting requirement.
- Document the governing invariant on `CronJobSpec.requiredTools` (only-always-called) and add a guard test asserting trivia's lists hold no conditional/mutating tools.

Out of scope (acknowledged residual): a **season**-imposed flexible format can still keep `post_questions` required on a zero-question day (because `buildGameSpecs` is season-independent by design), leaving the `post_questions` `.min(1)` deadlock for that narrow case. Closing it fully would require an empty-array no-op on `post_questions`; deferred.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `trivia-managed-schedules`: the "Required Tools Derive From Seasons Gate" requirement is replaced — required-tools lists now derive from the **only-always-called** principle (question list branches on `game.format.flexible`; reveal list is `[compute_answers]`), correcting the stale `process_reveal_answers` reference.
- `trivia-question-prep`: the prep cron `requiredTools` requirement drops `save_question` (a full pool legitimately no-ops, calling `save_question` zero times), leaving `[get_ideas, find_previous_questions]`.
- `trivia-scheduled-prompts`: the "requiredTools per spec" requirement is updated to the pruned lists (question branches on flexibility; reveal is `[compute_answers]`), and the "Reveal `requiredTools` includes `update_question`" requirement is **removed** (the prune drops `update_question` from the reveal list — it is now invoked by the prompt only when `includeRevealInQuestions` is `"yes"`, never gate-forced).

## Impact

- Code: `src/plugins/trivia/domain/buildGameSpecs.ts` (the three constant arrays + the per-game question-list branch), `src/plugins/trivia/domain/buildGameSpecs.test.ts`, `src/plugins/trivia/prompts/scheduledPrompts.ts` (delete `CREATE_SCHEDULES_INSTRUCTIONS`), `src/plugins/trivia/tools/seasons/seasons.test.ts` (delete its test + import), and `src/plugins/sdk.ts` (doc comment on the `CronJobSpec.requiredTools` field — the plugin-facing spec type).
- Behavior: removes a wasted submit→bounce→retry round-trip on every trivia fire and eliminates the forced-mutation hazard on reveals. No user-visible output change; no migration; no config change.
- The gate mechanism itself (`submitResponse.ts`) is untouched — this is purely a correction of which tools each trivia cron declares as required.
