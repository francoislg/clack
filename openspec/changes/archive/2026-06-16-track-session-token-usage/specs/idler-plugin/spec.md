## MODIFIED Requirements

### Requirement: Activity logging and summary digest

The plugin SHALL append every autonomous action (PR opened, comments addressed, review/approval posted, unit parked with reason, failure) to an activity log. The summary task SHALL read that log and post a digest including PRs opened, comments addressed, reviews/approvals, parked units with reasons, a ready-to-merge list, and failures. The summary digest SHALL additionally report the total tokens consumed (the sum of `inputTokens` and `outputTokens` from `totalUsage`) and the approximate dollar cost (`costUsd`) over the reporting window, obtained by calling `find_recent_interactions` scoped to the idler's reporting channel with `trigger_type: "scheduled"`, a `since` bound at the start of the window, and `include_usage: true`, and reading the returned `totalUsage`. Because `totalUsage` is always present (zero when the window had no sessions), the digest SHALL render the usage line from it directly; the line is omitted ONLY if the `find_recent_interactions` call itself fails, in which case the digest still posts.

Token usage is captured at session finalization, which runs whenever a work fire executes regardless of whether that fire posts visible output. The usage figures the summary reports therefore reflect every work fire in the window, not only the fires that produced visible Slack messages.

#### Scenario: Actions are logged

- **WHEN** the work task takes an autonomous action
- **THEN** an entry describing it is appended to the activity log

#### Scenario: Summary digest covers the window

- **WHEN** the summary task fires
- **THEN** its digest reflects the logged actions for the window, including a ready-to-merge list

#### Scenario: Summary reports token and cost usage

- **WHEN** the summary task fires
- **THEN** the digest includes a line reporting the total tokens consumed and approximate dollar cost over the window, sourced from `find_recent_interactions` with `include_usage: true`

#### Scenario: Usage reflects fires that posted no visible output

- **WHEN** a work fire runs but posts no visible Slack output (e.g. a silent fire)
- **THEN** its token usage is still captured on the session and counted in the summary's window total

#### Scenario: Usage line degrades gracefully

- **WHEN** the summary task fires and the `find_recent_interactions` usage call fails
- **THEN** the digest still posts with the usage line omitted, and no error surfaces

#### Scenario: Zero-usage window reports zero

- **WHEN** the summary task fires and the window had no sessions
- **THEN** `totalUsage` is zero and the digest renders the usage line with zero values (not omitted)
