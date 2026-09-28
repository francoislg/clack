## MODIFIED Requirements

### Requirement: Activity logging and summary digest

The plugin SHALL append every autonomous action (PR opened, comments addressed, review/approval posted, unit parked with reason, failure) to an activity log. Each appended entry's `detail` SHALL carry the canonical link to the artifact the action touched — a PR URL, a Slack thread permalink for internal-conversation sources, or the external surface URL (e.g. Sentry/Asana) — captured at record time from the surface the work fire just acted on. The summary task SHALL read that log and post a digest including PRs opened, comments addressed, reviews/approvals, parked units with reasons, a ready-to-merge list, and failures; each reported item that has a link SHALL be rendered as a Slack hyperlink (`<url|label>`) to its artifact rather than as plain text. The summary digest message SHALL be delivered with link/media unfurling suppressed (`submit_response` `suppress_unfurls: true`) so that linked items do not expand into preview cards. The summary digest SHALL additionally report the approximate dollar cost and the total tokens consumed over the reporting window, obtained by calling `find_recent_interactions` scoped to the idler's system actor (`plugin: "idler"`) with `trigger_type: "scheduled"`, `include: ["usage"]`, and a lower bound matching the activity log's window, and reading the returned `totalUsage`. The spend window SHALL be the same as the activity log's window. When the log is cleared, the plugin SHALL record the clear time server-side as `windowStart` (epoch milliseconds) in the activity file, and `read_activity` SHALL return it. The summary SHALL pass that value verbatim as `since`. When no `windowStart` has been recorded yet (a log never cleared), `read_activity` SHALL return `windowStart: null` and the summary SHALL use `since_hours: 24` instead. Claude SHALL NOT compute any timestamp itself. The digest SHALL render this as a spend line `🧮 Spend: <totalUsage.summary>`, copying the server-formatted `summary` verbatim (e.g. `🧮 Spend: ~$2.93 · 5.53M tokens (5.09M cached)`); Claude SHALL NOT compute or reformat any usage figure itself. Requesting the usage section alone (no entries) keeps the tool result bounded, so the aggregate is always readable regardless of how many fires ran in the window. Because `totalUsage` is always present (zero when the window had no sessions), the digest SHALL render the usage line from it directly; the line is omitted ONLY if the `find_recent_interactions` call itself fails, in which case the digest still posts.

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
- **THEN** the digest includes a line `🧮 Spend: <totalUsage.summary>` reporting the approximate dollar cost and total tokens over the window, sourced from `find_recent_interactions` with `plugin: "idler"`, `include: ["usage"]`, and `since` set to `read_activity`'s `windowStart`

#### Scenario: Spend window spans an off-day gap like the activity log

- **WHEN** the previous summary cleared the log on Friday at 09:00, the next summary fires on Monday at 09:00, and idler fires ran on Friday evening
- **THEN** `read_activity` returns the Friday 09:00 `windowStart`
- **AND** the spend line's `find_recent_interactions` call passes it as `since`, so Friday evening's spend is counted alongside Friday evening's logged actions

#### Scenario: Never-cleared log falls back to 24 hours

- **WHEN** the summary fires and the activity file has no recorded `windowStart`
- **THEN** `read_activity` returns `windowStart: null`
- **AND** the spend line's call uses `since_hours: 24`

#### Scenario: Spend line is printed verbatim from the server summary

- **WHEN** `totalUsage.summary` is `~$2.93 · 5.53M tokens (5.09M cached)`
- **THEN** the digest's spend line is exactly `🧮 Spend: ~$2.93 · 5.53M tokens (5.09M cached)`, with no token arithmetic done by Claude

#### Scenario: Usage reflects fires that posted no visible output

- **WHEN** a work fire runs but posts no visible Slack output (e.g. a silent fire)
- **THEN** its token usage is still captured on the session and counted in the summary's window total

#### Scenario: Usage line degrades gracefully

- **WHEN** the summary task fires and the `find_recent_interactions` usage call fails
- **THEN** the digest still posts with the usage line omitted, and no error surfaces

#### Scenario: Zero-usage window reports zero

- **WHEN** the summary task fires and the window had no sessions
- **THEN** `totalUsage` is zero and the digest renders the usage line from its zero `summary` (`🧮 Spend: ~$0.00 · 0 tokens`), not omitted
