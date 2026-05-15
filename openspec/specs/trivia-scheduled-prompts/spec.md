# trivia-scheduled-prompts Specification

## Purpose

Plugin-owned instruction tools that return on-demand prompts for the Trivia game's scheduled runs (question posting, answer reveal) and an admin-facing setup recipe that creates the matching cron jobs. Cron job prompts are thin dispatchers; the substantive behavior lives in the plugin's TypeScript constants.

## Requirements

### Requirement: Send Questions Instructions Tool

The Trivia plugin SHALL expose a `send_questions_instructions` MCP tool that returns, as plain text, the full prompt the scheduled "question posting" run must follow.

The tool SHALL be gated to the `admin` role (scheduled runs execute with the creator's role, which is admin+ for any trivia setup). The tool SHALL accept no arguments in v1.

The returned prompt SHALL open with a **Game Show Presenter persona** directive ("energetic, engaging, and fun — add showmanship to your delivery") and then instruct Claude through the following ten-step flow, preserving the substantive behavior of the live cron job prior to this change:

1. **Get category ideas and suggestions** — Call `get_ideas`. The tool returns `categories.ideas` (5 categories, excluding the last 10 used), `suggestedAnswer` (a boolean), and `suggestedDifficulty` (one of `"Easy"`, `"Medium"`, `"Hard"`). Pick one category from `categories.ideas`. Read both `suggestedAnswer` and `suggestedDifficulty` — they steer the next steps.
2. **Research a TRUE fact** about that topic, aiming at the difficulty bucket named by `suggestedDifficulty` (Easy = 4–6 on the 1–10 scale, Medium = 7–8, Hard = 9–10).
3. **Honor `suggestedAnswer`** — if `suggestedAnswer` is `true`, keep the statement TRUE. If `suggestedAnswer` is `false`, modify a key detail to make the statement FALSE (e.g., swap "shrimp" → "lobster"). The prompt SHALL NOT instruct Claude to "randomly decide" — the random choice has already been made server-side.
4. **Duplicate check** — Call `find_previous_questions`; if a match is found, iterate from step 2.
5. **Validate** the final statement through research — confirm it is actually TRUE or FALSE, matching the `suggestedAnswer` honored in step 3.
6. **Difficulty gate** — Self-rate 1–10. The target range is the one named by `suggestedDifficulty` (Easy = 4–6, Medium = 7–8, Hard = 9–10). Reject and regenerate if the rating is ≤ 3/10; only proceed when ≥ 4/10. The bucket-mapped target supersedes the legacy "5–7/10 sweet spot" guidance.
7. **Choose emojis** relating to the topic.
8. **Save via `save_question`** with `{ category, statement, isTrue, emojis }`; retain the returned `questionId`. `isTrue` SHALL reflect the statement Claude actually produced (and, by the rule in step 3, SHOULD match `suggestedAnswer`).
9. **Format using Block Kit `sections`** — no Markdown bold/italic, no `##` headers. A single section, plain text plus emojis. The 👍 (TRUE) marker MUST appear before the 👎 (FALSE) marker. The prompt SHALL encourage Claude to invent a style that fits the day and include at least one concrete example (without prescribing a rotation) so the delivery varies over time.
10. **Deliver via `submit_response`** with `reactions: ["+1", "-1"]` in that exact order (ensures 👍 renders before 👎).

#### Scenario: Returns the full ten-step schedule prompt

- **WHEN** the tool is invoked
- **THEN** it returns a non-empty string containing a numbered sequence covering all ten steps above
- **AND** references the plugin's own tools (`get_ideas`, `find_previous_questions`, `save_question`) by their bare names
- **AND** references `submit_response` for delivery

#### Scenario: Prompt instructs Claude to honor suggestedAnswer

- **WHEN** the tool is invoked
- **THEN** the returned text references `suggestedAnswer` from `get_ideas`
- **AND** instructs Claude to keep the statement TRUE when `suggestedAnswer` is `true`
- **AND** instructs Claude to modify a key detail to make the statement FALSE when `suggestedAnswer` is `false`
- **AND** does NOT instruct Claude to "randomly decide" the truth value

#### Scenario: Prompt instructs Claude to target suggestedDifficulty

- **WHEN** the tool is invoked
- **THEN** the returned text references `suggestedDifficulty` from `get_ideas`
- **AND** spells out the bucket-to-1–10 mapping: Easy = 4–6, Medium = 7–8, Hard = 9–10
- **AND** instructs Claude to aim the question at the bucket's range when researching and when self-rating

#### Scenario: Prompt enforces the difficulty gate

- **WHEN** the tool is invoked
- **THEN** the returned text contains an explicit rule that questions rated ≤ 3/10 MUST be rejected and regenerated
- **AND** ties the target range to the bucket named by `suggestedDifficulty`

#### Scenario: Prompt enforces reaction ordering

- **WHEN** the tool is invoked
- **THEN** the returned text instructs Claude to pass `reactions: ["+1", "-1"]` to `submit_response`, in that order
- **AND** instructs Claude that 👍 (TRUE) must be mentioned before 👎 (FALSE) in the message body

#### Scenario: Prompt invites invented styles and provides at least one example

- **WHEN** the tool is invoked
- **THEN** the returned text explicitly invites Claude to invent its own style each day
- **AND** includes at least one concrete example for inspiration
- **AND** does NOT prescribe a fixed rotation or a required set of named styles

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** the tool is absent from the session's MCP catalog

### Requirement: Process Responses Instructions Tool

The Trivia plugin SHALL expose a `process_responses_instructions` MCP tool that returns, as plain text, the full prompt the scheduled "answer reveal" run must follow.

The tool SHALL be gated to the `admin` role. The tool SHALL accept no arguments in v1.

The returned prompt SHALL open with the **Game Show Presenter persona** directive and then instruct Claude through the following step flow, preserving the substantive behavior of the live cron job prior to this change. The prompt SHALL NOT include any cheat-detection logic or calls to `save_cheating` — cheat detection is handled exclusively by the `trivia-check` interactive-session instruction. The prompt MAY consume cheat data via the admin-tier `get_question_history` tool for the sole purpose of silent voter exclusion; it MUST NOT surface cheater identities or any allusion to them in the user-facing reveal.

1. **Find the most recent question message** — Call `fetch_channel_messages` with `limit ≥ 20`. Take the most recent bot message containing "TRIVIA" that does NOT contain "ANSWER", "REVEALED", or "VOTING RESULTS" (those are prior reveals). Verify the message has a `reactions` object.
2. **Extract the statement** from that message (strip emojis/formatting, keep the core claim).
3. **Validate truth** — Research thoroughly.
4. **Compose an explanation** with supporting facts.
5. **Double-check** research accuracy.
6. **Resolve the questionId and load history** — Call `find_previous_questions` with a distinctive keyword from the extracted statement to locate the matching stored question; capture its `id`. Then call `get_question_history(questionId)` to obtain `cheaterUserIds` for that question. If `find_previous_questions` returns no match or multiple matches, the prompt SHALL direct Claude to refine the keyword or fall back to the most recently `createdAt` matching question; if still ambiguous, proceed with an empty cheater list and flag the ambiguity in an internal note (not surfaced in the reveal).
7. **Check season status (only when `trivia.seasons.enabled` is `true`)** — Call `check_season_status` and capture both `currentSlug` and `isLastFireOfSeason`. When `seasons.enabled` is `false`, this step SHALL be omitted entirely from the prompt — `check_season_status` is not referenced.
8. **Categorize reactions, excluding the bot AND silently excluding cheaters** — Before any analysis, remove the bot's own user ID from every reaction list (the bot's self-reactions must never count as votes). Claude SHALL determine the bot's user ID from its own session context rather than relying on a hardcoded value. Then remove every user ID present in `cheaterUserIds` (from step 6) from every reaction list. The exclusion is silent: Claude MUST NOT mention, allude to, or stylistically signal these removals in the user-facing reveal. After both removals, `:+1:` = TRUE vote; `:-1:` = FALSE vote. Identify fence-sitters (users who reacted with both `:+1:` AND `:-1:`) and wildcards (users who used other emojis) from the post-exclusion lists.
9. **Partition voters** into four disjoint groups (human users only, bot AND cheaters excluded): **Correct** (voted the right answer, single reaction), **Incorrect** (voted the wrong answer, single reaction), **Fence-sitters** (both `:+1:` and `:-1:`), **Wildcards** (other emojis).
10. **Submit answers BEFORE response** — Call `submit_answers` with `[{ userId, displayName, answer: boolean }]` including ONLY single-reaction voters from the post-exclusion partition (exclude fence-sitters, wildcards, AND cheaters from scoring). `answer: true` for `:+1:`, `false` for `:-1:`. Wait for completion. On failure, retry once; if it still fails, proceed with `submit_response` and mention that scoring failed. `submit_response` MUST NOT be called until `submit_answers` has completed.
11. **Retrieve leaderboard scores** — Call `retrieve_scores`. When `seasons.enabled` is `true`, the default `season: "current"` SHALL be used (no explicit arg required); the returned leaderboard entries SHALL contain both current-season and all-time totals per the `trivia-batch-answers` spec. When `seasons.enabled` is `false`, the returned leaderboard SHALL contain cumulative totals only.
12. **Deliver via `submit_response`** using Block Kit blocks (Clack's curated subset: divider, header, section, context, image). The prompt SHALL require a `header` block announcing the correct answer and a `section` block explaining why, and SHALL then direct Claude to present the voting results while keeping the four voter situations in mind — **CORRECT voters**, **INCORRECT voters**, **FENCE-SITTERS**, **WILDCARDS**. The prompt SHALL NOT prescribe a fixed number of sections, fixed headings, or fixed sub-group labels for the voting results; layout is left to Claude's Game Show Presenter judgment.
    - For each of the four situations, the prompt SHALL instruct Claude to cover it ONLY if at least one qualifying user exists, and to OMIT it entirely (no heading, no placeholder, no "nobody here" line) when empty.
    - Cheater identities MUST NOT appear anywhere in the reveal — no mention, callout, footnote, or aside. If silent cheater removal empties a situation, the prompt SHALL instruct Claude to omit it under the same "skip when empty" rule, without drawing attention to the absence.
    - If nobody voted at all (after excluding the bot and cheaters), acknowledge with game-show humor. Do NOT include a leaderboard snippet.
    - **When `trivia.seasons.enabled` is `true` AND step 7 reported `isLastFireOfSeason: true`**, the prompt SHALL additionally instruct Claude to render a **season-finale section** *above* the leaderboard table. The finale SHALL: name the closing season slug, give a brief Game-Show-Presenter wrap-up paragraph in persona, and call out the season MVP (the player at index 0 of the current-season-ordered leaderboard from step 11). The finale SHALL NOT preview the next season's slug — that is announced only after step 13 has run.
    - **Leaderboard table shape**:
      - When `seasons.enabled` is `false`: render the 2-row table (names row with medals + scores row), as before this change.
      - When `seasons.enabled` is `true`: render the 3-row table (empty-cell + names; "Current Season" + current counts with per-row top-3 medals; "All Time" + total counts with per-row top-3 medals). Columns are ordered by `currentSeasonCorrect` descending; players with `currentSeasonCorrect: 0` AND `currentSeasonAnswered: 0` SHALL be omitted from the table. Medal assignment on the All Time row SHALL be computed independently of the Current Season row's medal assignment.
13. **Close the current season and ensure continuity (only when `trivia.seasons.enabled` is `true` AND step 7 reported `isLastFireOfSeason: true`)** — As the final action of the reveal flow, after `submit_response` has been issued:
    a. Call `upsert_season(currentSlug, { endedAt: <Date.now()> })` to stamp the actual end time on the closing season. This is idempotent.
    b. Examine the `nextSeasonSlug` field from the step 7 `check_season_status` return. If non-null, a queued continuation already exists; do nothing further (the timeline takes over naturally). If `null`, call `upsert_season(<derived slug>, { startedAt: <now>, expectedEndAt: <derived from trivia.seasons.prompt>, categories?: [...themed] })` to create one. Arguments derived from `trivia.seasons.prompt`: slug per its style guidance; `expectedEndAt` per its cadence guidance; `categories` populated with ~20 themed entries ONLY when the prompt or slug implies a clear theme — these REPLACE the baseline (not augment); omit `categories` for non-themed seasons to copy from `categories.json`.
    c. The reveal has already been delivered — do NOT post a follow-up message about season transitions. The finale section already announced the closing season; the new season (if any) will announce itself via its first question post.

    When `seasons.enabled` is `false` OR step 7 reported `isLastFireOfSeason: false`, step 13 SHALL be omitted entirely.

#### Scenario: Returns the full step flow

- **WHEN** the tool is invoked
- **THEN** it returns a non-empty string containing a numbered sequence covering all steps above
- **AND** references `fetch_channel_messages`, `find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, and `submit_response` by name
- **AND** does NOT reference `save_cheating`

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

#### Scenario: Prompt names the four voter situations to cover

- **WHEN** the tool is invoked
- **THEN** the returned text names all four voter situations Claude must keep in mind: CORRECT voters, INCORRECT voters, FENCE-SITTERS, and WILDCARDS
- **AND** does NOT mandate fixed sub-group labels (e.g. "Nailed it!", "Not quite!") or a rigid four-subsection layout — Claude is free to arrange the voting results however the Game Show Presenter persona deems best

#### Scenario: Prompt instructs to skip empty voter situations

- **WHEN** the tool is invoked
- **THEN** the returned text instructs Claude to cover each voter situation ONLY if at least one qualifying user exists
- **AND** instructs Claude to omit empty situations entirely — no heading, no placeholder, no "nobody here" line
- **AND** the same skip-when-empty rule applies to situations emptied by silent cheater removal, without drawing attention to the absence

#### Scenario: Prompt contains no cheat-detection logic

- **WHEN** the tool is invoked
- **THEN** the returned text does NOT mention `save_cheating`
- **AND** does NOT include any DM-the-owner step
- **AND** does NOT include any `<@ASKER_ID>` placeholder

#### Scenario: Prompt handles questionId resolution failure

- **WHEN** the tool is invoked
- **THEN** the returned text instructs Claude on what to do if `find_previous_questions` returns no match or multiple matches
- **AND** the fallback is to refine the keyword or pick the most recently `createdAt` match, with an empty cheater list if still ambiguous
- **AND** the ambiguity is recorded internally, not in the user-facing reveal

#### Scenario: Seasons disabled — prompt omits all seasons logic

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** the tool is invoked
- **THEN** the returned text does NOT reference `check_season_status`, `start_new_season`, `currentSeasonCorrect`, `currentSeasonAnswered`, "season finale", or the 3-row leaderboard shape
- **AND** the leaderboard rendering instructions describe the 2-row form (names + scores)

#### Scenario: Seasons enabled, mid-season reveal — finale and rollover skipped

- **GIVEN** `trivia.seasons.enabled` is `true`
- **WHEN** the tool is invoked
- **THEN** the returned text instructs Claude to call `check_season_status` early in the flow
- **AND** instructs Claude to render the 3-row leaderboard regardless of season-end state
- **AND** instructs Claude to render the finale section ONLY when `isLastFireOfSeason` is `true`
- **AND** instructs Claude to call `start_new_season` as the final tool ONLY when `isLastFireOfSeason` is `true`

#### Scenario: Seasons enabled, last-fire reveal — finale plus rollover, in that order

- **GIVEN** `trivia.seasons.enabled` is `true` and the reveal flow detects `isLastFireOfSeason: true`
- **WHEN** the tool is invoked
- **THEN** the returned text instructs Claude that the finale section is rendered ABOVE the 3-row leaderboard table inside the same `submit_response` call
- **AND** the returned text instructs Claude that `start_new_season` is the FINAL tool call of the flow, made after `submit_response` has been issued
- **AND** the returned text instructs Claude NOT to preview the next season's slug in the finale section (because `start_new_season` has not yet run when the reveal is delivered)

#### Scenario: Seasons enabled, prompt names retrieve_scores with default season

- **GIVEN** `trivia.seasons.enabled` is `true`
- **WHEN** the tool is invoked
- **THEN** the returned text instructs Claude to call `retrieve_scores` with no explicit `season` argument
- **AND** explains that the default (`"current"`) is the desired behavior for the leaderboard table

### Requirement: Create Schedules Instructions Tool

The Trivia plugin SHALL expose a `create_schedules_instructions` MCP tool, gated to the `admin` role, that returns plain-text instructions guiding Clack to create the two trivia cron jobs. The tool SHALL accept no arguments in v1.

The fields the recipe SHALL fix across both schedules are only the structural ones; timing is elicited from the user, not defaulted:

| Field            | Schedule A (question)                                                                                                                          | Schedule B (reveal)                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cronExpression` | **asked from the user** (no default)                                                                                                           | **asked from the user** (no default)                                                                                                                                                                |
| `timezone`       | **asked from the user** if not clear from context                                                                                              | same as Schedule A                                                                                                                                                                                  |
| `plugin`         | `trivia`                                                                                                                                       | `trivia`                                                                                                                                                                                            |
| `requiredTools`  | `["mcp__trivia__send_questions_instructions", "mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions", "mcp__trivia__save_question"]` | base: `["mcp__trivia__process_responses_instructions", "mcp__clack__fetch_channel_messages", "mcp__trivia__find_previous_questions", "mcp__trivia__get_question_history", "mcp__trivia__submit_answers", "mcp__trivia__retrieve_scores"]`; when `trivia.seasons.enabled` is `true`, also append `"mcp__trivia__check_season_status"`. The conditionally-called timeline tools (`upsert_season`, `delete_season`) are deliberately NOT in `requiredTools` — they fire only on the last reveal day / admin retraction; listing them would block every other day's reveal. |
| thin `prompt`    | `"Call send_questions_instructions and follow the returned instructions exactly."`                                                             | `"Call process_responses_instructions and follow the returned instructions exactly."`                                                                                                               |
| `channel`        | asked from the user                                                                                                                            | same as Schedule A                                                                                                                                                                                  |

The returned instructions SHALL direct Clack to:

1. **Detect duplicates first** — call `list_scheduled_messages` (or equivalent). If a trivia schedule already exists in the target channel, ask the user before creating or updating.
2. **Ask for the channel** — unless the user specified one in the request. The two schedules SHALL be created in the same channel.
3. **Ask for both times** — if the user did not provide times, Clack SHALL explicitly ask:
   - The time and days of the week for Schedule A (when the question is posted).
   - The time and days of the week for Schedule B (when the answer is revealed). Schedule B SHOULD be later on the same weekday(s) as Schedule A; Clack SHALL flag any user-provided configuration that would reveal the answer before the question is posted.
   - The timezone, unless obvious from prior context. Clack SHALL NOT fabricate a default timezone.
4. **Create Schedule A** (question posting) with the parameters tabulated above, using `create_scheduled_message` (or equivalent action tool).
5. **Create Schedule B** (answer reveal) with the parameters tabulated above, in the same channel as Schedule A. When `trivia.seasons.enabled` is `true`, the `requiredTools` array SHALL append `mcp__trivia__check_season_status` ONLY to the base tools listed above. `upsert_season` and `delete_season` MUST NOT appear in `requiredTools` (they are conditionally called).
6. **Confirm back to the user** — summarize both schedules (channel, cron, timezone, prompt) so the admin can verify.

#### Scenario: Returns a complete setup recipe

- **WHEN** the tool is invoked
- **THEN** the returned text contains both schedule definitions matching the table
- **AND** instructs Clack to check for existing schedules first
- **AND** does NOT require any asker-ID capture or interpolation step

#### Scenario: Recipe elicits times from the user — no hardcoded defaults

- **WHEN** the tool is invoked
- **THEN** the returned text instructs Clack to ASK the user for the posting time, the reveal time, the days of the week, and the timezone if any of these are not specified in the original request
- **AND** does NOT specify a default cron expression for either schedule
- **AND** does NOT specify a default timezone

#### Scenario: Recipe fixes the structural, plugin-owned fields

- **WHEN** the tool is invoked
- **THEN** the returned text specifies `plugin: "trivia"` on both schedules
- **AND** both schedules target the SAME channel (captured from user input)
- **AND** Schedule B's configuration is to be created in the same channel as Schedule A

#### Scenario: Recipe flags inverted timing

- **WHEN** the user provides times such that Schedule B would fire before Schedule A on any given day
- **THEN** the recipe instructs Clack to flag the inversion and ask the user to reconsider before creating the schedules

#### Scenario: Recipe specifies the correct requiredTools per schedule

- **WHEN** the tool is invoked
- **THEN** Schedule A's `requiredTools` includes at minimum `send_questions_instructions`, `get_ideas`, `find_previous_questions`, and `save_question` (all as `mcp__trivia__*`)
- **AND** Schedule B's `requiredTools` includes at minimum `process_responses_instructions`, `fetch_channel_messages` (as `mcp__clack__fetch_channel_messages`), `find_previous_questions`, `get_question_history`, and `submit_answers` (all trivia entries as `mcp__trivia__*`)

#### Scenario: Recipe uses thin dispatcher prompts

- **WHEN** the tool is invoked
- **THEN** Schedule A's prompt is a one-line directive to call `send_questions_instructions` and follow its return
- **AND** Schedule B's prompt is a one-line directive to call `process_responses_instructions` and follow its return
- **AND** neither prompt inlines the persona, step sequence, voter-categorization, or formatting rules
- **AND** Schedule B's prompt does NOT reference `save_cheating`, `post_to`, or any cheat-notification logic

#### Scenario: Tool description triggers on setup intent

- **WHEN** an admin says "set up trivia", "install trivia", or "create trivia schedules"
- **THEN** Claude (based on the tool's description) calls `create_schedules_instructions` before attempting to create any cron jobs

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** the tool is absent from the session's MCP catalog

### Requirement: Schedule Prompts Are Thin Dispatchers

Cron jobs created via the setup recipe SHALL store prompts that only dispatch to the corresponding instruction tool; the scheduled behavior SHALL live in the plugin, not in `cron-jobs.json`.

#### Scenario: Schedule A prompt is a thin dispatcher

- **WHEN** Schedule A is created via the setup recipe
- **THEN** its prompt consists of a short directive to call `send_questions_instructions` and follow the returned text
- **AND** does not inline any of the step sequence, persona, or formatting rules

#### Scenario: Schedule B prompt is a thin dispatcher

- **WHEN** Schedule B is created via the setup recipe
- **THEN** its prompt consists of a short directive to call `process_responses_instructions` and follow the returned text
- **AND** does not inline any of the step sequence, persona, or formatting rules
- **AND** does not reference cheat detection or owner DMs

#### Scenario: Schedule B requiredTools omits seasons tools when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** the tool is invoked
- **THEN** the returned text instructs Clack to set Schedule B's `requiredTools` to the base list only
- **AND** the returned text does NOT reference `mcp__trivia__check_season_status` or `mcp__trivia__start_new_season`

#### Scenario: Schedule B requiredTools appends only check_season_status when seasons are enabled

- **GIVEN** `trivia.seasons.enabled` is `true`
- **WHEN** the tool is invoked
- **THEN** the returned text instructs Clack to set Schedule B's `requiredTools` to the base list PLUS `mcp__trivia__check_season_status`
- **AND** the returned text does NOT include `mcp__trivia__upsert_season` or `mcp__trivia__delete_season` in `requiredTools`
- **AND** the returned text does NOT reference `mcp__trivia__start_new_season` (the obsolete name)

### Requirement: Existing Trivia Cron Jobs Remain Functional

Cron jobs created before this change, which embed fat prompts inline, SHALL continue to execute correctly without modification.

The change SHALL NOT ship an automatic migration; admins MAY re-run `create_schedules_instructions` to replace those jobs with thin dispatchers when they choose.

#### Scenario: Pre-existing fat-prompt cron still runs

- **WHEN** a cron job exists with an inline multi-line prompt and `plugin: "trivia"` (or no plugin link)
- **THEN** the scheduler triggers it with the inline prompt as before
- **AND** the run completes as it did prior to this change
