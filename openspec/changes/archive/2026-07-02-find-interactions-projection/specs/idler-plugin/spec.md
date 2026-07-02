# idler-plugin Specification

## MODIFIED Requirements

### Requirement: Activity logging and summary digest

The plugin SHALL append every autonomous action (PR opened, comments addressed, review/approval posted, unit parked with reason, failure) to an activity log. Each appended entry's `detail` SHALL carry the canonical link to the artifact the action touched — a PR URL, a Slack thread permalink for internal-conversation sources, or the external surface URL (e.g. Sentry/Asana) — captured at record time from the surface the work fire just acted on. The summary task SHALL read that log and post a digest including PRs opened, comments addressed, reviews/approvals, parked units with reasons, a ready-to-merge list, and failures; each reported item that has a link SHALL be rendered as a Slack hyperlink (`<url|label>`) to its artifact rather than as plain text. The summary digest message SHALL be delivered with link/media unfurling suppressed (`submit_response` `suppress_unfurls: true`) so that linked items do not expand into preview cards. The summary digest SHALL additionally report the total tokens consumed (the sum of `inputTokens` and `outputTokens` from `totalUsage`) and the approximate dollar cost (`costUsd`) over the reporting window, obtained by calling `find_recent_interactions` scoped to the idler's reporting channel with `trigger_type: "scheduled"`, a `since` bound at the start of the window, and `include: ["usage"]`, and reading the returned `totalUsage`. Requesting the usage section alone (no entries) keeps the tool result bounded, so the aggregate is always readable regardless of how many fires ran in the window. Because `totalUsage` is always present (zero when the window had no sessions), the digest SHALL render the usage line from it directly; the line is omitted ONLY if the `find_recent_interactions` call itself fails, in which case the digest still posts.

Token usage is captured at session finalization, which runs whenever a work fire executes regardless of whether that fire posts visible output. The usage figures the summary reports therefore reflect every work fire in the window, not only the fires that produced visible Slack messages.

#### Scenario: Actions are logged

- **WHEN** the work task takes an autonomous action
- **THEN** an entry describing it is appended to the activity log
- **AND** the entry's `detail` carries the canonical link to the artifact it touched (PR URL, Slack permalink, or external surface URL)

#### Scenario: Summary digest covers the window

- **WHEN** the summary task fires
- **THEN** its digest reflects the logged actions for the window, including a ready-to-merge list

#### Scenario: Digest items link to their artifacts

- **WHEN** the summary task composes a digest from logged actions that carry links
- **THEN** each such item is rendered as a Slack hyperlink (`<url|label>`) to its PR, Slack thread, or external surface

#### Scenario: Digest does not unfurl its links

- **WHEN** the summary task delivers its digest
- **THEN** `submit_response` is called with `suppress_unfurls: true` so the linked items do not expand into Slack preview cards

#### Scenario: Summary reports token and cost usage

- **WHEN** the summary task fires
- **THEN** the digest includes a line reporting the total tokens consumed and approximate dollar cost over the window, sourced from `find_recent_interactions` with `include: ["usage"]`

#### Scenario: Usage reflects fires that posted no visible output

- **WHEN** a work fire runs but posts no visible Slack output (e.g. a silent fire)
- **THEN** its token usage is still captured on the session and counted in the summary's window total

#### Scenario: Usage line degrades gracefully

- **WHEN** the summary task fires and the `find_recent_interactions` usage call fails
- **THEN** the digest still posts with the usage line omitted, and no error surfaces

#### Scenario: Zero-usage window reports zero

- **WHEN** the summary task fires and the window had no sessions
- **THEN** `totalUsage` is zero and the digest renders the usage line with zero values (not omitted)
