# Split Investigations — Design

## Context

Clack's session model already supports a conversation whose origin and delivery surfaces differ: DM-first reactions run a session anchored to a channel message while delivering to a DM (`dmChannel`/`dmThreadTs`, `storeDmCoordinates`, thread-index routing in `src/sessions.ts`). Sessions resume Claude's context across turns via `sdkSessionId`, and thread replies find their session through the O(1) `threadIndex` (`"channelId:threadTs" → sessionId`).

What does not exist is (a) a session that *follows* other threads as read-only inputs, and (b) a way to re-home a conversation onto a new primary surface mid-life. This change adds both as one primitive.

Relevant existing machinery this design leans on:

- **Pre-analysis classifiers** (`src/claude/preAnalysis.ts`): single-turn Sonnet calls (`maxTurns: 1`, tool-disallowed) with policy-block prompts. Three variants exist; this change adds a fourth keyed to an investigation subject.
- **Auto-respond pipeline** (`src/slack/handlers/autoRespond.ts`): the message-event path that already fetches bounded thread context via `conversations.replies` and gates Claude invocations with classifiers.
- **Reaction handlers** (`src/slack/handlers/newQuery.ts`, `stopReaction.ts`): the pattern for emoji-triggered flows, including thread resolution for reaction events (which lack `thread_ts`).
- **Conditional manifest scopes** (`allowPublicSearch` in `buildScopes`): the precedent for feature-gated scope additions.
- **Home Tab state-file editing** (auto-respond rules modal, cron-job modal): `conversations_select` elements writing to `data/state/*.json` — the Home Tab never writes `config.json`.
- **Owner escalation** (`escalate_to_owner` / owner-DM path): the shipped route for operator-facing notices.
- **Cron catch-up** (`sdk.onDelayedBoot` idiom): the precedent for boot-time reconciliation of events missed while the process was down.

## Goals / Non-Goals

**Goals:**

- One surface-agnostic bootstrap serving three entry points (emoji reaction, "investigate on the side", "continue in DM/channel").
- Followed threads as first-class session state: multiple per session, per-thread mode and cursor, lossless across restarts.
- Events-driven follow pipeline with zero polling cost when nothing happens.
- Fully inert when disabled: no handlers, no tools, no scopes, no observable change.
- Live admin configuration of the investigations channel from the Home Tab (no restart).

**Non-Goals:**

- Clack never posts in followed threads beyond the single bootstrap breadcrumb. Investigation output belongs to the main surface only.
- No suppression or modification of auto-respond behavior in followed threads — the two paths coexist independently.
- No automatic investigation closure (staleness timers, PR-merge-style monitors). Closing is explicit: tool call, Home Tab button, or stop emoji on the main thread.
- No live streaming of side-thread content into the main thread message-by-message; deltas are injected per round, batched.
- No cross-workspace or cross-bot following.

## Decisions

### D1: Events-driven, not polling

New-message events in followed channels are matched against an in-memory index (backed by `data/state/investigations.json`) keyed `(channel, threadTs)`. On match, the event is routed to the follow pipeline; non-matching events proceed through the normal pipeline untouched.

- *Alternative considered — 60s polling sweep* (the casual-talk/idler `conversations.replies` pattern): rejected by explicit decision. Polling would have avoided membership/scope requirements but costs per-tick API calls across all open investigations and adds up to 60s latency.
- *Consequence 1 — scopes and membership*: live events require bot membership in the side channel. Bootstrap auto-joins public channels (`conversations.join`); private channels imply membership already (the bot saw the reaction). A public channel where join fails degrades that thread to `follow` semantics with an owner note.
- *Consequence 2 — downtime*: events missed while down are lost as *signals* but never as *content* — every round drains `conversations.replies(oldest: lastInjectedTs)`, so missed messages are picked up by the next round. A boot reconciliation pass (delayed-boot idiom) sweeps open investigations once: any followed thread with `followAndInteract` mode and undrained messages gets a classifier evaluation, restoring the lost trigger.

### D2: Cursor semantics — `lastInjectedTs` + drain-on-round

Each followed thread carries `lastInjectedTs` (the newest side-thread ts whose content has been injected into the main session) and `pendingCount` (messages seen since, for `follow`-mode surfacing). The event is the *trigger*; the drain is a *fetch*. When a round runs — for any reason — it drains all followed threads' deltas since their cursors, injects them, and advances every cursor. This gives:

- Batching for free: rapid side messages during an in-flight round are drained by that round (the active-run `append`/`skip` guard already dedups triggers).
- Losslessness: cursors only advance when content has actually been injected.
- `follow`-mode piggyback: pendingCount > 0 renders as a "N new messages in <thread>" context line whenever the main session next runs; Claude decides whether to read them (the drain has already made the content available).

### D3: One bootstrap, `surface` parameter

`bootstrapInvestigation({ surface: "channel" | "dm", originThread, requester, subject? })`:

1. Resolve surface — investigations channel from state (missing → owner DM + requester notice on the conversational path; reaction path → owner DM only) or open a DM with the requester.
2. Create the main-surface parent message ("Investigating <permalink>…" / "Continuing from <permalink>…"), create the session with `followedThreads: [origin]`, index the main thread → session.
3. Run the first round immediately over the **full** origin-thread history (`lastInjectedTs` starts at 0, drain covers everything); post findings to the main thread.
4. Post the one-time breadcrumb in the origin thread ("Investigating in <link>" / "Continuing in DM"), through `t()`.

