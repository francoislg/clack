## ADDED Requirements

### Requirement: Localized Home Tab Strings

All user-visible strings rendered by Home Tab code (section headers, button labels, modal titles and labels, hint text, status indicators, empty-state messages, role badges, banner text) SHALL be sourced from the localization dictionary via the `t()` helper, not from inline literal strings.

Dynamic values that are not natural-language text (repository names, channel mentions, user mentions, branch names, commit SHAs, file paths, plugin names, ISO timestamps) SHALL pass through verbatim and SHALL NOT be looked up in the dictionary.

#### Scenario: Section headers rendered through t()

- **GIVEN** the configured language is `"fr"`
- **WHEN** any user opens the Home Tab
- **THEN** every section header (e.g. "Status", "Roles", "Repositories", "Settings", "Auto-Respond", "Scheduled Messages", "Plugin Scheduled Messages", "Configuration") is rendered in French
- **AND** the underlying call site uses `t(...)` with a dictionary key, not a literal string

#### Scenario: Button labels rendered through t()

- **GIVEN** the configured language is `"fr"`
- **WHEN** the Home Tab renders buttons (e.g. "Claim Ownership", "Add Admin", "Add Dev", "Transfer Ownership", "Add Rule", "Edit", "Enable", "Disable", "Delete", "Settings", "Save")
- **THEN** the visible button label is the French translation
- **AND** the underlying call site uses `t(...)` with a dictionary key

#### Scenario: Modal labels rendered through t()

- **GIVEN** the configured language is `"fr"`
- **WHEN** a user opens a Home-Tab-launched modal (Add Rule, Edit Rule, Settings, user selectors, scheduled-message edit)
- **THEN** every modal title, input label, hint, option label, and submit-button label is rendered in French via `t()`

#### Scenario: Empty-state and hint text rendered through t()

- **GIVEN** the configured language is `"fr"`
- **WHEN** the Home Tab renders an empty-state message (e.g. "No MCP servers configured", "No rules are configured") or a hint block (e.g. "Manage in data/config.json")
- **THEN** the rendered text is the French translation via `t()`

#### Scenario: Dynamic identifiers pass through unchanged

- **GIVEN** the configured language is `"fr"`
- **WHEN** the Home Tab renders a row that includes a repository name, channel mention `<#C123>`, user mention `<@U456>`, or plugin name
- **THEN** the identifier is rendered verbatim
- **AND** the surrounding natural-language text (e.g. "created by", "last run") is sourced via `t()`

#### Scenario: Snapshot tests run against EN baseline

- **GIVEN** the test suite default language is `"en"`
- **WHEN** existing Home Tab tests run
- **THEN** they pass without modification, producing the same English output as before localization
