# Split Investigations

## Why

Long or noisy Slack threads are a poor place for Clack to run a deep investigation: the analysis competes with the human conversation, and there is no way to "take it offline" while still tracking what happens in the source thread. Users need a way to split Clack's work onto a separate surface (a dedicated investigations channel or a DM) that keeps following the original thread(s) as read-only sources.

## What Changes

- **New split primitive**: a conversation can be re-homed onto a new *main surface* while *following* one or more source threads read-only. Clack writes only to the main surface; followed threads are inputs, never outputs (except a one-time bootstrap breadcrumb).
- **Three entry points, one bootstrap**: a configurable investigate emoji reaction, a conversational request ("investigate this on the side"), and a conversational relocation ("let's continue this in DM / in the investigation channel"). All funnel into the same surface-agnostic bootstrap: create main surface → follow the origin thread → run an immediate first round over the full side-thread history → leave a breadcrumb reply in the origin thread.
- **Two main surfaces**: the admin-configured investigations channel (requires setup), or a DM with the requester (always available, reuses the shipped DM-delivery plumbing). DM continuation defaults to following the origin thread in `follow` mode.
- **Two follow modes per followed thread**: `followAndInteract` (each new side-thread message runs the pre-analysis classifier keyed to the investigation subject; a "respond" verdict drives an investigation round that injects the delta) and `follow` (purely piggyback: pending counts accumulate and are injected the next time the main session runs for another reason).
- **Events-driven, no polling**: new-message events in followed channels hit an O(1) `(channel, threadTs)` index. A per-thread `lastInjectedTs` cursor plus drain-on-round makes downtime lossless (content delayed, never skipped); a boot reconciliation pass re-fires pending threads.
- **Config-gated like auto-respond**: a top-level `config.investigations` block (`enabled`, `emoji`) — fail-fast zod, fully inert when disabled (no reaction handler, no tools, no event routing, no manifest scope additions). The investigations **channel lives in Home-Tab-managed state**, not config.
- **Home Tab "Investigations" section** (admin-gated, rendered only when enabled): channel picker writing to state (live, no restart), list of open investigations with Close buttons, and a warning when no channel is set.
- **Owner escalation when unconfigured**: an investigate reaction with no channel set DMs the owner ("someone used investigate mode, but no channel is set up") with a link to the Home Tab section; the conversational path also tells the requester directly.
- **Session tools**: `start_investigation`, `follow_thread`, `unfollow_thread`, `list_followed_threads`, `close_investigation` — available to all roles when the feature is enabled.
- **Guards**: cycle prevention (cannot follow a thread in the investigations channel), dedup by `(channel, threadTs)` (second react links to the existing investigation), bot-message filtering (Clack's own posts never count as deltas), and full coexistence with auto-respond in followed threads (independent paths, no suppression).

## Capabilities

### New Capabilities

- `split-investigations`: the split primitive — bootstrap (all three entry points), main surfaces, followed-thread state and cursors, follow modes, event routing, guards, owner escalation, and the investigation lifecycle tools.

### Modified Capabilities

- `session-management`: sessions gain a `followedThreads[]` array (channel, threadTs, mode, `lastInjectedTs`, pending count) persisted in `context.json`; delta injection composes with `sdkSessionId` resume.
- `slack-message-trigger`: the message-event pipeline gains a followed-thread routing step — before normal auto-respond resolution, events matching the investigations index are dispatched to the follow pipeline (in addition to, not instead of, existing handling).
- `manifest-generation`: conditional scopes when `investigations.enabled` (channel-join for public side channels; membership-dependent message events), following the `allowPublicSearch` conditional-scope pattern.
- `home-tab`: new admin-gated "Investigations" section (channel picker, open-investigations list with Close, unconfigured warning), rendered only when the feature is enabled.
- `delivery-context`: new delivery-context descriptions for investigation-channel and DM-surface sessions so Claude knows where it is writing and which actions apply.

## Impact

- **Config**: new top-level `investigations` block in `data/config.json` (fail-fast zod in `config.ts`/`configSchemas.ts`); enabling requires manifest re-upload + app reinstall (conditional scopes), same operator note as `allowPublicSearch`.
- **State**: new `data/state/investigations.json` (graceful zod) holding the configured channel and the open-investigations index keyed `(channel, threadTs)`.
- **Sessions**: `SessionContext` gains `followedThreads[]`; existing sessions unaffected (absent field = no follows).
- **Slack layer**: new reaction handler (investigate emoji), followed-thread event routing in the message pipeline, Home Tab section + modal/action handlers, breadcrumb posting.
- **Claude layer**: new pre-analysis classifier variant keyed to the investigation subject (reuses `runPreAnalysis` scaffolding, Sonnet, `maxTurns: 1`); investigation-round prompt assembly injecting side-thread deltas.
- **Tools**: five new MCP tools registered in query mode when enabled.
- **i18n**: new keys in `en.ts`/`fr.ts` for breadcrumbs, Home Tab section, owner DM, and ephemeral notices.