The reaction handler, the `start_investigation` tool, and the relocation phrasing all call this one function. The DM surface needs no configured channel — relocation to DM works even where investigations are not set up.

- *Alternative — separate paths per entry point*: rejected; three implementations of create-follow-round-breadcrumb would drift.

### D4: Config/state split — `config.investigations` + `data/state/investigations.json`

- `config.investigations = { enabled: boolean, emoji: string /* default "mag" */ }` — fail-fast zod, boot-level. Gates handler registration, tool registration, event routing, and manifest scopes. These are genuinely boot concerns (scopes need reinstall; handlers register at boot).
- `data/state/investigations.json` — graceful zod (permissive; mismatch → log + default, never wipe): `{ channel: string | null, open: Record<"channel:threadTs", OpenInvestigation> }`. Home-Tab-editable, effective immediately.

- *Alternative — channel in config.json*: rejected. The Home Tab has no config.json write path (both existing channel pickers write state files), and inventing one adds hot-reload complexity for no benefit. The auto-respond split (feature block in config, data in state) is the established pattern.
- *Consequence*: "enabled but no channel" is a normal onboarding state, not a misconfiguration — enable in config, pick the channel in the Home Tab.
- The emoji lives in `config.investigations.emoji`, deliberately NOT under `config.reactions` — the feature is self-contained (explicit user decision).

### D5: Follow modes reuse the pre-analysis scaffolding

A fourth classifier variant, `runInvestigationPreAnalysis`, mirrors `runPreAnalysis` (Sonnet via `preAnalysisModel`, `maxTurns: 1`, disallowed tools) with a prompt keyed to the investigation subject: "given this investigation's subject and the new side-thread messages, is there new information worth an investigation round?" Verdicts: `respond | skip` (no `stop` — unfollowing is explicit).

- `followAndInteract`: every human side-thread message triggers one classifier call (no cap, no debounce — explicit decision to mirror thread auto-respond's cost profile). "respond" → drive a main-session round: `processMessage` on the persisted session (resume via `sdkSessionId`) with the drained delta injected as context and a synthetic trigger.
- `follow`: no classifier, no Claude — `pendingCount++`, persist, done. Surfaced purely piggyback (explicit decision: a silent investigation stays silent until touched).

### D6: Main-session rounds are thread-reply turns on the persisted session

An investigation round is a normal `processMessage` turn against the main-surface session (same tools, same delivery, same submit_response contract), with a preamble injecting the drained side-thread deltas (attributed, timestamped, permalinked — the enriched-context format the auto-respond path already builds). Human posts in the main thread work exactly like today's thread replies (the session is thread-indexed); the only addition is the pre-turn drain.

- *Alternative — a dedicated trigger type*: unnecessary; `triggerType` stays what the session was created with, and the delivery-context capability gains investigation-surface descriptions instead.

### D7: Guards

- **Cycle**: `follow_thread` and the reaction handler reject threads living in the investigations channel.
- **Dedup**: the index is keyed `(channel, threadTs)`; a second investigate reaction on an already-followed thread gets an ephemeral link to the existing investigation instead of a fork.
- **Bot filtering**: side-thread events from Clack (bot messages, including the breadcrumb) never count as deltas or bump cursors-pending.
- **Stop**: the existing stop emoji on the main thread cancels in-flight work as today; closing the investigation (tool/Home Tab) removes it from the index — followed-channel events stop matching immediately.

## Risks / Trade-offs

- **[Scope/reinstall friction]** Enabling requires manifest re-upload + reinstall (conditional scopes). → Documented in the config-block description and README, same operator note as `allowPublicSearch`; a stale token degrades with a clear error, never silently.
- **[Public channel join fails]** `conversations.join` can be restricted; events then never arrive. → Degrade that thread to `follow` semantics + owner note at bootstrap time (detected immediately, not silently later).
- **[Classifier cost on chatty threads]** `followAndInteract` with no cap can burn a Sonnet call per message in a busy incident thread. → Accepted by explicit decision (mirrors engaged auto-respond threads); `follow` mode is the cheap alternative, and admins see open investigations in the Home Tab.
- **[Index staleness across processes]** In-memory index vs. state file drift if edits race. → Single-writer discipline: all mutations go through one module that persists then updates memory (the auto-respond rules pattern); per-session write lock already serializes session updates.
- **[DM surface with multiple participants]** A DM investigation is private to the requester while followed threads may be team-visible. → Accepted; the requester chose DM. The breadcrumb in the origin thread says where the conversation went (visible to all), without leaking content.
- **[Event pipeline ordering]** Followed-thread routing must not swallow events the auto-respond path needs (coexistence decision). → The routing step *tees* matching events to the follow pipeline and always lets the normal pipeline continue; a guard test asserts both fire.

## Migration Plan

Purely additive. No migration: absent `config.investigations` → disabled; absent `followedThreads` on existing sessions → no follows; state file created on first write. Rollback = disable the flag (open investigations stay on disk, inert, and resume if re-enabled).

## Open Questions

None — all forks were resolved during exploration (events-driven, core placement, piggyback `follow`, immediate first round, breadcrumb, coexistence, no classifier cap, one-change scope, config/state split, Home Tab section).
