## ADDED Requirements

### Requirement: Question-posting prompt renders a new-season opener on first fire

The `SEND_QUESTIONS_INSTRUCTIONS` constant SHALL contain an opener branch that fires at the top of the question-cron flow whenever the `get_ideas` response carries `firstFireOfSeason: true`. The branch SHALL instruct Claude to prepend, ABOVE the normal question content blocks, exactly two ceremonial Block Kit blocks:

1. A `header` block whose text begins with a literal `"🆕 NEW SEASON"` prefix (Unicode characters, NOT `:new:` shortcode). Claude MAY append the season slug or theme to that prefix in a short flourish (e.g. `"🆕 NEW SEASON: HALLOWEEN SPOOKTACULAR"`).
2. A `section` block of in-persona prose that (a) names the current season's slug, (b) when AND ONLY WHEN the `get_ideas` response includes a non-empty `theme` field, mentions the theme verbatim in one short line. When `theme` is absent, the section MUST NOT mention any theme, MUST NOT speculate about one, and MUST NOT enumerate the season's categories as a stand-in.

The branch SHALL be silent (no opener blocks rendered) when `firstFireOfSeason` is `false`. The branch SHALL apply to BOTH outer flows (single-question and multi-slot): the two ceremonial blocks live above the entire question-content payload regardless of how many slots follow.

The branch SHALL NOT introduce any new tool calls; it consumes data that `get_ideas` already returns on its existing invocation. The branch SHALL NOT call `submit_response` differently — termination remains `submit_response({ skip_response: true })` after `post_questions`.

The opener SHALL fire on the FIRST question-cron fire of any season that has no saved questions stamped to it — independent of whether that season was created by `applySeasonRollover` (auto-continuation), pre-staged by an admin via `upsert_season`, or seeded as the starter season on a freshly-bootstrapped game. The detection is purely a function of `firstFireOfSeason` in the `get_ideas` payload, never any persisted "announced" flag.

#### Scenario: Opener branch present in question-posting prompt

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the returned text references `firstFireOfSeason`
- **AND** instructs Claude to render a `header` block + `section` block above the question content when that flag is `true`
- **AND** the header block's text contains the literal Unicode characters `🆕`
- **AND** the prompt explicitly tells Claude NOT to render the opener blocks when `firstFireOfSeason` is `false`

#### Scenario: Opener mentions theme conditionally

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the prompt instructs Claude to mention the `theme` field from `get_ideas` in the opener section block ONLY when that field is present
- **AND** the prompt explicitly tells Claude NOT to fabricate a theme, NOT to enumerate categories as a substitute, and NOT to say "this season has no theme" when `theme` is absent

#### Scenario: Opener applies to both single-question and multi-slot flows

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the opener branch is positioned (or worded) so it applies uniformly whether the question-cron fire produces one question or multiple slot questions
- **AND** the opener blocks sit ABOVE the entire question-content payload — not interleaved between slots and not duplicated per slot

#### Scenario: Opener fires regardless of how the season originated

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the prompt's opener branch is unconditional on the origin of the current season — it does not distinguish between rollover-auto-continuation, admin-prestaged, or lazy-bootstrap starter seasons
- **AND** the only signal it consumes is `firstFireOfSeason` from `get_ideas`

#### Scenario: Opener does NOT introduce new tool calls

- **WHEN** the `SEND_QUESTIONS_INSTRUCTIONS` constant is inspected
- **THEN** the opener branch does NOT instruct Claude to call any tool beyond the existing question-posting tool set (`get_ideas`, `find_previous_questions`, `save_question`, `post_questions`, `submit_response`)
- **AND** the run still terminates with `submit_response({ skip_response: true })`
