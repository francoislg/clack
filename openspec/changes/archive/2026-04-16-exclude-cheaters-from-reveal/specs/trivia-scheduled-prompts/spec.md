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
7. **Categorize reactions, excluding the bot AND silently excluding cheaters** — Before any analysis, remove the bot's own user ID from every reaction list (the bot's self-reactions must never count as votes). Claude SHALL determine the bot's user ID from its own session context rather than relying on a hardcoded value. Then remove every user ID present in `cheaterUserIds` (from step 6) from every reaction list. The exclusion is silent: Claude MUST NOT mention, allude to, or stylistically signal these removals in the user-facing reveal. After both removals, `:+1:` = TRUE vote; `:-1:` = FALSE vote. Identify fence-sitters (users who reacted with both `:+1:` AND `:-1:`) and wildcards (users who used other emojis) from the post-exclusion lists.
8. **Partition voters** into four disjoint groups (human users only, bot AND cheaters excluded): **Correct** (voted the right answer, single reaction), **Incorrect** (voted the wrong answer, single reaction), **Fence-sitters** (both `:+1:` and `:-1:`), **Wildcards** (other emojis).
9. **Submit answers BEFORE response** — Call `submit_answers` with `[{ userId, displayName, answer: boolean }]` including ONLY single-reaction voters from the post-exclusion partition (exclude fence-sitters, wildcards, AND cheaters from scoring). `answer: true` for `:+1:`, `false` for `:-1:`. Wait for completion. On failure, retry once; if it still fails, proceed with `submit_response` and mention that scoring failed. `submit_response` MUST NOT be called until `submit_answers` has completed.
10. **Deliver via `submit_response`** using Block Kit `sections` (no Markdown headers, no bold/italic). Two sections:
    - Answer section — correct answer with dramatic emphasis + the explanation.
    - Voting Results section — labelled subsections for each voter group:
      - **"Nailed it! 🎉"** — mention correct voters with `<@USERID>`, enthusiastic praise
      - **"Not quite! 💪"** — incorrect voters with encouragement
      - **"Playing both sides, eh? 🤨"** — fence-sitters, lighthearted roast
      - **"Wait, what? 🤔"** — wildcards, interpret their emoji humorously
    - Cheater identities MUST NOT appear in any subsection, callout, footnote, or aside; if every reactor on a side was a cheater, that side renders as if no one voted there.
    - If nobody voted (after excluding the bot and cheaters), acknowledge with game-show humor. Do NOT include a leaderboard snippet.

#### Scenario: Returns the full step flow

- **WHEN** the tool is invoked
- **THEN** it returns a non-empty string containing a numbered sequence covering all steps above
- **AND** references `fetch_channel_messages`, `find_previous_questions`, `get_question_history`, `submit_answers`, and `submit_response` by name
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

#### Scenario: Prompt defines the four voter category labels

- **WHEN** the tool is invoked
- **THEN** the returned text specifies the exact section labels: "Nailed it! 🎉", "Not quite! 💪", "Playing both sides, eh? 🤨", "Wait, what? 🤔"

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

### Requirement: Create Schedules Instructions Tool

The Trivia plugin SHALL expose a `create_schedules_instructions` MCP tool, gated to the `admin` role, that returns plain-text instructions guiding Clack to create the two trivia cron jobs. The tool SHALL accept no arguments in v1.

The fields the recipe SHALL fix across both schedules are only the structural ones; timing is elicited from the user, not defaulted:

| Field | Schedule A (question) | Schedule B (reveal) |
|---|---|---|
| `cronExpression` | **asked from the user** (no default) | **asked from the user** (no default) |
| `timezone` | **asked from the user** if not clear from context | same as Schedule A |
| `plugin` | `trivia` | `trivia` |
| `requiredTools` | `["mcp__trivia__send_questions_instructions", "mcp__trivia__get_ideas", "mcp__trivia__find_previous_questions", "mcp__trivia__save_question"]` | `["mcp__trivia__process_responses_instructions", "mcp__clack__fetch_channel_messages", "mcp__trivia__find_previous_questions", "mcp__trivia__get_question_history", "mcp__trivia__submit_answers"]` |
| thin `prompt` | `"Call send_questions_instructions and follow the returned instructions exactly."` | `"Call process_responses_instructions and follow the returned instructions exactly."` |
| `channel` | asked from the user | same as Schedule A |

The returned instructions SHALL direct Clack to:

1. **Detect duplicates first** — call `list_scheduled_messages` (or equivalent). If a trivia schedule already exists in the target channel, ask the user before creating or updating.
2. **Ask for the channel** — unless the user specified one in the request. The two schedules SHALL be created in the same channel.
3. **Ask for both times** — if the user did not provide times, Clack SHALL explicitly ask:
   - The time and days of the week for Schedule A (when the question is posted).
   - The time and days of the week for Schedule B (when the answer is revealed). Schedule B SHOULD be later on the same weekday(s) as Schedule A; Clack SHALL flag any user-provided configuration that would reveal the answer before the question is posted.
   - The timezone, unless obvious from prior context. Clack SHALL NOT fabricate a default timezone.
4. **Create Schedule A** (question posting) with the parameters tabulated above, using `create_scheduled_message` (or equivalent action tool).
5. **Create Schedule B** (answer reveal) with the parameters tabulated above, in the same channel as Schedule A.
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
