## Context

Clack's `dmType: "assistant"` DM experience is built on Bolt's `Assistant` class (`src/slack/handlers/assistant.ts`, wired at `app.assistant(...)`). That class:

- routes user turns through `isAssistantMessage`, which **requires `thread_ts` + `channel_type === 'im'`** — verified in `node_modules/@slack/bolt/dist/Assistant.js`;
- binds `threadStarted` strictly to `assistant_thread_started` and `threadContextChanged` to `assistant_thread_context_changed`.

The Agent messaging experience (`agent_view`) changes the wire contract: `app_home_opened` (tab `"messages"`) signals DM-open instead of `assistant_thread_started`; user turns arrive as `message` (`.im`) with **`thread_ts` optional**; suggested prompts move to the top of the Messages tab. Node support requires **Bolt for JS v5**, which bundles **`@slack/web-api` ^8** and **Express 5** (spike 0.1). Clack is on Bolt 4.6.0 / web-api 7.14.1.

Bolt 5's agent guidance uses **plain event listeners** (`app_home_opened`, `app.message()`, `app.event('app_mention')`, `sayStream`) rather than a new `app.agent()` construct — the `Assistant` class survives only as a side-panel helper. Clack already has a raw-`message.im` DM path (`classicDm.ts`) that is view-agnostic, so the agent DM handler is closer to that shape than to the current Assistant-middleware handler.

## Goals / Non-Goals

**Goals:**
- Restore working DMs under `agent_view` on a supported stack (Bolt 5, web-api ≥7.18).
- Keep `@mention` and channel behavior unchanged.
- Preserve the DM feature set that survives the switch: greeting, suggested prompts (relocated), live status, thread title, channel-context awareness.
- Keep `dmType: "classic"` as a working, view-agnostic fallback throughout.

**Non-Goals:**
- Reworking reactions, the Changes Workflow, cron, or plugins beyond what Bolt 4→5 mechanically forces.
- Removing or rewriting `dmType: "assistant"` — it stays as-is for workspaces not yet migrated (contingent on Bolt 5 retaining the `Assistant` class, spike 0.2); `"agent"` is additive.
- Redesigning the session model beyond making DM continuity well-defined without `thread_ts`.
- Adopting Bolt 5's `sayStream` — Clack has its own streamer (`src/streaming/`); evaluating `sayStream` as a replacement is a separate future change.

## Decisions

### Sequence: dependency upgrade first, agent adoption second

Two phases in one change, gated so we never sit on a broken tree:
1. **Bolt 4→5 + web-api ≥7.18 upgrade** — absorb breaking changes across all ~49 Slack-layer files, keep `assistant_view` behavior byte-compatible, get green (`tsc` + full suite) BEFORE touching agent semantics. This isolates "the upgrade broke X" from "the agent rewrite changed Y."
2. **agent_view adoption** — manifest + DM handler rewrite + session continuity, on the now-Bolt-5 base.

### A third `dmType: "agent"`, not a rewrite of `"assistant"`

Rather than convert `dmType: "assistant"` to emit agent_view, add a **third sibling mode** `"agent"` — mirroring exactly how `"classic"` already sits beside `"assistant"`. `VALID_DM_TYPES` grows to `["assistant", "classic", "agent"]`; `app.ts` routes on it (`classic → registerClassicDmHandlers`, `agent → registerAgent`, else `registerAssistant`).

**Why additive beats replace:**
- The working `assistant.ts` (assistant_view + Bolt `Assistant` class) is left byte-for-byte intact — zero regression risk to the current experience, and it still serves workspaces not yet migrated. Bolt 5 keeps the `Assistant` class, so this mode keeps compiling and running.
- The three modes are already mutually exclusive per deployment, selected by one config knob with a documented restart+reinstall cost. A third is a pure extension of that pattern, not a new concept.
- Rollback is trivial: flip `dmType` back to `"assistant"` or `"classic"` — no code revert.

### New `agent.ts` handler on Bolt 5's agent events

`registerAgent` (new file, sibling to `assistant.ts`/`classicDm.ts`) registers:
- `app_home_opened` with `event.tab === "messages"` → greeting + suggested prompts + context seed (agent equivalent of `threadStarted`);
- `app.message()` (im) → the user turn, reading `thread_ts` when present and resolving the agent thread root when absent;
- status/title/prompts via `client.assistant.threads.*` (retained under `assistant:write`).

The `classicDm.ts` normalization (`toClassicDmMessage`, bot-self-filter, inline-stop) is extracted into a **shared helper** consumed by both `classicDm.ts` and `agent.ts` rather than duplicated. The `Assistant` class is deliberately NOT used here: its `isAssistantMessage` gate drops `thread_ts`-less agent messages and its `threadStarted` binding is dead under agent_view.

### Manifest: a new `"agent"` branch

