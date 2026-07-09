## Why

Operators have no visibility into how much of the Claude subscription's rate-limit budget Clack has consumed until a run is hard-rejected — at which point work simply fails. The Agent SDK already streams `rate_limit_event` messages carrying the current window utilization and reset time for subscription auth; Clack parses these today but discards everything except the rejection flag. Surfacing the latest snapshot on the Home Tab lets admins see, at a glance, how much hourly (`five_hour`) and weekly (`seven_day`) budget remains and when it resets.

## What Changes

- Capture the full `SDKRateLimitInfo` (`status`, `utilization`, `resetsAt`, `rateLimitType`, and overage fields) from every `rate_limit_event` — not just the `rejected` case — and persist the latest snapshot **per window type** to a new `data/state/` file, timestamped with when it was observed.
- Add an **admin-only** section at the bottom of the Home Tab rendering each known window (hourly / weekly, incl. per-model weekly variants) with: percent of budget used, reset time in the viewer's locale, and a staleness note ("as of last run, N ago") since the data only refreshes when a Claude run occurs.
- When no snapshot has been observed yet (fresh boot, or API-key auth that emits no rate-limit events), the section renders a neutral "no usage data yet" state rather than being hidden — so admins understand the panel exists.
- New localized strings (EN + FR) for the section header, per-window rows, reset/staleness phrasing, and the empty state.

## Capabilities

### New Capabilities
- `home-tab-usage-limits`: Persist the latest Claude subscription rate-limit snapshot observed from `rate_limit_event` messages and render it as an admin-only Home Tab panel showing per-window utilization, reset time, and observation staleness.

### Modified Capabilities
<!-- No existing spec's REQUIREMENTS change. The rate_limit_event parsing in messageParser is
     an implementation detail not covered by a dedicated spec; the new capability owns the
     capture-and-persist requirement. -->

## Impact

- **Code**: `src/claude/messageParser.ts` (widen `rate_limit_event` capture beyond rejection), `src/claude/index.ts` (persist snapshot after a run), a new state module + zod schema under `src/` (graceful reader, `data/state/usage-limits.json`), `src/slack/homeTab.ts` (new admin-gated section + `HomeTabDeps` accessor), `src/i18n/strings/en.ts` + `fr.ts` (new keys).
- **Data**: new gitignored `data/state/usage-limits.json`.
- **Auth modes**: only populated under claude.ai subscription auth (which emits `rate_limit_event`); API-key deployments show the empty state — no error, no regression.
- **No breaking changes**; no new config flag (the panel is always present for admins).
