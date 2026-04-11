## Context

Clack resolves Slack channel identifiers in two distinct situations that are currently tangled and inconsistent:

1. **System-initiated DMs** — internal code paths that need to DM a specific user (cron error notifications, reaction DM delivery, error reports, migration admin alerts, home tab instruction editing). Today, six files independently call `client.conversations.open({ users })` with six different error-handling styles. One of them (`handlers/core.ts:openDmChannel`) is already an abstraction — it just lives in the wrong place.

2. **Tool-facing channel resolution** — Claude passes a channel identifier to a tool (`schedule_reminder`, `create_scheduled_message`), and the tool needs to convert it to a channel ID that the Slack API can post to. Today this lives in `src/tools/helpers.ts:resolveChannelId`, which uses a permissive `looksLikeSlackId` regex that matches both channel IDs (`C…`/`G…`/`D…`) and user IDs (`U…`) and returns them unchanged. The result: a user ID gets stored as a cron job's `channel`, and every tick logs `channel_not_found` when `getChannelInfo` tries to fetch it.

The visible symptom was a production log:

```
[INFO]  Cron job 6db6ddc0-247 executing in U09FSR0REUQ …
[ERROR] Error fetching channel info for U09FSR0REUQ: channel_not_found
```

There is also a latent security question: if the resolver normalizes any `U…` to a DM channel, Claude can schedule or send messages to arbitrary third-party users via tools. A malicious or prompt-injected Claude in a shared channel could DM the CEO "you're fired". Slack's own permissions won't catch this — the bot is authorized to DM anyone. The trust boundary has to live at the tool layer.

## Goals / Non-Goals

**Goals:**
- One canonical place to open a DM channel for a user (`openDmChannel`).
- One canonical place to resolve any channel-like input to a channel ID (`resolveChannelId`).
- Fix the cron-job `U…` storage bug by normalizing user IDs to DM channels during tool-facing resolution.
- Enforce "self-only" DMs at the tool boundary: Claude can only DM the requesting user via tool arguments, not arbitrary third parties.
- Consistent error contract across the scattered `conversations.open` call sites.

**Non-Goals:**
- Unifying channel *name resolution* (display labels) with channel *ID resolution*. `channel-context` handles the former via `getChannelInfo` / `resolveChannelLabel`; those stay where they are and serve different callers.
- A data migration for existing broken cron jobs. The production job that triggered this (one known case) will be fixed manually or deleted. If more cases appear, a boot migration can be added later.
- Locking down D-id inputs. A D-id passed to a tool will still pass through. Slack's membership rules block posting to DMs the bot isn't in, so the only way a D-id leaks to Claude is through its own session history, where the bot was already present. This is acceptable belt-without-suspenders.
- Rethinking the trust model for the six internal `conversations.open` sites. They're system-initiated with hardcoded targets; no Claude discretion is involved.

## Decisions

### Decision 1: Where the module lives

**Choice:** `src/slack/channelResolver.ts` (new file).

**Alternatives considered:**
- Keep in `src/tools/helpers.ts` and just fix the U-id branch. Rejected because the primitive (`openDmChannel`) is useful to non-tool callers (the six system sites), and `src/tools/` should not be imported from `src/slack/handlers/` or `src/migrations/`.
- Put it in `src/slack/messagesApi.ts`. Rejected because `messagesApi.ts` is already large and mixes extraction, rendering, and posting concerns. A focused `channelResolver.ts` is clearer.
- Put the primitive in `src/slack/channelCache.ts`. Rejected because `channelCache.ts` is about caching display info from `conversations.info`, not about opening DMs.

### Decision 2: Split `looksLikeSlackId`

**Choice:** Delete `looksLikeSlackId`. Introduce `isChannelId(input)` (matches `C…`/`G…`/`D…`) and `isUserId(input)` (matches `U…`).

**Rationale:** The name `looksLikeSlackId` and its behavior ("accepts user IDs (U prefix) → true") codify the exact bug: a user ID is not a *channel* ID. The split makes the resolver's branching obvious and the semantics honest.

### Decision 3: `openDmChannel` error contract

**Choice:** `openDmChannel(client, userId): Promise<string | null>`. Returns the `D…` channel ID or `null`. Logs the error internally on failure.

**Alternatives considered:**
- Throw on failure. Rejected — most callers want to log-and-continue (the migration path in `dmAdmin`, the silent failure in `sendDirectMessage`, the fallback in `setupDmDelivery`). Throwing would force every caller to wrap in try/catch, which is what we're trying to eliminate.
- Return a `Result<string, Error>` type. Rejected — over-engineered for internal use; `null` is idiomatic in this codebase.
- Return a boolean. Rejected — callers need the channel ID, not just success.