`getEnabledFeatures`/`buildScopes`/`buildEvents`/`generateManifest` gain an `"agent"` case: emit `agent_view` + `agent_description`, subscribe `app_home_opened` (already core) + `message.im`, keep `assistant:write`, and omit `assistant_thread_started` + `assistant_thread_context_changed`. The `"assistant"` and `"classic"` branches are untouched. The `DmType` union in the generator grows to include `"agent"`.

### DM continuity when `thread_ts` is absent

Clack keys sessions by `(channel, thread_ts)`. Under agent_view a first DM turn may lack `thread_ts`. Decision: **key the DM session by a resolved thread root** — the *principle* is fixed here, the *mechanism* is not: whether the root comes from a `setStatus`-opened thread, the post response, or defaults to the message's own ts is exactly what spike 0.3 determines ("setStatus automatically opens threads" per the changelog, but where the root ts surfaces is unverified). The guaranteed floor is the classic path's existing fallback — root = the message's own ts — which is always available. No session-schema change; only the resolution of "what is this DM's thread root" is generalized, and the spike picks the mechanism before 4.4 is written.

### Opportunistic: typed `assistant.search.context`

web-api ≥7.18 is **expected** to expose `client.assistant.search.context` as a typed method (absent at 7.14.1; inferred from the changelog's version requirement, not yet verified — check at the phase-0.1 spike). If typed: replace the `apiCall("assistant.search.context", …)` workaround in `searchMessages.ts` with the typed call and drop the local response interface where the SDK now types it. If still untyped: keep `apiCall` and drop this task — it is behavior-neutral either way.

## Risks / Trade-offs

- **Bolt 4→5 is a major upgrade across ~49 Slack files**, but spike 0.1 shows the real break surface is small once web-api is unified on ^8 (ActionHandler `payload`, ChatStreamer type). The residual risk is runtime behavior the typecheck can't catch (Express 5 receiver, middleware ordering). Mitigation: phase 1 upgrades with `assistant_view` behavior held constant and the full suite as the gate before any agent work.
- **The agent_view switch is irreversible** → once the workspace app is committed to `agent_view`, `dmType: "assistant"` (which needs an assistant_view app) is no longer selectable *for that workspace*. Mitigation: `dmType: "classic"` runs off raw `message.im` and works fine on an agent_view app, so it is the in-workspace fallback if the `"agent"` handler slips (flip the config knob — no code revert, no view change). `"assistant"` remains available for other, un-migrated workspaces.
- **DMs are likely broken on the deployed bot right now** (Bolt 4.6 dropping agent-view messages if the app is already committed). Mitigation: ship the classic fallback as an immediate stopgap ahead of the full migration if confirmed.
- **`assistant_thread_context_changed` may have no agent-view equivalent** → the "which channel is the user viewing" awareness (`assistantCurrentChannelId`) could lose its update signal. Mitigation: treat channel-context as best-effort; degrade gracefully if the event is gone (spike confirms).
- **web-api bump could ripple** into the 12 files using it (GitHub MCP, streaming, etc.) — minor version, low risk, but audited.

## Migration Plan

1. Land phase 1 (deps + Bolt 5 compatibility, `assistant_view` behavior unchanged), full suite green.
2. Land phase 2 (agent_view manifest + handler + continuity), full suite green.
3. Regenerate manifest → re-upload → **reinstall** (irreversible agent_view commit) → hard-refresh Slack.
4. Validate: DM open (greeting + prompts), DM Q&A turn, @mention, reaction, side-panel status/title.
Rollback within the app is impossible; the escape hatch is `dmType: "classic"`.

## Resolved (spike 0.1 / 0.2)

- **Version pairing:** Bolt 5 requires web-api **^8** + Express 5, not web-api ^7.18. Pinning ^7 alongside Bolt 5 produces ~130 phantom dual-WebClient errors.
- **True break surface** (after unifying on web-api ^8): `ActionHandler` args now require `payload` (1 site — trivia click handler) + a `ChatStreamer` private-field type artifact. Small.
- **`Assistant` class survives** Bolt 5 unchanged; `assistant.ts` compiles clean → `dmType: "assistant"` is unaffected.
- **No `app.agent()` / `sayStream` on `App`** — agent messaging is plain event listeners, confirming the `agent.ts` design.
- **web-api 7.19 does NOT type `assistant.search.context`** — task 5 stays contingent on a re-check under web-api ^8.

## Open Questions

- **Does `assistant_thread_context_changed` survive under agent_view?** If not, how is the user's current channel surfaced (or is it dropped)? Needs a LIVE agent_view app (spike ran offline).
- **Thread root resolution without `thread_ts`** — confirm empirically where the agent thread root comes from on the first turn (status-open response vs. a synthesized root), so DM continuity is deterministic.
- **Suggested-prompts relocation** — behavior/placement differences now that prompts sit atop the Messages tab rather than in-thread.
- **Is the workspace app already irreversibly on `agent_view`?** Determines whether the classic stopgap ships first.
