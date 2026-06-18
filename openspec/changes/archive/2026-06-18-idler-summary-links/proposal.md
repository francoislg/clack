## Why

The idler's morning digest lists what it did overnight (PRs opened, reviews, parked units, …) as plain text, so a human can't click through to the actual work. The artifact link already exists at the moment each action is recorded — the work fire just opened the PR or read the Slack thread — but it never reliably reaches the digest, and even when a bare URL slips into a digest line Slack unfurls it into a noisy preview card.

## What Changes

- The activity-log `detail` SHALL carry the canonical link to the artifact the action touched — a PR URL, a Slack thread permalink for internal-conversation sources, or the external surface URL (Sentry/Asana/…).
- The summary digest SHALL render each reported item as a Slack hyperlink (`<url|label>`) to that artifact rather than as plain text.
- The summary message SHALL be posted with link/media unfurling suppressed, so the digest stays skimmable instead of expanding every PR into a preview card.
- All three are prompt-only edits (`record_activity` tool description + summary prompt); no schema, tool-arg, or code change.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `idler-plugin`: the "Activity logging and summary digest" requirement gains two obligations — activity entries carry a canonical artifact link in `detail`, and the digest renders linked items with unfurling suppressed.

## Impact

- `src/plugins/idler/tools/activity.ts` — `record_activity` `detail` description (require the canonical link).
- `src/plugins/idler/prompts/summary.ts` — digest composition renders `<url|label>` links; `submit_response` called with `suppress_unfurls: true`.
- No data-format, config, or tool-schema change; `submit_response` already exposes `suppress_unfurls`.
