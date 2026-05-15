## MODIFIED Requirements

### Requirement: Process Responses Instructions Tool

The Trivia plugin SHALL expose a `process_responses_instructions` MCP tool that returns, as plain text, the full prompt the scheduled "answer reveal" run must follow.

The tool SHALL be gated to the `admin` role. The tool SHALL accept no arguments in v1.

The returned prompt SHALL open with the Game Show Presenter persona directive and instruct Claude through the step flow defined in the prior version of this requirement, with **step 13 rewritten** to use the timeline-based seasons model:

13. **CLOSE THE CURRENT SEASON AND ENSURE CONTINUITY (only when `isLastFireOfSeason` from step 6.5 is `true`)** — As the final action of the reveal flow, after `submit_response` has been issued:
    a. Call `upsert_season(currentSlug, { endedAt: <Date.now()> })` to stamp the actual end time on the closing season. This is idempotent — if the season was already marked ended, the call is harmless.
    b. Examine the `nextSeasonSlug` field from the step 6.5 `check_season_status` return.
        - If `nextSeasonSlug` is non-null, the timeline already has a queued continuation; no further action is needed. The queued season takes over naturally as time progresses.
        - If `nextSeasonSlug` is `null`, the timeline has no continuation queued. Call `upsert_season(<derived slug>, { startedAt: <now>, expectedEndAt: <derived from trivia.seasons.prompt>, themeExtras: <derived from prompt> })` to create one. Without this, writes after the closing season are season-less. Derive `slug`, `expectedEndAt`, and optional `themeExtras` from `trivia.seasons.prompt` plus the current date, the same way the prior `start_new_season` step did.
    c. The reveal HAS ALREADY been delivered — do NOT post a follow-up message about season transitions. The finale section already announced the closing season; the new season (if any) will announce itself via its first question post.

When `seasons.enabled` is `false`, step 13 is omitted entirely.

All other steps (1–12) and scenarios for this requirement are preserved from the prior version.

#### Scenario: Seasons enabled, last-fire reveal with queued future season

- **GIVEN** `trivia.seasons.enabled` is `true`, the reveal is the last fire of the active season, and `check_season_status` returned `nextSeasonSlug: "june-2026"`
- **WHEN** the tool is invoked
- **THEN** the returned text instructs Claude to call `upsert_season(currentSlug, { endedAt: now })` after `submit_response`
- **AND** instructs Claude NOT to create a new season because `nextSeasonSlug` is non-null
- **AND** does NOT reference `start_new_season` (the obsolete tool name)

#### Scenario: Seasons enabled, last-fire reveal with no queued future season

- **GIVEN** `trivia.seasons.enabled` is `true`, the reveal is the last fire, and `check_season_status` returned `nextSeasonSlug: null`
- **WHEN** the tool is invoked
- **THEN** the returned text instructs Claude to call `upsert_season(currentSlug, { endedAt: now })` AND `upsert_season(<new slug>, { startedAt: now, expectedEndAt: ..., themeExtras: ... })` in sequence
- **AND** the latter call's arguments are derived from `trivia.seasons.prompt` plus the current date

#### Scenario: Prompt references upsert_season, not start_new_season

- **GIVEN** `trivia.seasons.enabled` is `true`
- **WHEN** the tool is invoked
- **THEN** the returned text references `upsert_season` by name
- **AND** the returned text does NOT reference `start_new_season` anywhere

### Requirement: Create Schedules Instructions Tool

The Trivia plugin SHALL expose a `create_schedules_instructions` MCP tool, gated to the `admin` role, that returns plain-text instructions guiding Clack to create the two trivia cron jobs.

Schedule B's `requiredTools` list — when `trivia.seasons.enabled` is `true` — appends ONLY `mcp__trivia__check_season_status` to the base list. The conditionally-called tools (`upsert_season`, `delete_season`) are deliberately NOT in `requiredTools` — they only fire on the season's last reveal day (or on admin retraction), and the `requiredTools` mechanism rejects `submit_response` unless every listed tool has been called. Listing conditionally-called tools would break every non-rollover day. The two tools remain available in the MCP catalog through normal registration, just not as hard requirements.

```
base:    "mcp__trivia__process_responses_instructions",
         "mcp__clack__fetch_channel_messages",
         "mcp__trivia__find_previous_questions",
         "mcp__trivia__get_question_history",
         "mcp__trivia__submit_answers",
         "mcp__trivia__retrieve_scores"

seasons enabled, also append:
         "mcp__trivia__check_season_status"
```

All other scenarios for Create Schedules Instructions are preserved from the prior version.

#### Scenario: Schedule B requiredTools omits seasons tools when seasons are disabled

- **GIVEN** `trivia.seasons.enabled` is `false`
- **WHEN** the tool is invoked
- **THEN** the returned text instructs Clack to set Schedule B's `requiredTools` to the base list only
- **AND** the returned text does NOT reference `mcp__trivia__check_season_status`, `mcp__trivia__upsert_season`, or `mcp__trivia__delete_season`

#### Scenario: Schedule B requiredTools appends only check_season_status when seasons are enabled

- **GIVEN** `trivia.seasons.enabled` is `true`
- **WHEN** the tool is invoked
- **THEN** the returned text instructs Clack to set Schedule B's `requiredTools` to the base list PLUS `mcp__trivia__check_season_status`
- **AND** the returned text does NOT include `mcp__trivia__upsert_season` or `mcp__trivia__delete_season` in `requiredTools` (these are conditionally called, not required-every-fire)
- **AND** the returned text does NOT reference `mcp__trivia__start_new_season` (the obsolete name)
