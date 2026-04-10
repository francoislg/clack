## Context

Clack persists Q&A sessions to `data/sessions/{sessionId}/context.json`. Each file contains the original question, user follow-ups (refinements), Clack's last answer, channel info, and trigger type. Crucially, `threadContext` (full Slack thread messages) is stripped before persistence — only Clack-owned content survives to disk.

There is currently no tool that lets Claude read this history. When a user DMs Clack referencing something from a past interaction, Clack responds with no context.

## Goals / Non-Goals

**Goals:**
- Let Claude search its own session history to recover missing context
- Filter by channel visibility and type
- Support keyword search across question, refinements, and Clack's answer
- Support pagination via offset

**Non-Goals:**
- Surfacing other users' DM sessions (privacy boundary)
- Searching private channels
- Reconstructing the full thread context (not persisted)
- Real-time indexing or full-text search infrastructure

## Decisions

### Keyword matching: in-process string search
Read session files from disk, match keywords against `originalQuestion + refinements + lastAnswer` using case-insensitive substring search. No external index.

**Why not an index?** Session count is bounded (sessions expire), and this is a low-frequency tool call. Simple file scan is fast enough and adds no infrastructure.

### Privacy model: public channels + requesting user's own DMs
A session is visible if:
- `channelId` starts with `C` (Slack public channel), OR
- `userId` matches the requesting user's `userId` (their own DMs regardless of channel type)

Private channels (`G`-prefixed) are excluded even if the calling user is a member — too hard to verify membership without a Slack API call, and the conservative default is correct.

**Alternative considered:** Check channel membership via Slack API. Rejected — adds latency and complexity for an edge case.

### Return full session objects, always
Keyword filtering determines *which* sessions are returned, but each result contains the full session summary. Claude needs full context to reason about relevance — snippets lose meaning.

### Sorting: recency first
Sessions sorted by `createdAt` descending before keyword filtering and limit/offset are applied. This matches the most common use case (what did I just send?).

### `type` parameter
- `all` (default): public channels + user's own DMs
- `public_channels`: public channels only
- `dm`: user's own DMs only

Filtering happens after privacy enforcement — `type` only narrows within already-visible sessions.

## Risks / Trade-offs

**[Risk] Disk scan latency with many sessions** → Sessions are small JSON files; Node.js `readdir` + parallel reads are fast. If session count grows very large, a future index can be added without changing the tool interface.

**[Risk] `threadContext` not persisted** → Keyword search cannot match intermediate thread messages from other users. Mitigation: `originalQuestion`, `refinements`, and `lastAnswer` cover both sides of Clack's view of the conversation, which is sufficient for the primary use case.

**[Risk] Over-reliance on the tool** → If the system prompt is too aggressive, Clack may call this on every DM adding latency. Mitigation: the prompt instruction should scope this to explicit "you sent" references or genuine confusion, not routine queries.

