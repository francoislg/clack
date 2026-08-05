## 1. Prompt builder: QUESTION-line attribution

- [x] 1.1 Add an optional `requester` field to `PromptOptions` in `src/claude/promptBuilder.ts`: `{ userId: string; username?: string; displayName?: string; githubUsername?: string | null }`.
- [x] 1.2 Add a `formatRequester(requester)` helper mirroring `formatSpeaker`'s precedence (displayName+username → displayName → username → ID), appending `, GitHub @<x>` only when `githubUsername` is truthy.
- [x] 1.3 In `buildPrompt`, gate attribution to every human-speaker trigger — render `QUESTION [from <formatRequester>]: ...` when `options.requester` is present and `triggerType !== "scheduled"`; otherwise render the bare `QUESTION:` line (unchanged). The negative check covers `directMessages`, `mentions`, `reactions`, `autoRespond`, `threadReply`, `channelReply` without an allowlist.

## 2. Session setup: per-turn identity resolution

- [x] 2.1 In `setupSession` (`src/slack/handlers/core.ts`), resolve the current turn's GitHub username via `getUserRecord(ctx.userId)`, run concurrently with the existing `getUserInfo` / `getChannelInfo` lookups.
- [x] 2.2 Assemble the `requester` option from the current turn's `userInfo` (username/displayName) + `ctx.userId` + `record?.github?.username ?? null`; do NOT persist it onto the session.
- [x] 2.3 Thread the `requester` option into the `buildPrompt` call for the turn (covering both new and reused sessions).

## 3. Tests

- [x] 3.1 `src/claude/promptBuilder.test.ts`: attribution present on `directMessages`/`mentions`/`reactions`/`autoRespond`/`threadReply`/`channelReply` with full identity (display name, @username, ID, GitHub).
- [x] 3.2 Attribution absent on `scheduled` triggers (bare `QUESTION:` line).
- [x] 3.3 Graceful degradation & precedence: no GitHub mapping → Slack-only attribution, no asserted handle; display-name-only → name + ID (no @username); username-only → @username + ID (no name); both absent → ID-only attribution.
- [x] 3.4 Per-turn correctness: a reused session created by user A, current speaker user B → attribution names user B (assert the option, not the session, drives the render).
- [x] 3.5 Non-persistence: after `setupSession` resolves requester identity for a turn, the session's `userId`/`username`/`displayName` fields are unchanged (assert via mock inspection / before-after comparison — identity flows as a per-turn option, not a session write).

## 4. Verify

- [x] 4.1 `npx tsc --noEmit` clean.
- [x] 4.2 `npx oxlint` + `npx oxfmt --check` clean on touched files.
- [x] 4.3 `npm test` green.
