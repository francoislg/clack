## Context

DM handling was originally event-based (`app.event("message")` filtered on `channel_type === "im"`), with `directMessage.ts` covering new DMs and `threadReply.ts` covering follow-ups. Commit `49d7237` ("Slack Assistant API, unified response delivery, streaming UX improvements") replaced both with a single Bolt `Assistant` instance, adding `assistant:write` scope, `assistant_thread_*` events, and the `assistant_view` manifest feature.

The Assistant API gives us the side-panel UX, channel-context awareness (`assistantChannelId`), `setStatus("Thinking…")`, `setTitle`, and suggested prompts. Some operators don't want that surface — they want plain DMs in the Messages tab. The Assistant-mode default is fine; we just need an opt-in classic mode.

The pre-`49d7237` handlers are recoverable from git but don't need a verbatim restoration — `processMessage` already absorbs all the shared work (sessions, streaming, tools, delivery, auto-respond gating, stop reactions). What's left is a thin event listener.

## Goals / Non-Goals

**Goals:**
- Operators can opt into classic DMs via a single config flag (`directMessages.dmType: "classic"`) without losing the assistant-mode default.
- The classic handler is minimal — a single Bolt listener that filters and forwards to `processMessage`. No duplicated session/streaming/delivery logic.
- The manifest emits only the scopes/events needed for the chosen mode, so an operator who picks classic doesn't have to approve `assistant:write`.
- Assistant-mode behavior is unchanged at the byte level when `dmType` is absent or `"assistant"`.

**Non-Goals:**
- Hot-swapping `dmType` at runtime. Switching modes requires a restart **and** a manifest re-upload (different bot events subscribed). Documented, not implemented.
- Bringing back `processDmRefinement` (deleted in `49d7237`). Reaction-originated DM threads continue to work through the normal session-by-thread lookup inside `processMessage`.
- Channel-context features in classic mode (`assistantChannelId`, "I'm viewing channel X" awareness). Classic users lose this; it's the cost of the simpler manifest.
- A "Send to thread" affordance in classic mode that targets the channel the user was viewing (no Assistant context to read from).

## Decisions

### Boot-time registration, not invocation-time gating

**Decision:** branch the registration in `app.ts`: assistant mode calls `registerAssistant(app)`, classic mode calls `registerClassicDmHandlers(app)`. The two are mutually exclusive at registration.

**Why:** the rest of the codebase uses the pattern "always register, check `enabled` at invocation" so soft-restart toggles work without socket reconnection. That pattern works for an on/off flag but NOT for `dmType`: both `app.assistant(...)` and `app.event("message")` would receive the same DM event, and both would call `processMessage`, double-processing every DM. The cleanest fix is to register only the mode the operator picked.

**Alternative considered:** keep both registrations and have each handler bail when `dmType` doesn't match. Rejected — it leaks "the other mode exists" knowledge into both handlers and adds a guard everyone has to remember to write. A boot-time branch is one if-statement in `app.ts`.

**Consequence:** flipping `dmType` requires a restart. The operator already has to regenerate + re-upload the manifest (different events), so a restart is in the same operational ceremony.

### One listener handles both new DMs and thread replies

**Decision:** `classicDm.ts` registers a single `app.event("message")` listener. New DMs (no `thread_ts`) and thread replies (`thread_ts` present and != `ts`) flow through the same code path.

**Why:** the old code split these into `directMessage.ts` and `threadReply.ts`, which duplicated ~80% of the type-guard and filter logic. The only material difference is what gets passed as `threadTs` to `processMessage` — and `processMessage` already handles "new session" vs "continue existing session" via its own threadTs lookup. No reason to split.

**Alternative considered:** restoring the two-file structure from git for fidelity with the old code. Rejected — fidelity to deleted code isn't a goal, and the split was never structurally meaningful.

### Mute Slack's own `subtype: "message_changed"` and bot self-messages

**Decision:** filter at the top of the listener — skip any event with `bot_id`, any `subtype`, or where `channel_type !== "im"`.

