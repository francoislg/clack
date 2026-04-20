## Context

The 2026-04-07 keep-alive shipped with a 15s interval that re-sends a `task_update` on the `THINKING_TASK_ID` with rotating dots in the title (`slackStreamer.ts:365-386`). This was intended to reset Slack's server-side inactivity timer. In production we observed on 2026-04-20 that a worker run's "Working on clack/feat/lightweight-accounts-endpoint" message stopped updating partway through a 67-second Bash typecheck call, while the worker itself completed successfully — implying Slack expired the stream despite the keep-alive.

We have no production log data to confirm what went wrong, because the keep-alive is silent and the default `LOG_LEVEL` in Docker is `info` (debug is suppressed — `src/logger.ts:6`).

Known chunk-field semantics from the existing code and Slack SDK types:
- `title` — REPLACES on subsequent updates (proven by group count suffix and `(failed)` rewrite)
- `details` — APPENDS on subsequent updates (proven by the `\n${itemDetail}` pattern at `slackStreamer.ts:184,221`)
- `output`, `sources` — semantics unknown; not used in the codebase

## Goals / Non-Goals

**Goals:**
- Keep the Slack stream alive through long idle windows (worker mode's Bash tools routinely run 45-70s).
- Show useful, user-visible elapsed-time progress on any task running ≥30s.
- Produce one line of diagnostic output when a stream expires despite the keep-alive, so we can measure Slack's real inactivity window from production logs.
- Handle all in-progress tasks, not just the thinking header. Parallel tools and groups must all be covered.

**Non-Goals:**
- Stream recovery (start a new stream when the current one dies). If diagnostics show this is still needed, propose separately.
- Changes to task-grouping behavior, tool-label formatting, or answer delivery.
- Incremental text streaming of Claude's answer.
- Any change that requires debug-level logging in production.

## Decisions

### Decision: Combine title-replace + details-append in a single chunk per task

Each keep-alive tick, for every in-progress task ≥30s old, emit one `task_update` chunk with:
- `title`: `{currentTitle} :stopwatch: {fmtElapsed(now - startedAt)}` — live counter, visually informative
- `details`: `"\n ."` on the first tick past threshold, then `" ."` on subsequent ticks — append-only, guaranteed new content

**Why both:** the most likely cause of the current failure is that Slack dedupes no-op-ish title updates on the same task ID. Appending unique content to `details` is a safety net — Slack cannot dedupe genuinely new characters. If the dedupe hypothesis is wrong, the dots are harmless and the title timer is still useful.

**Alternatives considered:**
- *Title only with timer*: cleaner but shares the same dedupe risk as the current rotating dots.
- *Details only (dots)*: works against dedupe but no visible elapsed time.
- *Transient ticker tasks* (new task ID each tick, status=complete immediately): forces Slack to register a new chunk but pollutes the plan view with N ticker rows.
- *Status toggle (in_progress ↔ pending)*: genuinely state-changing but risks UX flicker and is semantically wrong.

### Decision: Track all in-progress tasks in a dedicated map

Add an `activeTasks: Map<slackId, { startedAt, baseTitle, isGroup, tickCount }>` to `SlackStreamer`.

- `tool_start` (new task): add entry with `startedAt = now`, `baseTitle = undefined`.
- `tool_start` (joining a group): do NOT reset `startedAt` — the group's age is what the user perceives.
- `tool_end` (group still pending): keep the entry; the group is still running.
- `tool_end` (status → complete): remove the entry.

**Why track all:** Claude fires parallel tool calls (multiple Reads in one assistant turn), and a single THINKING task doesn't represent what's actually stuck. Decorating every in-progress task gives a faithful view.

**Why lazy `baseTitle` snapshot:** tool_start can fire with empty args first (placeholder label) and then with real args (real label), via the re-emit logic at `slackStreamer.ts:161-171`. Snapshotting eagerly at tool_start would capture the placeholder. Instead, snapshot at the first decoration tick (after the 30s threshold) — by then the real label is in `taskLabels` or the group title is stable. For grouped tasks, re-derive `groupTitle(openGroup)` on every tick so the `(N)` count stays current as items join mid-decoration.

### Decision: 30-second threshold before decoration

Tasks faster than 30s get no decoration — they complete before the first tick past threshold, so nothing ever appears. This keeps fast tools (Read, Edit, most Greps) visually clean.

The 15s tick interval remains — we still need a heartbeat before Slack's timeout (inferred ~30s from the pre-keep-alive design doc).

### Decision: Enrich the existing stream-failure log, warn-level only

At `slackStreamer.ts:410-411` and `:335-338`, update the existing warn-level log to include:
- `msSinceLastTick` — elapsed since the most recent keep-alive tick fired
- `msSinceLastEvent` — elapsed since the most recent real `handleEvent` call
- `activeTaskCount` — size of the `activeTasks` map at failure

**Why warn, not info:** info would fire per-stream during normal teardown when streams naturally expire at `stop()`. Warn only fires when mid-stream append fails — that's the interesting case. Docker production defaults to `info` so warn reaches the logs (`src/logger.ts:6`).

**Why not per-tick logging:** firing every 15s across every worker would flood logs. The failure log alone answers the question we care about: *did keep-alive fire, and for how long, before Slack killed the stream?*

### Decision: Group title derivation at tick time

For grouped tasks the `currentTitle` changes as items join (`"Running command"` → `"Running commands (2)"` → `"(3)"`). We derive the current title at tick time by re-computing `groupTitle(openGroup)` rather than snapshotting at `tool_start`. That way the title suffix "stays fresh" and correctly reflects ongoing group activity.

### Decision: Timer format

`{n}s` for < 60s, `{m}m {s}s` for longer. Drop seconds when minutes ≥ 10 (cosmetic). Emoji: `:stopwatch:` (renders ⏱ universally in Slack).

## Risks / Trade-offs

**[Risk]** Appending dots to `details` on completed-but-not-yet-marked-complete tasks leaves the dots frozen in the final task state → Mitigation: accepted. The dot trail is chronologically accurate ("this task waited 90s"). It is additive, not destructive.

**[Risk]** When a new tool joins a group mid-tick, its itemDetail appends AFTER any accumulated dots → Mitigation: accepted. Chronological interleaving reflects what actually happened. Not visually perfect but not confusing.

**[Risk]** The root-cause hypothesis (Slack dedupes title-only updates) could be wrong. Changing both title and details simultaneously doesn't disprove it if another factor is at play (hard stream lifetime, event-loop starvation) → Mitigation: the enriched failure log will tell us definitively. If diagnostics show keep-alive ticks are firing but streams still die, we know the content strategy isn't enough and recovery becomes the next step.

**[Risk]** Increased `chat.appendStream` call volume — one call per in-progress task ≥30s, every 15s → Mitigation: still well below Slack's rate limits. Typical worker runs have 1-3 in-progress tasks at any moment; worst case ~12 calls/min vs the 300ms buffer_size = 200 calls/min cap.

## Migration Plan

Deploying the change requires no data migration. The streamer is a per-process object; existing in-flight streams continue with the old keep-alive until they terminate. New streams (any trigger after deploy) use the new keep-alive.

No rollback hazard: disabling the new behavior is a code revert. No persisted state changes shape.

## Open Questions

1. What is Slack's actual inactivity timeout? The enriched failure log will let us measure it from the first post-deploy expiry we observe. If it's <15s we'd need to shorten the tick interval.
2. Should we extend the log to also capture the final stream-stop status (e.g. `stop()` successful vs `message_not_in_streaming_state` at finalization)? Minor — can add in a follow-up if needed.
