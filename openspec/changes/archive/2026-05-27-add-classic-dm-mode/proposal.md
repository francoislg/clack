## Why

Today, enabling `directMessages` forces the Slack Agents & Assistants API (side-panel "AI Apps" view, `assistant:write` scope, `assistant_thread_*` events). Some operators want plain DMs in the Messages tab instead — fewer scopes to approve, no dependency on the Assistant API surface, and a more familiar "chat with the bot" UX. The classic event-based DM handling existed before the Assistant migration (commit `49d7237`) and can be reintroduced as an opt-in mode without disturbing the assistant-mode default.

## What Changes

- Add `directMessages.dmType?: "assistant" | "classic"` config field, defaulting to `"assistant"` for back-compat.
- When `dmType === "classic"`:
  - Register a single `app.event("message")` listener that handles both new DMs (no `thread_ts`) and DM thread replies, filtering by `channel_type === "im"`, no `bot_id`, no `subtype`.
  - Route every classic DM through the existing `processMessage(...)` pipeline (`triggerType: "directMessages"`) — session continuation, streaming, tools, delivery all unchanged.
  - Honor the inline stop-emoji check (parity with assistant mode).
  - Skip Assistant-only affordances: no `setStatus`/`setTitle`, no suggested prompts, no greeting on thread-open, no `assistantChannelId` context.
- Manifest generator branches on `dmType`:
  - Always emits `im:history`, `im:read`, `mpim:history`, `mpim:read`, `message.im` when DMs are enabled.
  - Only emits `assistant:write`, `assistant_thread_started`, `assistant_thread_context_changed`, and the `assistant_view` feature when `dmType === "assistant"`.
- `app.ts` branches registration at boot: assistant mode calls `registerAssistant`; classic mode calls `registerClassicDmHandlers`. They are mutually exclusive (both listening would double-process DMs).
- Switching `dmType` requires a full restart **and** a manifest re-upload (different bot events subscribed).

## Capabilities

### New Capabilities
- `slack-classic-dm`: opt-in DM mode that uses the low-level `message.im` event instead of the Agents & Assistants API. Defines the listener filter rules, the relationship with `processMessage`, and the absence of assistant-only affordances.

### Modified Capabilities
- `manifest-generation`: scope/event/feature emission becomes conditional on `directMessages.dmType` (not just on `directMessages.enabled`).
- `slack-message-trigger`: the existing requirements describe assistant-API DM handling; they need to be qualified as applying when `dmType === "assistant"`, with classic-mode behavior delegated to the new `slack-classic-dm` capability.
- `slack-assistant`: the registration requirement becomes conditional on `dmType === "assistant"` (currently it's gated only on `directMessages.enabled`).

## Impact

- **Code**: `src/config.ts` (schema + parser, ~5 lines), `scripts/generate-manifest.ts` (branch on `dmType`, ~10 lines), `src/slack/app.ts` (registration branch, ~5 lines), new `src/slack/handlers/classicDm.ts` (~40 lines + tests).
- **No changes** to `processMessage`, sessions, streaming, tools, or delivery — classic mode reuses the existing pipeline end-to-end.
- **Operational**: operators flipping `dmType` must restart the bot AND regenerate + re-upload the manifest. Document this in `CLAUDE.md`'s trigger-modes section.
- **Existing sessions**: assistant-mode sessions in `data/sessions/` carry `assistantChannelId`; after flipping to classic, follow-ups in those threads continue without channel-context refresh. Acceptable — context is only used for cross-channel features that classic mode doesn't expose.
- **Test surface**: one new handler file with its own test, plus manifest-generator test coverage for the new branch.
