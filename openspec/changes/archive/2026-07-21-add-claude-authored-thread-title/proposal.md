## Why

Agent DM threads (`dmType: "agent"`) get a side-panel title, but it currently echoes the user's opening message text verbatim (the `migrate-to-agent-messaging` fallback). That reads as mechanical — it's the user's own words, not a description of the conversation. We want the thread to be **named** ("Bolt 5 upgrade questions"), not mirrored ("hey can you help me figure out why...").

The Claude Agent SDK does auto-generate a topic title (`SDKSessionInfo.summary` → `aiTitle`), but it is the wrong tool here: it is **not** carried on the result message (it needs a separate `getSessionInfo` read), its headless generation is **unverified** (it likely collapses to `firstPrompt` = the first user message in Clack's print/streaming mode), and even when it fires it is **async/deferred**, so a read right after the opening turn — when we set the title once — can come back empty or stale. See `design.md` for the full comparison.

The reliable way to get a genuine Claude-authored label is to let Claude emit it **in-band**, in the run it is already doing, via an optional `submit_response` field. It is deterministic, synchronous, needs no second I/O call, and depends on no interactive-CLI subsystem.

## What Changes

- Add an optional `thread_title` field to the `submit_response` tool schema, **gated to the `directMessages` trigger** (hidden from reactions, @mentions, cron, and worker contexts, where a persistent DM thread title has no meaning).
- Carry `thread_title` on the existing `SubmitResponsePayload` so it flows out of `processMessage` on `ClaudeResponse.response` — no new result-threading.
- In the agent DM turn-end hook, prefer Claude's `thread_title` when present; otherwise fall back to the existing first-message text. The title is still set **once, on the opening turn** of a thread (no churn on follow-ups).
- Add one line of prompt guidance so Claude knows the field is an optional short conversation label, written in the configured language (it stays on the via-Claude path — NOT routed through `t()`).
- The field stays best-effort throughout: a missing value degrades to the fallback; the `setTitle` call already swallows failures.

**Depends on:** the agent DM status/title machinery from `migrate-to-agent-messaging` (the `DmTurnHooks` seam on `handleClassicDmEvent` and `agentTurnHooks`). This change upgrades the title's *source*; it does not introduce the hook.

## Impact

- Affected specs: `submit-response` (new gated field), `agent-messaging` (title source precedence).
- Affected code: `src/tools/presentation/submitResponse.ts` (schema field + args + payload passthrough + `allowThreadTitle` dep flag), the submit_response tool-context builder (set the flag from trigger), `src/tools/types.ts` (`SubmitResponsePayload.thread_title`), `src/slack/handlers/classicDm.ts` (capture result, thread the title into `onTurnEnd`), `src/slack/handlers/agent.ts` (prefer Claude title), prompt guidance.
- No config, no manifest, no new scope. Non-DM triggers are byte-for-byte unchanged (the field is not in their schema). Assistant mode (`dmType: "assistant"`) is out of scope — it keeps its current message-text title.
