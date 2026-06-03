## Why

Every scheduled-task row on the Home Tab appends a timezone abbreviation (`humanReadableSchedule` always passes `timeZoneName: "short"`), so a workspace where all jobs run in one zone shows redundant "EDT" / "UTC" on every row. The label is only useful when a job's zone differs from the viewer's own. Clack already knows the viewer's timezone (Slack profile `tz`) and uses it elsewhere; the Home Tab should act in the viewer's timezone too.

## What Changes

- The Home Tab scheduled-message rows (both the user-created and plugin-managed subsections, plus the plugin-cron detail modal) SHALL omit the timezone abbreviation when a job's effective timezone matches the viewing user's Slack timezone, and SHALL keep showing it when they differ.
- The match is determined by comparing the **rendered short abbreviation** at the job's next-run instant (not the raw IANA name), so equivalent zones (e.g. `America/Montreal` vs `America/New_York`) collapse to no label for the same viewer.
- `humanReadableSchedule` gains an optional `viewerTimezone` parameter; when omitted, behavior is unchanged (label always shown). Existing callers that return text to Claude or to tool-result confirmations are untouched and keep showing the label.
- A new `HomeTabDeps.getUserTimezone(userId)` dependency resolves the viewer's `tz` from the existing cached `getUserInfo`; the Slack client is bound at the home-tab handler call site. No new Slack API calls (the cache is already populated).
- Fallback: a viewer with no `tz` in their Slack profile resolves to `undefined`, which reverts that viewer's rows to the always-show behavior. No errors, zero-config safe.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `home-tab`: The "Scheduled Messages Section" requirement changes so the human-readable schedule description renders the timezone abbreviation conditionally — shown only when the job's zone differs from the viewing user's Slack timezone.

## Impact

- `src/cronFormatter.ts` — `humanReadableSchedule` gains an optional `viewerTimezone` arg and abbreviation-comparison logic.
- `src/slack/homeTab.ts` — `HomeTabDeps` gains `getUserTimezone`; `buildScheduledMessagesSection` and `buildPluginCronJobModal` pass the viewer's tz through.
- Viewer timezone sourced from `src/slack/userCache.ts` `getUserInfo().tz` (already cached).
- No config schema changes, no migration, no i18n string changes (the abbreviation is produced by `Intl`, not a `t()` key).
