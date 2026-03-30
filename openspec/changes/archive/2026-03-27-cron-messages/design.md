## Context

Clack currently supports one-shot scheduled messages via `schedule_reminder`, which wraps Slack's `chat.scheduleMessage` API. This is limited to static text, 120-day maximum, and no Claude involvement at delivery time.

Users want recurring, Claude-powered scheduled tasks — "summarize PRs every morning" — where Claude runs at delivery time with full tool access. The auto-respond system (`autoRespond.ts`) provides a good precedent for state management (JSON file + in-memory cache + CRUD), and `processMessage()` already handles multiple trigger types.

## Goals / Non-Goals

**Goals:**
- Recurring and one-shot scheduled messages, both static and Claude-powered
- Natural language management through conversation (create, list, cancel)
- Admin visibility into all scheduled messages via Home Tab
- Clean integration with the existing `processMessage` pipeline
- Graceful error handling with creator notification

**Non-Goals:**
- Sub-minute scheduling granularity (cron minimum is 1 minute)
- Distributed scheduling (single-process only, fits current architecture)
- Rate limiting or cost controls on Claude executions
- Replacing the existing `schedule_reminder` tool (it stays for simple static one-shots via Slack API)
- Conversation continuity between cron ticks (each execution is independent)

## Decisions

### 1. Tick-based scheduler over cron library

**Decision**: Use `setInterval(60_000)` with `cron-parser` for expression matching, rather than a full cron library like `node-cron`.

**Why**: The tick approach is simpler — one interval, one loop, full control. `cron-parser` handles the expression parsing without owning the execution lifecycle. The scheduler is ~40 lines of code with no magic.

**Alternative considered**: `node-cron` registers individual jobs with callbacks. More conventional, but adds a layer of indirection — we'd need to sync registered jobs with disk state on every CRUD operation. The tick approach just reads the current job list each tick.

### 2. Unified model for recurring and one-shot

**Decision**: One data model with `oneShot?: boolean`. One-shot jobs use a cron expression that matches a specific datetime, and auto-delete after firing.

**Why**: Avoids two storage systems, two Home Tab sections, two sets of tools. Claude doesn't need to decide which system to use. The scheduler treats them identically — the only difference is cleanup after execution.

**Alternative considered**: Separate one-shot system (enhanced `schedule_reminder`). Rejected because it fragments management — "list my scheduled messages" would need to query two sources.

### 3. `silentThinking` in executeAndDeliver

**Decision**: Add a `silentThinking?: boolean` parameter to `ExecuteAndDeliverParams`. When true, skip `SlackStreamer` creation entirely and use a direct `chat.postMessage` delivery function.

**Why**: The cron executor posts to a channel with no user watching. Streaming "thinking..." indicators to a public channel is noise. The final result should appear as a single top-level message.

**Implementation**: When `silentThinking` is true:
- No `SlackStreamer` is created (streamer is `null`)
- `onEvent` handler is a no-op
- `buildDeliverFn` is replaced with `buildDirectDeliverFn` that posts via `chat.postMessage` without `thread_ts`
- Error handling posts errors via DM to the creator instead of to the channel

This is a general-purpose capability — any future trigger type can opt into silent delivery.

### 4. Run as creator through processMessage

**Decision**: Cron executions go through `processMessage` with `triggerType: "scheduled"`, using the creator's identity, role, and repo access.

**Why**: Reuses all existing tool wiring, role gating, MCP server setup, and session management. No parallel execution path to maintain. The only special handling is `silentThinking` and top-level posting.

**Implication**: If the creator's role is demoted below the level needed for the job's tools/repos, the job will fail and they'll get a DM notification.

### 5. Storage following autoRespond.ts pattern

**Decision**: `data/state/cron-jobs.json` with in-memory cache, same pattern as auto-respond rules.

**Why**: Proven pattern in this codebase. Simple, no database dependency. CRUD operations update cache + flush to disk atomically.

### 6. Timezone from Slack user profile

**Decision**: Store the creator's IANA timezone (from Slack's `users.info` `tz` field) at job creation time.

**Why**: Already available via `userCache.ts`. Cron expressions are inherently timezone-dependent — "9am" means nothing without a timezone. Storing at creation time means the scheduler doesn't need to look up user info on every tick.

### 7. Error handling: fail, notify, retry next tick

**Decision**: On execution failure, DM the creator with the error. Don't retry on the same tick. The job stays enabled — the next scheduled tick gets a fresh attempt.

**Why**: Most failures are transient (API rate limits, temporary outages) and will self-resolve by next tick. Retrying immediately risks amplifying the problem. No auto-disable avoids silent degradation where jobs stop running without anyone noticing.

### 8. Concurrency guard per job

**Decision**: Track a `running` flag per job. If a tick fires while the job is still executing, skip it.

**Why**: Dynamic jobs (Claude-powered) can take 30-60+ seconds. For minute-level cron expressions, overlapping executions would waste resources and potentially produce duplicate posts.

## Risks / Trade-offs

**[Claude API cost]** Each dynamic cron tick is a full Claude API call. Ten daily jobs = ~300 calls/month. No built-in cost controls.
→ *Mitigation*: Config flag gates the feature. Static messages avoid Claude calls entirely. Cost is visible through normal API billing.

**[Creator role drift]** If a creator is demoted, their jobs may fail silently on every tick until someone notices.
→ *Mitigation*: DM notification on failure. Admin Home Tab visibility shows failing jobs. Could add a `lastRunStatus` field for at-a-glance monitoring.

**[Single-process scheduler]** The tick-based scheduler runs in-process. If the bot crashes, no jobs fire until restart.
→ *Mitigation*: Acceptable for current single-instance architecture. The scheduler reloads all jobs on startup, so missed ticks during downtime are simply skipped (not retried).

**[Clock drift]** `setInterval` is not perfectly precise. Over long runtimes, the 60s tick may drift slightly.
→ *Mitigation*: Cron matching checks "does this expression match the current minute?" — minor drift within the minute boundary is harmless.
