## Context

`humanReadableSchedule(cronExpression, timezone)` (`src/cronFormatter.ts:14`) formats the next-run time with `toLocaleTimeString(..., { timeZoneName: "short" })`, so the timezone abbreviation is always embedded in the returned string. The Home Tab calls it for every scheduled-message row (`src/slack/homeTab.ts:1638`, `:1689`) and the plugin-cron detail modal (`:1724`). Clack already knows the viewer's timezone via the Slack profile (`getUserInfo().tz`, `src/slack/userCache.ts:68`) and uses it in the system prompt and at cron-creation time, but the Home Tab rendering layer has no access to it today — `getUserInfo` is not a `HomeTabDeps` dependency.

## Goals / Non-Goals

**Goals:**
- Suppress the timezone label on Home Tab schedule rows when a job's zone matches the viewer's, show it otherwise.
- Keep the change additive and backward-compatible — non-Home-Tab callers of `humanReadableSchedule` unchanged.
- Zero new Slack API cost (reuse the populated user cache) and a safe fallback when the viewer's tz is unknown.

**Non-Goals:**
- No global/workspace default-timezone config (explicitly rejected in exploration in favor of viewer-relative).
- No change to tool-result/Claude-facing schedule strings (`create_scheduled_message`, `list_scheduled_messages`, etc.).
- No change to how jobs store or are scheduled in their timezone.

## Decisions

### Compare rendered abbreviation, not IANA identifier
The visible artifact is the short abbreviation (`"EDT"`), and two IANA zones can share one. Comparing abbreviations (computed at the job's next-run instant in both the job zone and the viewer zone) means `America/Montreal` and `America/New_York` correctly collapse to "no label" for the same viewer, while `UTC` stays labeled. Abbreviations are DST-dependent, so the comparison must be evaluated at a concrete instant — the job's next run, which the formatter already computes via `interval.next()`.

Implementation sketch: format the time without `timeZoneName`, then derive the abbreviation separately via `Intl.DateTimeFormat(..., { timeZoneName: "short" }).formatToParts()` for both zones; append ` <abbr>` only when they differ.

*Alternative considered:* raw IANA string equality (`job.timezone === viewerTz`). Rejected — fails the equivalent-zones case (`Montreal` vs `New_York` would spuriously label).

### Optional `viewerTimezone` parameter, default = current behavior
`humanReadableSchedule(cronExpression, timezone, viewerTimezone?)`. When `viewerTimezone` is `undefined`, no comparison happens and the abbreviation is always appended — identical to today. Only the Home Tab call sites pass the third arg, so every other caller is untouched without edits.

*Alternative considered:* a separate function. Rejected — duplicates the cron-parsing/formatting logic.

### New `HomeTabDeps.getUserTimezone(userId)` dependency
The viewer's tz is resolved through a new dep that wraps the existing cached `getUserInfo(client, userId)` and returns `tz` (or `undefined`). The Slack client is bound where `buildHomeView` is invoked (the home-tab handler already has it). This keeps `homeTab.ts` pure/deps-injected and testable, consistent with the existing `HomeTabDeps` pattern.

## Risks / Trade-offs

- **Viewer tz missing or stale** → fall back to always-show; correctness is never worse than today. The cache may lag a user's tz change, but schedule labels are informational only.
- **`formatToParts` called twice per row** (job + viewer abbreviation) → negligible; Home Tab render is already I/O-bound on Slack API and row counts are small.
- **Same job renders differently per viewer** → intended behavior, not a defect; each viewer sees labels relative to their own zone.
