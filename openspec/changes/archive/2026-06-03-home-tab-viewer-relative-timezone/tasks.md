## 1. Formatter: conditional timezone abbreviation

- [x] 1.1 Add optional `viewerTimezone?: string` param to `humanReadableSchedule` in `src/cronFormatter.ts`
- [x] 1.2 Format the next-run time WITHOUT `timeZoneName`, then derive the short abbreviation separately (via `Intl.DateTimeFormat(..., { timeZoneName: "short" }).formatToParts(next)`) for the job zone
- [x] 1.3 When `viewerTimezone` is provided, derive the viewer's abbreviation at the same next-run instant; append the job abbreviation only when the two differ. When `viewerTimezone` is undefined, always append (current behavior)
- [x] 1.4 Ensure all schedule shapes (sub-daily, weekly, monthly, every-day) route through the same conditional-abbreviation logic — no path hardcodes the inline `timeZoneName`

## 2. Home Tab wiring

- [x] 2.1 Add `getUserTimezone: (userId: string) => Promise<string | undefined>` to `HomeTabDeps` in `src/slack/homeTab.ts`; implement in `defaultHomeTabDeps` by wrapping cached `getUserInfo` and returning `tz`
- [x] 2.2 Bind the Slack client for `getUserTimezone` at the home-tab handler call site that invokes `buildHomeView`
- [x] 2.3 In `buildScheduledMessagesSection`, resolve the viewer's tz once and pass it as the third arg to both `humanReadableSchedule` calls (user-created rows and plugin-managed rows)
- [x] 2.4 In `buildPluginCronJobModal`, thread the viewer's tz through to its `humanReadableSchedule` call

## 3. Tests

- [x] 3.1 Unit tests for `humanReadableSchedule`: label omitted when job tz matches viewer tz; label shown when they differ; equivalent zones (Montreal vs New_York) collapse to no label; `undefined` viewer tz always shows label
- [x] 3.2 Home Tab test: `getUserTimezone` returning `undefined` falls back to always-show; matching tz omits label on both subsections (mock `getUserTimezone` and `humanReadableSchedule` deps)

## 4. Verify

- [x] 4.1 `npx tsc` clean, `npx oxlint` + `npx oxfmt --check` pass on changed files, `npm test` green
- [x] 4.2 `openspec validate home-tab-viewer-relative-timezone --strict` passes