Callers that want a boolean (`dmAdmin` returns `boolean`) convert trivially (`const channelId = await openDmChannel(...); if (!channelId) return false;`).

### Decision 4: `resolveChannelId` signature and trust check

**Choice:** `resolveChannelId(ctx, input)` where `ctx` provides at least `{ client, userId }`. When `input` is a user ID, the resolver enforces `input === ctx.userId` and returns an error result otherwise.

**Alternatives considered:**
- `resolveChannelId(client, input, requesterUserId)` — three positional args. Rejected — ctx is already available at tool call sites (`QueryToolContext`), and passing an object is clearer.
- Accept any U-id, rely on Slack permissions. Rejected — see the security rationale in Context. Slack will happily DM anyone the bot has access to.
- Accept a U-id but require an explicit `allowThirdPartyDm: true` flag. Rejected — adds API surface for a case we don't want to support at all.

The self-only rule is enforced even when the requester's U-id looks "safe" — no special cases. Future work could relax this if we ever add a use case like "DM the on-call engineer" (which would need its own explicit authorization path anyway).

### Decision 5: Tool description updates

**Choice:** Both `schedule_reminder` and `create_scheduled_message` explicitly document in their tool description that user IDs are only accepted when they match the requesting user (i.e., "for DMing yourself"). `create_scheduled_message`'s description is updated from "Channel name or channel ID" to include the self-DM case.

**Rationale:** Claude needs to know this to pick the right argument. Today `schedule_reminder` documents it but doesn't enforce it; `create_scheduled_message` enforces the old broken behavior and doesn't document it. After the change, both documented AND enforced identically.

### Decision 6: Return shape of `resolveChannelId`

**Choice:** Keep the existing discriminated union: `{ ok: true; channelId: string } | { ok: false; error: string }`. Tool call sites already expect this shape.

### Decision 7: No runtime migration

**Choice:** Don't add a boot migration to fix existing cron jobs with `U…` in the `channel` field.

**Rationale:** Exactly one such job is known to exist (the one that triggered this investigation). It will be fixed or deleted manually. Adding a migration for n=1 is overkill; if more cases appear, we'll add one then.

## Risks / Trade-offs

- **[Risk]** D-ids still pass through unchecked. If Claude obtains a D-id for a third-party DM (e.g., from persisted session history), it could technically pass it. → **Mitigation:** Slack's membership model blocks posting to DMs the bot isn't in, so this is a theoretical leak, not an exploitable one. Documented in Non-Goals.

- **[Risk]** The self-only rule is stricter than `schedule_reminder` currently documents (which accepts any U-id). → **Mitigation:** Update the tool description and any integration tests. This is a desired tightening, not a regression — no known caller depends on third-party DM scheduling.

- **[Risk]** Six file migrations touch unrelated modules; a mistake could break reactions, error reports, or migrations. → **Mitigation:** Each migration is a trivial replacement (import + call). Tests for `handlers/core.ts:setupDmDelivery` and `messagesApi.ts:sendErrorReport` already exist and will catch regressions. Add a test for `channelResolver` itself covering all four input shapes.

- **[Trade-off]** Adding `ctx` to the `resolveChannelId` signature changes its shape. The two tool callers need updating. Minor churn; worth it for the trust boundary.

- **[Trade-off]** `looksLikeSlackId` is removed even though a third party could have been importing it. The only importers are in this repo (`helpers.test.ts` and `helpers.ts`), so we can delete it outright.

## Migration Plan

1. Create `src/slack/channelResolver.ts` with `openDmChannel`, `isChannelId`, `isUserId`, and `resolveChannelId`. Write tests covering all branches including the self-only rule.
2. Update `src/tools/actions/scheduleReminder.ts` and `src/tools/actions/createScheduledMessage.ts` to import from the new module and pass `ctx`. Update their tool descriptions.
3. Migrate the six `conversations.open({ users })` call sites one at a time to `openDmChannel`. Delete the local `openDmChannel` in `src/slack/handlers/core.ts`.
4. Delete `resolveChannelId` and `looksLikeSlackId` from `src/tools/helpers.ts`. Move/drop the corresponding tests.
5. Manually clean up the broken cron job in production (or delete and recreate).
6. Type-check (`npx tsc`) and run the full test suite.

Rollback: revert the commit. No data format changes, no external API changes.

## Open Questions

None. All design questions were resolved during exploration.
