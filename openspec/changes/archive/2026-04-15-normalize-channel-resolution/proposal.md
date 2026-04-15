## Why

Today, resolving a Slack channel identifier (name, channel ID, or user ID) is duplicated and inconsistent. The tool-facing helper `resolveChannelId` (in `src/tools/helpers.ts`) silently passes user IDs (`U…`) through as if they were channel IDs, which causes `create_scheduled_message` to persist a user ID as a cron job's `channel` field. When the cron fires, `conversations.info` fails with `channel_not_found`, label resolution breaks, and logs fill with errors. Separately, six files independently call `conversations.open({ users })` to DM a user, each with slightly different error handling.

There is also a latent security concern: if `resolveChannelId` normalizes any `U…` to the matching DM channel, Claude could schedule or send messages to arbitrary third-party users via tools. The current helper masks this question by accidentally not normalizing at all.

## What Changes

- Introduce a single shared `src/slack/channelResolver.ts` module that owns both operations:
  - `openDmChannel(client, userId)` — trust-agnostic primitive that opens a DM and returns the `D…` channel ID (or `null` on failure, with logging).
  - `resolveChannelId(ctx, input)` — tool-facing resolver that accepts `#name` / `name` / `C…` / `G…` / `D…` / `U…` and returns a canonical channel ID, enforcing that `U…` inputs must match `ctx.userId` ("you can only DM yourself").
- Split the overloaded `looksLikeSlackId` helper into `isChannelId` (C/G/D) and `isUserId` (U) so the resolver can branch cleanly and the semantics are no longer misleading.
- Migrate all six existing raw `conversations.open({ users })` call sites to the shared `openDmChannel` primitive. Remove the local `openDmChannel` in `src/slack/handlers/core.ts` and use the shared one.
- Update the two tool call sites (`schedule_reminder`, `create_scheduled_message`) to pass `ctx` into the shared `resolveChannelId` and to document in their tool descriptions that user IDs are only accepted for the requesting user (self-DM).
- **BREAKING (internal)**: `src/tools/helpers.ts` no longer exports `resolveChannelId` or `looksLikeSlackId` — callers import from `src/slack/channelResolver.ts`. `textResult` / `errorResult` remain in `helpers.ts`.

## Capabilities

### New Capabilities
- `slack-channel-resolver`: Shared module for resolving any channel-like identifier (name, channel ID, DM ID, user ID) to a canonical Slack channel ID, and for opening DMs with users. Centralizes the U-id → D-id conversion and enforces the "self-only" trust boundary on tool-facing callers.

### Modified Capabilities
- `scheduled-messages`: The `schedule_reminder` tool's channel resolution scenarios change to reflect the new contract — user IDs are accepted only when they match the requesting user, and the resolution is delegated to the shared resolver.
- `cron-messages`: The `create_scheduled_message` tool (implied by the scheduler spec) gains an explicit scenario for user ID input — accepted only when equal to the requester — and the stored `channel` field is guaranteed to be a posting-capable channel ID (never a raw `U…`).

## Impact

- **New file**: `src/slack/channelResolver.ts` + `src/slack/channelResolver.test.ts`
- **Modified**:
  - `src/tools/helpers.ts` — removes `resolveChannelId` and `looksLikeSlackId`; keeps `textResult`/`errorResult`
  - `src/tools/helpers.test.ts` — drop `looksLikeSlackId` tests, move relevant coverage to `channelResolver.test.ts`
  - `src/tools/actions/scheduleReminder.ts` — import from new module, pass `ctx`
  - `src/tools/actions/createScheduledMessage.ts` — same
  - `src/slack/handlers/core.ts` — delete local `openDmChannel`, import from new module
  - `src/slack/handlers/homeTab.ts` — use shared `openDmChannel`
  - `src/slack/messagesApi.ts` — two call sites (`sendDirectMessage`, `sendErrorReport`) migrate
  - `src/migrations/admin.ts` — `dmAdmin` migrates
  - `src/cronScheduler.ts` — `notifyCreatorOfError` migrates
- **No runtime data migration** — the existing cron job with a stored `U…` channel will be fixed by the user manually (or we can add a one-line boot migration if the user prefers).
- **No external API changes** — internal refactor plus a bug fix. Tool input schemas gain a clarified description but accept the same structural inputs.
