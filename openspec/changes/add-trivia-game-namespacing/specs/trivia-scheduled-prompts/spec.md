## MODIFIED Requirements

### Requirement: Send Questions Instructions Tool

The Trivia plugin SHALL expose a `send_questions_instructions` MCP tool that returns, as plain text, the full prompt the scheduled "question posting" run must follow.

The tool SHALL be gated to the `admin` role (scheduled runs execute with the creator's role, which is admin+ for any trivia setup).

The tool SHALL accept a required `game: string` argument; the slug SHALL be validated against the games registry per the `trivia-games` capability (unknown slug → structured error; disabled slug → structured "game is disabled" error). The returned prompt's tool-call steps SHALL reference the provided slug literally, so every nested tool call in the schedule's flow passes `game: "<slug>"`.

The returned prompt SHALL open with a **Game Show Presenter persona** directive ("energetic, engaging, and fun — add showmanship to your delivery") and explicitly state the active game slug ("This run targets game: `<slug>`"), then instruct Claude through the following ten-step flow, preserving the substantive behavior of the live cron job prior to this change. Every tool-call step that previously took zero `game`-related arguments SHALL be rewritten to pass `game: "<slug>"`:

1. **Get category ideas and suggestions** — Call `get_ideas(game: "<slug>")`. The tool returns `categories.ideas` (5 categories, excluding the last 10 used in this game), `suggestedAnswer` (a boolean), and `suggestedDifficulty` (one of `"Easy"`, `"Medium"`, `"Hard"`). Pick one category from `categories.ideas`. Read both `suggestedAnswer` and `suggestedDifficulty` — they steer the next steps.
2. **Research a TRUE fact** about that topic, aiming at the difficulty bucket named by `suggestedDifficulty` (Easy = 4–6 on the 1–10 scale, Medium = 7–8, Hard = 9–10).
3. **Honor `suggestedAnswer`** — if `suggestedAnswer` is `true`, keep the statement TRUE. If `suggestedAnswer` is `false`, modify a key detail to make the statement FALSE (e.g., swap "shrimp" → "lobster"). The prompt SHALL NOT instruct Claude to "randomly decide" — the random choice has already been made server-side.
4. **Duplicate check** — Call `find_previous_questions(game: "<slug>", ...)`; if a match is found in this game's question history, iterate from step 2. Note: the search is scoped to the named game only — questions in other games do not count as duplicates.
5. **Validate** the final statement through research — confirm it is actually TRUE or FALSE, matching the `suggestedAnswer` honored in step 3.
6. **Difficulty gate** — Self-rate 1–10. The target range is the one named by `suggestedDifficulty` (Easy = 4–6, Medium = 7–8, Hard = 9–10). Reject and regenerate if the rating is ≤ 3/10; only proceed when ≥ 4/10. The bucket-mapped target supersedes the legacy "5–7/10 sweet spot" guidance.
7. **Choose emojis** relating to the topic.
8. **Save via `save_question(game: "<slug>", ...)`** with `{ category, statement, isTrue, emojis }`; retain the returned `questionId`. `isTrue` SHALL reflect the statement Claude actually produced (and, by the rule in step 3, SHOULD match `suggestedAnswer`). The question lands in the named game's directory only.
9. **Format using Block Kit `sections`** — no Markdown bold/italic, no `##` headers. A single section, plain text plus emojis. The 👍 (TRUE) marker MUST appear before the 👎 (FALSE) marker. The prompt SHALL encourage Claude to invent a style that fits the day and include at least one concrete example (without prescribing a rotation) so the delivery varies over time.
10. **Deliver via `submit_response`** with `reactions: ["+1", "-1"]` in that exact order (ensures 👍 renders before 👎).

#### Scenario: Returns the full ten-step schedule prompt with game-scoped tool calls

- **WHEN** the tool is invoked with `game: "main"`
- **THEN** it returns a non-empty string containing a numbered sequence covering all ten steps
- **AND** every tool-call step referencing `get_ideas`, `find_previous_questions`, or `save_question` passes `game: "main"` as an argument
- **AND** the prompt explicitly states the active game slug near the top

#### Scenario: Different games produce different prompts

- **WHEN** the tool is invoked with `game: "sandbox"`
- **THEN** the returned text references `game: "sandbox"` at every tool-call step
- **AND** does NOT reference `game: "main"` anywhere

#### Scenario: Unknown game rejected

- **WHEN** the tool is invoked with `game: "ghost"` (not in the registry)
- **THEN** the tool returns a structured "unknown game" error
- **AND** no prompt text is generated

#### Scenario: Disabled game rejected

- **GIVEN** `games.json` marks `retired-2025` as `disabled: true`
- **WHEN** the tool is invoked with `game: "retired-2025"`
- **THEN** the tool returns a structured "game is disabled" error

#### Scenario: Prompt instructs Claude to honor suggestedAnswer

- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text references `suggestedAnswer` from `get_ideas`
- **AND** instructs Claude to keep the statement TRUE when `suggestedAnswer` is `true`
- **AND** instructs Claude to modify a key detail to make the statement FALSE when `suggestedAnswer` is `false`
- **AND** does NOT instruct Claude to "randomly decide" the truth value

#### Scenario: Prompt instructs Claude to target suggestedDifficulty

- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text references `suggestedDifficulty` from `get_ideas`
- **AND** spells out the bucket-to-1–10 mapping: Easy = 4–6, Medium = 7–8, Hard = 9–10
- **AND** instructs Claude to aim the question at the bucket's range when researching and when self-rating

#### Scenario: Prompt enforces the difficulty gate

- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text contains an explicit rule that questions rated ≤ 3/10 MUST be rejected and regenerated
- **AND** ties the target range to the bucket named by `suggestedDifficulty`

#### Scenario: Prompt enforces reaction ordering

- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text instructs Claude to pass `reactions: ["+1", "-1"]` to `submit_response`, in that order
- **AND** instructs Claude that 👍 (TRUE) must be mentioned before 👎 (FALSE) in the message body

#### Scenario: Prompt invites invented styles and provides at least one example

- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text explicitly invites Claude to invent its own style each day
- **AND** includes at least one concrete example for inspiration
- **AND** does NOT prescribe a fixed rotation or a required set of named styles

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** the tool is absent from the session's MCP catalog

### Requirement: Process Responses Instructions Tool

The Trivia plugin SHALL expose a `process_responses_instructions` MCP tool that returns, as plain text, the full prompt the scheduled "answer reveal" run must follow.

The tool SHALL be gated to the `admin` role.

The tool SHALL accept a required `game: string` argument; the slug SHALL be validated against the games registry per the `trivia-games` capability (unknown slug → structured error). The tool SHALL succeed against disabled games (frozen-archive reads for legacy reveal flows are unlikely but technically valid). The returned prompt's tool-call steps SHALL reference the provided slug literally, so every nested tool call passes `game: "<slug>"`.

The returned prompt SHALL open with the **Game Show Presenter persona** directive and explicitly state the active game slug, then instruct Claude through the same step flow defined prior to this change, with every per-game tool call (`find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, `check_season_status`, `upsert_season`, `delete_season`) rewritten to pass `game: "<slug>"`. The prompt SHALL NOT include any cheat-detection logic or calls to `save_cheating` — cheat detection is handled exclusively by the `trivia-check` interactive-session instruction. The prompt MAY consume cheat data via the admin-tier `get_question_history(game, questionId)` tool for the sole purpose of silent voter exclusion; it MUST NOT surface cheater identities or any allusion to them in the user-facing reveal.

The step flow SHALL preserve the substantive behavior of the prior reveal flow (fetch most recent question message → extract statement → validate truth → compose explanation → resolve questionId via `find_previous_questions(game, ...)` → load history via `get_question_history(game, questionId)` → optional season-status check via `check_season_status(game)` → categorize and partition voters → `submit_answers(game, ...)` before `submit_response` → `retrieve_scores(game)` → deliver Block Kit reveal → optional season close via `upsert_season(game, currentSlug, { endedAt: now })`).

#### Scenario: Returns the full step flow with game-scoped tool calls

- **WHEN** the tool is invoked with `game: "main"`
- **THEN** it returns a non-empty string containing a numbered sequence
- **AND** every tool-call step referencing `find_previous_questions`, `get_question_history`, `submit_answers`, `retrieve_scores`, `check_season_status`, or `upsert_season` passes `game: "main"`
- **AND** the prompt explicitly states the active game slug near the top
- **AND** the prompt does NOT reference `save_cheating`

#### Scenario: Unknown game rejected

- **WHEN** the tool is invoked with `game: "ghost"` (not in the registry)
- **THEN** the tool returns a structured "unknown game" error

#### Scenario: Prompt enforces bot exclusion without a hardcoded ID

- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text directs Claude to exclude the bot's own user ID from all reaction lists before analysis
- **AND** instructs Claude to determine the bot's ID from session context rather than hardcoding a specific value
- **AND** the text does NOT contain any specific deployment's bot user ID

#### Scenario: Prompt enforces silent cheater exclusion

- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text directs Claude to call `get_question_history(game: "<slug>", questionId: ...)` after locating the question and to remove every user ID in `cheaterUserIds` from every reaction list before voter categorization
- **AND** explicitly forbids mentioning, alluding to, or stylistically signalling the removal in the user-facing reveal
- **AND** instructs Claude to exclude those user IDs from the `submit_answers` payload as well

#### Scenario: Prompt enforces submit_answers-before-submit_response ordering

- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text includes an explicit rule that `submit_response` MUST NOT be called until `submit_answers(game: "<slug>", ...)` has completed
- **AND** describes the one-retry-then-proceed fallback for `submit_answers` failures

#### Scenario: Prompt names the four voter situations to cover

- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text names all four voter situations Claude must keep in mind: CORRECT voters, INCORRECT voters, FENCE-SITTERS, and WILDCARDS
- **AND** does NOT mandate fixed sub-group labels or a rigid four-subsection layout

#### Scenario: Prompt instructs to skip empty voter situations

- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text instructs Claude to cover each voter situation ONLY if at least one qualifying user exists
- **AND** instructs Claude to omit empty situations entirely — no heading, no placeholder, no "nobody here" line
- **AND** the same skip-when-empty rule applies to situations emptied by silent cheater removal

#### Scenario: Prompt contains no cheat-detection logic

- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text does NOT mention `save_cheating`
- **AND** does NOT include any DM-the-owner step
- **AND** does NOT include any `<@ASKER_ID>` placeholder

#### Scenario: Prompt handles questionId resolution failure within the game

- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text instructs Claude on what to do if `find_previous_questions(game: "<slug>", ...)` returns no match or multiple matches *within this game*
- **AND** the fallback is to refine the keyword or pick the most recently `createdAt` match within the game, with an empty cheater list if still ambiguous
- **AND** the ambiguity is recorded internally, not in the user-facing reveal

#### Scenario: Seasons disabled — prompt omits all seasons logic

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text does NOT reference `check_season_status`, `upsert_season`, `currentSeasonCorrect`, `currentSeasonAnswered`, "season finale", or the 3-row leaderboard shape
- **AND** the leaderboard rendering instructions describe the 2-row form (names + scores)

#### Scenario: Seasons enabled, mid-season reveal — finale and rollover skipped

- **GIVEN** `trivia.seasons.enabled` is `true`
- **WHEN** the tool is invoked with `game: "main"`
- **THEN** the returned text instructs Claude to call `check_season_status(game: "main")` early in the flow
- **AND** instructs Claude to render the 3-row leaderboard regardless of season-end state
- **AND** instructs Claude to render the finale section ONLY when `isLastFireOfSeason` is `true`
- **AND** instructs Claude to call `upsert_season(game: "main", slug: currentSlug, endedAt: <now>)` as the final tool ONLY when `isLastFireOfSeason` is `true`

#### Scenario: Seasons enabled, prompt names retrieve_scores with default season

- **GIVEN** `trivia.seasons.enabled` is `true`
- **WHEN** the tool is invoked with any valid game
- **THEN** the returned text instructs Claude to call `retrieve_scores(game: "<slug>")` with no explicit `season` argument
- **AND** explains that the default (`"current"`) is the desired behavior for the leaderboard table

### Requirement: Create Schedules Instructions Tool

The Trivia plugin SHALL expose a `create_schedules_instructions` MCP tool, gated to the `admin` role, that returns plain-text instructions guiding Clack to create the two trivia cron jobs.

The tool SHALL accept no Zod arguments (the conversational flow elicits the game slug from the admin), but the returned instructions SHALL direct Clack to:

1. **Ask the admin which game these schedules target.** Clack SHALL call `list_games` first to surface available enabled games to the admin, and SHALL ask the admin to name one (or confirm a single sensible default such as `main` if only one enabled game exists). Disabled games SHALL NOT be offered. Clack SHALL refuse to create schedules without a valid game slug.
2. **Validate the chosen slug.** Clack SHALL confirm the slug exists in the games registry and is not disabled. If invalid, ask again.
3. **Detect duplicates first** — call `list_scheduled_messages` (or equivalent). If a trivia schedule already exists in the target channel, ask the user before creating or updating.
4. **Ask for the channel** — unless the user specified one in the request. The two schedules SHALL be created in the same channel.
5. **Ask for both times** — if the user did not provide times, Clack SHALL explicitly ask:
   - The time and days of the week for Schedule A (when the question is posted).
   - The time and days of the week for Schedule B (when the answer is revealed). Schedule B SHOULD be later on the same weekday(s) as Schedule A; Clack SHALL flag any user-provided configuration that would reveal the answer before the question is posted.
   - The timezone, unless obvious from prior context. Clack SHALL NOT fabricate a default timezone.
6. **Create Schedule A** (question posting) with the parameters tabulated below, using `create_scheduled_message` (or equivalent action tool).
7. **Create Schedule B** (answer reveal) with the parameters tabulated below, in the same channel as Schedule A.
8. **Confirm back to the user** — summarize both schedules (channel, cron, timezone, game slug, prompt) so the admin can verify.

The fields the recipe SHALL fix across both schedules are only the structural ones; timing is elicited from the user, not defaulted:

| Field            | Schedule A (question)                                                                                                                          | Schedule B (reveal)                                                                                                                                                                                 |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cronExpression` | **asked from the user** (no default)                                                                                                           | **asked from the user** (no default)                                                                                                                                                                |
| `timezone`       | **asked from the user** if not clear from context                                                                                              | same as Schedule A                                                                                                                                                                                  |
| `plugin`         | `trivia`                                                                                                                                       | `trivia`                                                                                                                                                                                            |
| `requiredTools`  | `["mcp__trivia__send_questions_instructions", "mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions", "mcp__trivia__save_question"]` | base: `["mcp__trivia__process_responses_instructions", "mcp__clack__fetch_channel_messages", "mcp__trivia__find_previous_questions", "mcp__trivia__get_question_history", "mcp__trivia__submit_answers", "mcp__trivia__retrieve_scores"]`; when `trivia.seasons.enabled` is `true`, also append `"mcp__trivia__check_season_status"`. The conditionally-called timeline tools (`upsert_season`, `delete_season`) are deliberately NOT in `requiredTools` — they fire only on the last reveal day / admin retraction; listing them would block every other day's reveal. |
| thin `prompt`    | `"Game slug: <slug>. Call send_questions_instructions(game: \"<slug>\") and follow the returned instructions exactly."`                        | `"Game slug: <slug>. Call process_responses_instructions(game: \"<slug>\") and follow the returned instructions exactly."`                                                                          |
| `channel`        | asked from the user                                                                                                                            | same as Schedule A                                                                                                                                                                                  |

#### Scenario: Returns a complete setup recipe that elicits a game slug

- **WHEN** the tool is invoked
- **THEN** the returned text instructs Clack to ask the admin which game the schedules belong to
- **AND** instructs Clack to call `list_games` to surface available games
- **AND** instructs Clack to validate the slug against the games registry before proceeding
- **AND** does NOT prescribe a default game slug

#### Scenario: Disabled games are not offered as options

- **GIVEN** `games.json` contains `main` (enabled) and `retired-2025` (disabled)
- **WHEN** the recipe is followed
- **THEN** Clack offers `main` to the admin
- **AND** Clack does NOT offer `retired-2025`

#### Scenario: Recipe elicits times from the user — no hardcoded defaults

- **WHEN** the tool is invoked
- **THEN** the returned text instructs Clack to ASK the user for the posting time, the reveal time, the days of the week, and the timezone if any of these are not specified in the original request
- **AND** does NOT specify a default cron expression for either schedule
- **AND** does NOT specify a default timezone

#### Scenario: Recipe fixes the structural, plugin-owned fields

- **WHEN** the tool is invoked
- **THEN** the returned text specifies `plugin: "trivia"` on both schedules
- **AND** both schedules target the SAME channel (captured from user input)
- **AND** both schedules carry the SAME game slug in their prompts (captured from user input)

#### Scenario: Recipe bakes the game slug into both schedules' thin-dispatcher prompts

- **GIVEN** the admin chose `game: "main"`
- **WHEN** Clack constructs the two cron job prompts
- **THEN** Schedule A's prompt is `"Game slug: main. Call send_questions_instructions(game: \"main\") and follow the returned instructions exactly."`
- **AND** Schedule B's prompt is `"Game slug: main. Call process_responses_instructions(game: \"main\") and follow the returned instructions exactly."`

#### Scenario: Recipe flags inverted timing

- **WHEN** the user provides times such that Schedule B would fire before Schedule A on any given day
- **THEN** the recipe instructs Clack to flag the inversion and ask the user to reconsider before creating the schedules

#### Scenario: Recipe specifies the correct requiredTools per schedule

- **WHEN** the tool is invoked
- **THEN** Schedule A's `requiredTools` includes at minimum `send_questions_instructions`, `get_ideas`, `find_previous_questions`, and `save_question` (all as `mcp__trivia__*`)
- **AND** Schedule B's `requiredTools` includes at minimum `process_responses_instructions`, `fetch_channel_messages` (as `mcp__clack__fetch_channel_messages`), `find_previous_questions`, `get_question_history`, `submit_answers`, and `retrieve_scores` (all trivia entries as `mcp__trivia__*`)

#### Scenario: Recipe uses thin dispatcher prompts that carry the game slug

- **WHEN** the tool is invoked
- **THEN** Schedule A's prompt is a one-line directive that names the game slug and calls `send_questions_instructions(game: "<slug>")`
- **AND** Schedule B's prompt is a one-line directive that names the game slug and calls `process_responses_instructions(game: "<slug>")`
- **AND** neither prompt inlines the persona, step sequence, voter-categorization, or formatting rules
- **AND** Schedule B's prompt does NOT reference `save_cheating`, `post_to`, or any cheat-notification logic

#### Scenario: Tool description triggers on setup intent

- **WHEN** an admin says "set up trivia", "install trivia", or "create trivia schedules"
- **THEN** Claude (based on the tool's description) calls `create_schedules_instructions` before attempting to create any cron jobs

#### Scenario: Tool is gated to admin

- **WHEN** a session's user has role below `admin`
- **THEN** the tool is absent from the session's MCP catalog

### Requirement: Schedule Prompts Are Thin Dispatchers

Cron jobs created via the setup recipe SHALL store prompts that only dispatch to the corresponding instruction tool; the scheduled behavior SHALL live in the plugin, not in `cron-jobs.json`. Each thin dispatcher prompt SHALL carry the game slug it targets, so the instruction tool can receive `game: "<slug>"` on the scheduled fire.

#### Scenario: Schedule A prompt is a thin dispatcher carrying the game slug

- **WHEN** Schedule A is created via the setup recipe with `game: "main"`
- **THEN** its prompt consists of a short directive that names `game: "main"` and calls `send_questions_instructions(game: "main")`
- **AND** does not inline any of the step sequence, persona, or formatting rules

#### Scenario: Schedule B prompt is a thin dispatcher carrying the game slug

- **WHEN** Schedule B is created via the setup recipe with `game: "main"`
- **THEN** its prompt consists of a short directive that names `game: "main"` and calls `process_responses_instructions(game: "main")`
- **AND** does not inline any of the step sequence, persona, or formatting rules
- **AND** does not reference cheat detection or owner DMs

#### Scenario: Schedule B requiredTools omits seasons tools when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** the tool is invoked
- **THEN** the returned text instructs Clack to set Schedule B's `requiredTools` to the base list only
- **AND** the returned text does NOT reference `mcp__trivia__check_season_status` or `mcp__trivia__upsert_season`

#### Scenario: Schedule B requiredTools appends only check_season_status when seasons are enabled

- **GIVEN** `trivia.seasons.enabled` is `true`
- **WHEN** the tool is invoked
- **THEN** the returned text instructs Clack to set Schedule B's `requiredTools` to the base list PLUS `mcp__trivia__check_season_status`
- **AND** the returned text does NOT include `mcp__trivia__upsert_season` or `mcp__trivia__delete_season` in `requiredTools`

### Requirement: Existing Trivia Cron Jobs Remain Functional

Cron jobs created before this change, which embed fat prompts inline (and do not pass a `game` argument), SHALL continue to dispatch their inline prompt to the runtime. However, their reveal/posting tool calls will fail with a structured "missing game argument" error at the first per-game tool invocation, because all per-game tools now require `game`.

The change SHALL NOT ship an automatic migration that rewrites legacy cron prompts. Admins MAY re-run `create_schedules_instructions` to replace those jobs with thin dispatchers that pass `game`. Operators upgrading SHALL be directed via release notes to delete and re-create their existing trivia schedules.

#### Scenario: Pre-existing fat-prompt cron fails fast on the first per-game tool call

- **WHEN** a cron job exists with an inline multi-line prompt that calls `get_ideas` without a `game` argument
- **THEN** the scheduler triggers it with the inline prompt as before
- **AND** the `get_ideas` call returns a structured "missing game argument" error (or, depending on Claude's inference, an "unknown game" error if Claude hallucinates a slug not in the registry)
- **AND** the run aborts without writing any per-game data
- **AND** Claude is expected to surface the failure in the channel (or to the admin via dm) rather than silently producing nothing

#### Scenario: Re-creating a schedule via the recipe restores normal operation

- **GIVEN** a deployment with a broken pre-upgrade cron schedule
- **WHEN** the admin deletes the legacy schedule and runs `create_schedules_instructions`
- **THEN** the recipe asks for the game slug and creates two new thin-dispatcher schedules that pass `game` correctly
- **AND** subsequent fires of the new schedules complete without missing-argument errors
