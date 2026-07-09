## Context

Clack runs Claude through `@anthropic-ai/claude-agent-sdk`. Under claude.ai subscription auth, the SDK streams `rate_limit_event` messages (`SDKRateLimitEvent`) whose `rate_limit_info: SDKRateLimitInfo` carries:

- `status`: `"allowed" | "allowed_warning" | "rejected"`
- `utilization?`: number (fraction of the window consumed)
- `resetsAt?`: epoch seconds
- `rateLimitType?`: `"five_hour" | "seven_day" | "seven_day_opus" | "seven_day_sonnet" | "overage"`
- overage fields (`overageStatus`, `overageResetsAt`, `isUsingOverage`, `overageDisabledReason`)

`ClaudeMessageParser.process` (`src/claude/messageParser.ts:186`) already inspects these events but keeps only the rejection flag (`_platformLimit`), discarding `utilization`/`resetsAt` on the non-rejected path. There is **no way to poll** current limits — the data only exists as a side-channel on an active run's stream.

The Home Tab (`src/slack/homeTab.ts`, `buildHomeView`) composes role-gated sections; admin gating is `deps.canManageRoles(role)`. Sections pull data through injected `HomeTabDeps` accessors (never direct I/O), consistent with the existing `buildStatusSection`/`buildWorkersSection` pattern. State files live in `data/state/*.json` and are read through **graceful** zod schemas (log + default on mismatch, per the project's persisted-state rule).

## Goals / Non-Goals

**Goals:**
- Capture the full rate-limit snapshot (not just rejections) from every `rate_limit_event`.
- Persist the latest snapshot **per `rateLimitType`**, each stamped with its observation time.
- Render an admin-only Home Tab panel: per-window percent used, reset time (viewer locale), and how stale the reading is.
- Degrade cleanly to an explicit empty state when no snapshot exists (fresh boot / API-key auth).

**Non-Goals:**
- No polling/refresh mechanism — the panel is a passive reflection of the last observed run. (There is no SDK API to poll.)
- No alerting, thresholds, or config flag. No historical charting.
- No change to the existing hard-limit rejection handling / owner escalation flow.
- Not surfaced to non-admins.

## Decisions

**1. Widen capture at the existing `rate_limit_event` site, keep rejection logic intact.**
In `messageParser.process`, in addition to computing `_platformLimit`, expose the raw `SDKRateLimitInfo` of the most-recent event (e.g. a new `_rateLimitSnapshot` getter). The parser stays pure (no I/O); persistence happens one layer up.
- *Alternative considered*: persist directly inside the parser. Rejected — the parser is a pure stream transformer with unit tests that must not touch disk; I/O belongs in `src/claude/index.ts` where session usage is already persisted (`addSessionUsage`, index.ts:603).

**2. Persist per-window, keyed by `rateLimitType`.**
The store is a map `{ [rateLimitType]: { utilization?, resetsAt?, status, observedAt, ...overage } }`. A run typically emits events for one window at a time; keying by type means a hourly reading never clobbers the last weekly reading. Each entry records `observedAt` (epoch ms) so the Home Tab can show staleness.
- *Alternative considered*: single latest snapshot regardless of type. Rejected — hourly and weekly would overwrite each other, defeating the "hourly AND weekly" ask.

**3. New graceful state module + zod schema.**
Add `src/usageLimits.ts` (mirroring the shape of other `src/*.ts` state modules) owning `data/state/usage-limits.json`, a `zod` schema (all fields optional/permissive, `.default({})`), and `readUsageLimits()` / `recordUsageLimit(info)` helpers. On parse failure: log + return `{}` (never throw — graceful reader per CLAUDE.md).
- *Timestamps*: `observedAt` is written from `Date.now()` at record time.

**4. Home Tab section via a `HomeTabDeps` accessor.**
Add `getUsageLimits: () => UsageLimitsState` to `HomeTabDeps` (default impl reads the module; tests inject fixtures). `buildHomeView` pushes `buildUsageLimitsSection(role, deps)` only when `userIsAdmin`. The section renders one row per known window in a fixed order (hourly, weekly, then per-model weekly / overage when present), formatting `utilization` as a percent and `resetsAt` as a locale time.
- *Percent semantics*: display "N% used" (and optionally "~M% left"). `utilization` is treated as a 0–1 fraction; clamp to `[0,1]` defensively.
- *Staleness*: derive "as of <relative time>" from `observedAt`; if older than a fixed **30-minute** threshold add a subtle "may be outdated" hint. An entry missing `observedAt` (partial/legacy state) still renders its reset time but shows no "as of" note.
- *Unknown window types*: a `rateLimitType` the UI has no dedicated label for (future SDK enum value) still renders as a row with a generic fallback label — the schema stores unknown types rather than rejecting them.

**5. All user-facing strings through `t()`**, added to `en.ts` (source of truth) and `fr.ts`, satisfying parity (no FR value identical to EN unless allowlisted). Window labels map `rateLimitType` → localized name (hourly / weekly / weekly (Opus) / weekly (Sonnet) / overage).

## Risks / Trade-offs

- **[Stale data]** The panel reflects the last run, not "now"; between runs utilization is frozen. → Always show `observedAt` staleness; reset *times* stay accurate because they're absolute. Copy makes the "as of last run" nature explicit.
- **[API-key deployments emit no events]** The store stays empty forever. → Explicit empty state ("no usage data yet — only available on subscription auth"), never an error or a hidden section.
- **[SDK field drift]** `rateLimitType` enum or `utilization` semantics could change across SDK versions. → Permissive schema (unknown types still stored and rendered with a fallback label); clamp utilization; no strict enum rejection.
- **[Write frequency]** `rate_limit_event` can fire multiple times per run. → Debounce to a single write of the final snapshot per run (persist once after the stream completes, alongside existing post-run usage persistence), not per event.
- **[Concurrency]** Multiple concurrent runs writing the same file. → Last-write-wins on a small file is acceptable (snapshot is inherently "latest observed"); reuse the same guarded write helper other state modules use.

## Migration Plan

- Additive only: new state file is created lazily on first observed event; absent file → empty state. No data migration, no boot migration.
- Deploy is a standard image roll (`scripts/gce-update-image.sh`); no config or manifest change.
- Rollback: revert the code; the orphaned `data/state/usage-limits.json` is inert and can be left or deleted.

## Open Questions

- Display "% used" vs "% remaining" vs both — resolve during implementation against the existing Home Tab copy density (lean: "N% used · resets <time>").
- Whether to also surface overage state (`isUsingOverage`) as a distinct row or an inline badge — include only if present, decided at render time.