**Why:** edits and bot self-messages arrive on the same `message` event. Bolt's Assistant API filters these for us; classic doesn't get that filter for free. The existing `messageChanged` handler covers edit-cancellation logic for all triggers, so the classic handler must NOT also fire on `message_changed` events.

### Inline stop emoji parity

**Decision:** classic listener calls `matchesInlineStopEmoji` + `stopThread`, identical to the assistant handler.

**Why:** stop-reaction support is a cross-trigger feature documented in `CLAUDE.md` ("reacting with the configured emoji on any message in a thread, OR typing it inline in a short message"). Classic mode would silently drop the inline form without this check.

### Manifest branches on `dmType`, not on a separate flag

**Decision:** in `scripts/generate-manifest.ts`, derive `dmType` from `config.directMessages.dmType ?? "assistant"`. Branch scope/event/feature emission on the resolved value, with `directMessages.enabled` still gating the outer block.

**Why:** keeps `directMessages` as the single source of truth for DM-related manifest emission. No second flag, no risk of `dmType === "classic"` getting paired with `enabled: false` ambiguity.

### `assistantChannelId` stays optional everywhere

**Decision:** no changes to `processMessage` or downstream consumers. Classic mode passes `assistantChannelId: undefined`, same as mentions and reactions do today.

**Why:** the field is already optional. The audit during implementation should confirm no consumer assumes it's defined.

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Operator flips `dmType` but forgets to re-upload manifest. Bot subscribes to wrong events and DMs silently stop being delivered. | Document the restart + re-upload requirement in `CLAUDE.md` and the manifest script's console output. Optionally: log a warning at boot if the configured `dmType` is `"classic"` but `assistant_thread_started` arrives (signals stale manifest). |
| Existing assistant-mode sessions become "stale" after flipping to classic — `assistantChannelId` still set but never refreshed. | Acceptable. The field is only read by features that classic mode doesn't expose. No data corruption. |
| Reaction-originated DM threads (DM-first delivery) might be mis-routed if the classic listener doesn't recognize them as continuations of an existing session. | Rely on `processMessage`'s existing session-by-thread lookup. No special-case needed — `processDmRefinement` was deleted in `49d7237` and the replacement is the same lookup the classic listener will hit. Verify via test. |
| Double-listener risk if `registerAssistant` and `registerClassicDmHandlers` are both called by accident. | Boot-time branch in `app.ts` is an `if/else`. Test covers both branches. |
| Image-only DMs in classic mode have no `setStatus`-equivalent feedback. | The streamer's placeholder-message pattern already provides "Thinking…" feedback for mentions and reactions; same affordance covers classic DMs. No new work needed. |

## Migration Plan

1. **Default unchanged.** New `dmType` is optional and defaults to `"assistant"`. Existing installations behave identically with no config edit.
2. **Opt-in path.** Operator sets `directMessages.dmType = "classic"` in `data/config.json`.
3. **Manifest refresh.** Operator runs `npm run manifest` → uploads the resulting `slack-app-manifest.json` to the Slack app config.
4. **Restart.** Operator restarts the bot. `app.ts` branches register the classic handler.
5. **Rollback.** Set `dmType` back to `"assistant"` (or remove the field), regenerate + re-upload manifest, restart. Sessions persisted under either mode remain valid.

## Open Questions

- Should we add a boot-time sanity check that compares the configured `dmType` against the events Slack actually delivers (e.g. log a warning if the bot receives an `assistant_thread_started` event but `dmType` is `"classic"`)? Useful for catching stale-manifest mistakes, but adds a small amount of code for a rare failure mode. Decision: defer; revisit if this footgun shows up in practice.
- Does classic mode need an equivalent of the assistant `threadStarted` greeting? Slack's classic DM flow has no "opened the panel" event — the user just sends a message. Tentative answer: no greeting, the first reply IS the greeting. Confirmed in this design; no work item.
