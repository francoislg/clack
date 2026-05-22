## ADDED Requirements

### Requirement: Localized Bot-Authored Change Workflow Messages

All user-visible messages posted to Slack by change-workflow code itself (not by Claude through `report_status` or `submit_response`) SHALL be sourced from the localization dictionary via the `t()` helper. This includes:

- The initial "Setting up workspace…" status message posted before Claude begins executing.
- Cancellation confirmations (e.g. "Cancelled by user").
- Quarantine notifications sent to the worker's owner via DM (the bot-authored framing of the message; the quarantined-file list passes through verbatim).
- "PR merged externally" / "PR closed externally" notifications posted by the background monitor.
- "Active Workers" Home Tab section labels (status, "Cancelled" label, paused/one-time indicators).
- Idle-release / setup-version-mismatch admin notifications.

Dynamic values (branch name, repo name, PR URL, user mention, ISO timestamps, the description the user originally provided) SHALL pass through verbatim.

#### Scenario: Initial workspace setup message localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** a change workflow starts and the orchestrator posts the initial status message
- **THEN** the message text is in French via `t()`

#### Scenario: Cancellation confirmation localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** a worker is cancelled and the cancellation confirmation is posted
- **THEN** the bot-authored framing (e.g. "Cancelled by") is in French via `t()`
- **AND** the canceller's user mention `<@U…>` passes through verbatim

#### Scenario: External-merge / external-close notifications localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** the background monitor detects an externally merged or closed PR and posts a notification to the original thread
- **THEN** the bot-authored notification text is in French via `t()`
- **AND** the PR URL and branch name pass through verbatim

#### Scenario: Quarantine DM localized

- **GIVEN** the configured language is `"fr"` AND the reusable-worker pool is enabled
- **WHEN** a worker is quarantined and the owner receives a DM
- **THEN** the bot-authored framing of the DM is in French via `t()`
- **AND** the quarantined file list passes through verbatim

#### Scenario: Active Workers Home Tab labels localized

- **GIVEN** the configured language is `"fr"`
- **WHEN** the Home Tab renders the Active Workers section
- **THEN** the section header, status labels, and "Cancelled" indicator are in French via `t()`
- **AND** the branch, repo, user mention, description, and PR URL pass through verbatim

### Requirement: Claude-Authored Change Workflow Narration Honors Language Directive

Text produced by Claude within the change workflow — including `report_status` messages, PR-description content (within Clack's control rather than the user's literal template), commit messages, and any `submit_response` text — SHALL be produced in the configured language because the system prompt path used by change-workflow Claude invocations contains the language directive.

PR templates loaded from `data/default_configuration/{repo}/changes_instructions.md` or repo overrides are operator-authored and are NOT translated by the system; whether their content is in the configured language is the operator's responsibility.

#### Scenario: report_status messages produced in configured language

- **GIVEN** the configured language is `"fr"`
- **WHEN** Claude calls `report_status` during change execution
- **THEN** the message text Claude provides is written in French (via the language directive)
- **AND** the bot posts the message verbatim, without further translation

#### Scenario: PR description content produced in configured language where Claude is the author

- **GIVEN** the configured language is `"fr"`
- **WHEN** Claude composes PR description content for `ensure_pr`
- **THEN** the prose Claude writes is in French (via the language directive)
- **AND** code blocks, file paths, identifiers, and quoted technical terms pass through in their original form

#### Scenario: Operator-supplied PR template passes through unchanged

- **GIVEN** the configured language is `"fr"` AND `{repo}/changes_instructions.md` contains an English PR template
- **WHEN** the template is loaded and presented to Claude
- **THEN** the template is NOT translated by the system
- **AND** the operator is responsible for translating the template if they want a fully French output
