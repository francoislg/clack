## Why

Slack is deprecating the **Assistant messaging experience** (`assistant_view`) in favor of the **Agent messaging experience** (`agent_view`). New apps can only use Agent; existing Assistant apps continue "temporarily." The switch is **irreversible** once an app's manifest moves to `agent_view`, and the operator has already flipped this app's "agent type" — so the workspace app is (or is about to be) committed to `agent_view`.

Clack's DM assistant UX cannot serve `agent_view` on its current stack:

- **Bolt for JS 4.6.0 has zero agent awareness.** Its `Assistant` class routes user messages through `isAssistantMessage`, which **requires `thread_ts`** on the payload and binds thread-start strictly to `assistant_thread_started`. Under `agent_view`, `thread_ts` is no longer sent and `assistant_thread_started` is replaced by `app_home_opened` (tab `"messages"`). Result: agent-view DM messages get filtered out — `userMessage` never fires — so **DMs in assistant mode break**.
- The Agent experience for Node requires **Bolt for JS v5** (released 2026-07-15), which bundles **`@slack/web-api` ^8** and **Express 5** (spike 0.1 — pinning web-api ^7 alongside Bolt 5 splits the WebClient type into ~130 phantom errors). Clack pins `@slack/bolt ^4.1.0` (4.6.0 resolved), `@slack/web-api ^7.14.1`, `@slack/types ^2.21.1`.

This is a **major dependency upgrade**, not a manifest tweak: 49 source files import `@slack/bolt` and 12 import `@slack/web-api`.

## What Changes

- **Add a third DM mode `dmType: "agent"`** alongside the existing `"assistant"` and `"classic"` — a new sibling, not a rewrite. `VALID_DM_TYPES` grows to `["assistant", "classic", "agent"]`; `src/slack/app.ts` routes to a new `registerAgent` handler when `dmType === "agent"`. The existing `assistant.ts` (assistant_view) and `classicDm.ts` (raw `message.im`) handlers are left untouched, mirroring the current `classic`/`assistant` split.
- **New `src/slack/handlers/agent.ts` handler** on Bolt 5's agent event model: `app_home_opened` (tab `"messages"`) for DM-open/greeting + suggested prompts, plain `message` (`.im`) events for user turns with **`thread_ts` optional**, and the `assistant.threads.*` API (setStatus/setTitle/setSuggestedPrompts) for the side panel. `app_mention` and reactions are shared and unchanged.
- **Upgrade `@slack/bolt` 4.x → 5.x**, **`@slack/web-api` 7.14 → ^8**, **`@slack/types` → ^3** (Express 5 comes transitively) — a hard prerequisite: agent_view needs Bolt 5. The real break surface after unifying on web-api ^8 is small (spike 0.1): an `ActionHandler` `payload`-required change + a `ChatStreamer` type artifact. `dmType: "assistant"` keeps working — **spike 0.2 confirmed the `Assistant` class survives and `assistant.ts` compiles clean under Bolt 5**.
- **Manifest generator gains an `"agent"` branch**: for `dmType: "agent"` emit `agent_view` + `agent_description`, subscribe `app_home_opened` + `message.im`, keep the `assistant:write` scope, and do NOT subscribe `assistant_thread_started` / `assistant_thread_context_changed`. The `"assistant"` and `"classic"` branches are unchanged.
- **Preserve DM continuity under thread_ts-optional delivery** — the agent handler keys the session to the resolved agent thread root when `thread_ts` is absent (the classic path's "root = own ts" fallback generalizes); no `SessionContext` schema change.
- **Opportunistic cleanup:** with web-api ≥ 7.18, `assistant.search.context` becomes a typed client method — replace the `apiCall("assistant.search.context", …)` workaround in the just-shipped `search_messages` tool with the typed call.

## Capabilities

### New Capabilities
- `agent-messaging`: the `dmType: "agent"` experience — DM-open detection via `app_home_opened` (tab `"messages"`), user turns received as `message.im` with `thread_ts` optional, side-panel status/title/suggested-prompts via the `assistant.threads.*` API, and DM-session continuity when `thread_ts` is absent. A third sibling to `"assistant"` and `"classic"`.

### Modified Capabilities
- `manifest-generation`: a new `dmType: "agent"` branch emits `agent_view`/`agent_description` + `app_home_opened`/`message.im`/`assistant:write` and omits the assistant thread events. The existing `"assistant"` and `"classic"` branches are byte-for-byte unchanged.

## Impact

- **Dependencies**: `@slack/bolt` 4→5 (major), `@slack/web-api` →^8, `@slack/types` →^3, Express 5 transitively. `package.json` + lockfile.
- **Slack layer (~49 files)**: `src/slack/app.ts`, `src/slack/handlers/*`, `blocks.ts`, `homeTab.ts`, `messagesApi.ts`, streaming, plus every `App["client"]` reference — audited for Bolt 5 breaking changes.
- **New handler**: `src/slack/handlers/agent.ts` (+ its tests); shared DM normalization extracted from `classicDm.ts`.
- **Config**: `VALID_DM_TYPES` in `src/configSchemas.ts` gains `"agent"`; `app.ts` DM routing.
- **Manifest generator**: `scripts/generate-manifest.ts` gains the `"agent"` branch + tests. The `DmType` union grows.
- **Search tool cleanup**: `src/tools/query/searchMessages.ts` typed `assistant.search.context`.
- **Operational**: for the `"agent"` deployment — regenerate + re-upload manifest + reinstall; the workspace-app `agent_view` switch is **irreversible**, and a hard Slack refresh may be needed. `"assistant"` and `"classic"` deployments are unaffected.
- **Docs**: README `dmType` section, `CLAUDE.md` DM-mode notes (now a three-way `assistant`/`classic`/`agent` split).
- **Ordering dependency**: the active `add-public-message-search` change also carries a `manifest-generation` delta and owns `searchMessages.ts` (which task 5 here edits). Its implementation is committed and deployed; **archive it before applying this change** so a single active delta owns the capability and the search tool has a settled baseline.
