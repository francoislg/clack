## Why

In DM, @mention, reaction, and auto-respond turns, Claude's prompt never states **who the current speaker is** — their Slack identity and mapped GitHub username. Identity reaches Claude only as a side effect of `formatSpeaker` on *fetched thread history*, so the person who kicks off a fresh DM/mention (no history yet) is anonymous. First-person questions like "what did I merge yesterday" fail: Claude correctly reports it has no way to tell who "I" is, then blindly trusts whatever name the user types back. The GitHub mapping worker mode already uses (`getUserRecord(userId).github?.username`) is never surfaced on the query path.

## What Changes

- Resolve the **current turn's speaker identity** — Slack display name, `@username`, user ID, and mapped GitHub username — and surface it in the prompt for every human-speaker trigger (all trigger types except `scheduled`: `directMessages`, `mentions`, `reactions`, `autoRespond`, `threadReply`, `channelReply`).
- Identity is resolved **per-turn** (from the current turn's user), NOT from the frozen session creator, so multi-user threads attribute the live speaker rather than whoever started the thread.
- The GitHub username is resolved via the existing `getUserRecord(userId).github?.username` registry lookup — the same source worker mode uses; a null/failed record degrades to no GitHub handle.
- Render identity as an **attribution on the `QUESTION:` line** (symmetric with `formatSpeaker` on history), with graceful degradation when the GitHub mapping is absent (Slack identity still shown; Claude falls back to `find_user`/asking).
- `scheduled` triggers get no requester attribution (no single human speaker).

## Capabilities

### New Capabilities
- `requester-identity`: Surface the current turn's speaker identity (Slack display name / `@username` / user ID / mapped GitHub username) in Claude's prompt for interactive triggers, resolved per-turn and degrading gracefully when the GitHub mapping is unknown.

### Modified Capabilities
<!-- None: delivery-context governs delivery actions/destinations; requester identity is a distinct concern rendered on the QUESTION line, not the delivery-context block. -->

## Impact

- `src/claude/promptBuilder.ts` — the `QUESTION:` line render gains optional speaker attribution driven by a new per-turn `PromptOptions` field; `buildPrompt`/`PromptOptions` type updated.
- `src/slack/handlers/core.ts` (`setupSession`) — resolve the current turn's GitHub username alongside the already-computed `userInfo`, and thread Slack + GitHub identity into `buildPrompt` options per turn (not persisted on the session).
- `src/userRegistry.ts` — reuses existing `getUserRecord`; no changes expected.
- Tests: `src/claude/promptBuilder.test.ts` — attribution present/absent by trigger type and by GitHub-mapping presence.
- No config, schema, or persisted-state changes. No new dependencies.
