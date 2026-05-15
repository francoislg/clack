## MODIFIED Requirements

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
13. **Start the next season (only when `trivia.seasons.enabled` is `true` AND step 7 reported `isLastFireOfSeason: true`)** — As the final tool call of the reveal flow, after `submit_response` has been issued, call `start_new_season(slug, expectedEndAt)`. Both arguments SHALL be derived from `trivia.seasons.prompt` plus the current date — the prompt SHALL instruct Claude to pick a fresh slug matching the prompt's style guidance and an `expectedEndAt` matching the prompt's cadence guidance (e.g. "Every month" → end of the next calendar month). When `seasons.enabled` is `false` OR step 7 reported `isLastFireOfSeason: false`, this step SHALL be omitted entirely.

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

| Field            | Schedule A (question)                                                                                                                          | Schedule B (reveal)                                                                                                                                                                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cronExpression` | **asked from the user** (no default)                                                                                                           | **asked from the user** (no default)                                                                                                                                                                                                                                                                                                             |
| `timezone`       | **asked from the user** if not clear from context                                                                                              | same as Schedule A                                                                                                                                                                                                                                                                                                                               |
| `plugin`         | `trivia`                                                                                                                                       | `trivia`                                                                                                                                                                                                                                                                                                                                         |
| `requiredTools`  | `["mcp__trivia__send_questions_instructions", "mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions", "mcp__trivia__save_question"]` | base: `["mcp__trivia__process_responses_instructions", "mcp__clack__fetch_channel_messages", "mcp__trivia__find_previous_questions", "mcp__trivia__get_question_history", "mcp__trivia__submit_answers", "mcp__trivia__retrieve_scores"]`; when `trivia.seasons.enabled` is `true`, also append `"mcp__trivia__check_season_status"` and `"mcp__trivia__start_new_season"` |
| thin `prompt`    | `"Call send_questions_instructions and follow the returned instructions exactly."`                                                             | `"Call process_responses_instructions and follow the returned instructions exactly."`                                                                                                                                                                                                                                                            |
| `channel`        | asked from the user                                                                                                                            | same as Schedule A                                                                                                                                                                                                                                                                                                                               |

The returned instructions SHALL direct Clack to:

1. **Detect duplicates first** — call `list_scheduled_messages` (or equivalent). If a trivia schedule already exists in the target channel, ask the user before creating or updating.
2. **Ask for the channel** — unless the user specified one in the request. The two schedules SHALL be created in the same channel.
3. **Ask for both times** — if the user did not provide times, Clack SHALL explicitly ask:
   - The time and days of the week for Schedule A (when the question is posted).
   - The time and days of the week for Schedule B (when the answer is revealed). Schedule B SHOULD be later on the same weekday(s) as Schedule A; Clack SHALL flag any user-provided configuration that would reveal the answer before the question is posted.
   - The timezone, unless obvious from prior context. Clack SHALL NOT fabricate a default timezone.
4. **Create Schedule A** (question posting) with the parameters tabulated above, using `create_scheduled_message` (or equivalent action tool).
5. **Create Schedule B** (answer reveal) with the parameters tabulated above, in the same channel as Schedule A. When `trivia.seasons.enabled` is `true`, the `requiredTools` array SHALL include both `mcp__trivia__check_season_status` and `mcp__trivia__start_new_season` in addition to the base tools listed above.
6. **Confirm back to the user** — summarize both schedules (channel, cron, timezone, prompt) so the admin can verify.

#### Scenario: Returns a complete setup recipe

- **WHEN** the tool is invoked
- **THEN** the returned text contains step-by-step guidance for detect-duplicates → ask-channel → ask-times → create-A → create-B → confirm
- **AND** references `create_scheduled_message` and `list_scheduled_messages` by name
- **AND** instructs Clack to ask the user for channel, times, and timezone rather than fabricating defaults

#### Scenario: Schedule B requiredTools omits seasons tools when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** the tool is invoked
- **THEN** the returned text instructs Clack to set Schedule B's `requiredTools` to the base list only
- **AND** the returned text does NOT reference `mcp__trivia__check_season_status` or `mcp__trivia__start_new_season`

#### Scenario: Schedule B requiredTools includes seasons tools when seasons are enabled

- **GIVEN** `trivia.seasons.enabled` is `true`
- **WHEN** the tool is invoked
- **THEN** the returned text instructs Clack to set Schedule B's `requiredTools` to the base list PLUS `mcp__trivia__check_season_status` and `mcp__trivia__start_new_season`
