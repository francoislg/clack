## Context

`bootstrapInvestigation` (`src/investigations/engine.ts`) calls `ensureChannelMembership` for a channel-surface origin. That function reads `conversations.info`. If the bot is a member, or the origin is a DM or MPIM, it returns true. Otherwise, including when the info call throws, it calls `conversations.join`. When the join fails, the origin is followed in passive `follow` mode, and the 🔍 reaction handler DMs the owner a notice that blames the missing `channels:join` scope.

`follow_thread` checks the requester's access and the cycle guard, but never checks whether Clack is in the channel. A `followAndInteract` thread in a channel Clack isn't in never receives events.

## Goals / Non-Goals

**Goals:**

- No code path calls `conversations.join`, and the manifest doesn't request `channels:join`.
- Starting an investigation, or following a thread, in a channel Clack isn't in is refused, and the user is told why.

**Non-Goals:**

- Inviting Clack on the user's behalf, or prompting an admin to.
- Changing requester-access rules or the drain.

## Decisions

- **One read-only membership check, shared.** Add a small `src/slack/` helper (e.g. `isBotInConversation(client, channel)`). It zod-parses the `is_member` / `is_im` / `is_mpim` fields of `conversations.info` and returns true for a member, DM or MPIM, and false on a thrown error, failed response or malformed shape. The engine and `follow_thread` both use it. `requesterAccess.ts` keeps its own lookup: its `botIsMember` feeds a different, cached verdict, and folding the two together is out of scope.
- **An unconfirmed lookup is a refusal.** Clack only proceeds when it knows it's in the channel. The user sees the same refusal either way, and they can retry.
- **Refuse before any side effect.** The bootstrap first looks for an existing investigation of the origin thread (a read with no side effect), so a duplicate still links to it. Next comes the membership check, ahead of resolving the main surface (so no DM is opened), the cycle and configuration checks, the parent post and session creation. A refused bootstrap leaves nothing behind.
- **Say it on the path that reaches the user.**
  - The reaction is a direct-to-Slack path, so it gets an ephemeral message through `t()`, the same way `cycle` and `duplicate` do.
  - Tool results are via-Claude, so they stay English. Claude re-renders them in the user's language.
- **Drop `degraded` and the owner DM.** There's no partial-success state anymore, and the owner has nothing to fix.

## Risks / Trade-offs

- [Investigations of channels Clack isn't in no longer start at all, not even passively] → That's what the user asked for. The message tells them to invite Clack.
- [A transient `conversations.info` failure refuses a legitimate request] → Retrying works. Proceeding without knowing would break the rule.
- [Existing tokens still have `channels:join`] → Harmless: nothing calls the join, and the scope check ignores extra scopes.
