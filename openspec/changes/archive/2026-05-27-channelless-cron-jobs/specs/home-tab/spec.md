## ADDED Requirements

### Requirement: Schedule Rows Omit Channel Portion When Channelless

The Home Tab Scheduled Messages and Plugin Scheduled Messages subsections SHALL render rows for cron jobs that have no `channel` field, omitting the target-channel portion entirely (no `<#…>` mention, no fallback label, no placeholder text). All other row affordances — Name prefix, schedule description, owner / plugin name, last-run status, Enable/Disable button — SHALL render unchanged.

The intent is that channelless rows look identical to channel-bound rows in every respect EXCEPT that the channel reference is absent. Spacing, punctuation, and surrounding separators SHALL collapse cleanly when the channel piece is omitted (no double separators, no orphaned " — " glue).

#### Scenario: Channelless plugin-managed job omits channel reference

- **GIVEN** a plugin-managed cron job with `pluginManaged === true` and no `channel` field
- **WHEN** an admin opens the Home Tab
- **THEN** the row appears in the "Plugin Scheduled Messages" subsection
- **AND** the row text does NOT contain any `<#…>` channel mention
- **AND** the row text does NOT contain a placeholder/fallback label such as "(channelless)" or "No bound channel"
- **AND** the schedule description, plugin name, last-run status, and Enable/Disable button render exactly as for channel-bound plugin-managed rows

#### Scenario: Channelless row with a name prefix renders cleanly

- **GIVEN** a channelless plugin-managed cron job with `name: "Random Chatter"`
- **WHEN** the Home Tab renders the row
- **THEN** the row's text begins with `*Random Chatter* — ` followed by the rest of the description
- **AND** the channel portion is absent (not replaced by any placeholder)
- **AND** the leading and trailing whitespace/separators around the omitted channel piece collapse cleanly

#### Scenario: Channelless row does NOT show an Edit modal entry point

- **GIVEN** a channelless plugin-managed cron job
- **WHEN** the Home Tab renders the row
- **THEN** the row shows only Enable/Disable (the same restriction that applies to all plugin-managed rows)
- **AND** no Edit / Delete buttons appear

#### Scenario: Channelless row tolerates absent skipDates / skipConditions

- **GIVEN** a channelless plugin-managed cron job with no `skipDates` and no `skipConditions`
- **WHEN** the Home Tab renders the row
- **THEN** the row renders without crashing
- **AND** the existing rules for omitting skip indicators apply unchanged
