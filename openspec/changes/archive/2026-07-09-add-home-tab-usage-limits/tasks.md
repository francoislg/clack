## 1. State module (capture + persistence)

- [x] 1.1 Create `src/usageLimits.ts` with a permissive zod schema for `data/state/usage-limits.json` — a map keyed by `rateLimitType` to `{ utilization?, resetsAt?, status, observedAt, overageStatus?, overageResetsAt?, isUsingOverage? }`, all fields optional/permissive, top-level `.default({})`.
- [x] 1.2 Add `readUsageLimits()` (graceful: log + return `{}` on missing/malformed file) and `recordUsageLimit(info)` (stamps `observedAt` at write time, merges the one window without clobbering others) using the same guarded write helper other `src/*.ts` state modules use.
- [x] 1.3 Unit-test the schema + helpers: valid round-trip, malformed file → `{}` + logged, per-window merge preserves other windows, `observedAt` stamped.

## 2. Capture from the run stream

- [x] 2.1 In `src/claude/messageParser.ts`, import `type SDKRateLimitInfo` from `@anthropic-ai/claude-agent-sdk` (alongside the existing `SDKMessage` import) and on `rate_limit_event` capture the full `rate_limit_info` snapshot (not just the rejection) — add a `rateLimitSnapshot` getter (most-recent-event-wins) alongside the existing `_platformLimit` logic; keep rejection behavior unchanged.
- [x] 2.2 In `src/claude/index.ts`, after the run stream completes (near the existing `addSessionUsage` persistence), if a snapshot was observed call `recordUsageLimit(...)` once — persisting only the final observed snapshot after the stream ends (not on every `rate_limit_event`), errors caught + logged (never fail the run).
- [x] 2.3 Extend `messageParser` tests: allowed event with `utilization` is captured, rejected event still sets `platformLimit` AND is captured, later "allowed" clears rejection but retains snapshot.

## 3. Home Tab section

- [x] 3.1 Add `getUsageLimits: () => Promise<UsageLimitsState>` to `HomeTabDeps` (async, mirroring `loadRoles`) and wire the default impl in `defaultHomeTabDeps` to `readUsageLimits()`.
- [x] 3.2 Implement `async buildUsageLimitsSection(deps): Promise<KnownBlock[]>` in `src/slack/homeTab.ts`: one row per known window in fixed order (`five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet`, `overage`), then any unknown `rateLimitType` with a generic fallback label; each row shows percent used (clamped 0–100), reset time (locale), and observation staleness; explicit empty state when no snapshots; "may be outdated" note when `observedAt` is older than 30 minutes; entries missing `observedAt` render reset time but no staleness note.
- [x] 3.3 Push the section from `buildHomeView` only when `userIsAdmin` (admin+), at the bottom of the view, using the `await` + spread pattern (`blocks.push(...(await buildUsageLimitsSection(deps)))`).
- [x] 3.4 Tests: admin sees populated rows; non-admin (member/dev) does not see the section; empty state renders; stale reading annotated (>30 min); utilization clamped; unknown `rateLimitType` renders with fallback label; entry missing `observedAt` renders reset time without staleness note.

## 4. Localization

- [x] 4.1 Add the new keys (section header, window labels, percent/reset/staleness phrasing, empty state) to `src/i18n/strings/en.ts` and translated equivalents to `fr.ts`.
- [x] 4.2 Run the i18n parity test — confirm key/placeholder parity and no FR value left identical to EN (allowlist only if legitimately identical).

## 5. Verify

- [x] 5.1 `npx tsc` clean; `npx oxlint` + `npx oxfmt --check` on all touched files; `npm test` passes.
- [x] 5.2 `openspec validate add-home-tab-usage-limits --strict` passes.
