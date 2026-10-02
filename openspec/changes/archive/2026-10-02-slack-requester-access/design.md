## Context

Query tools run with the bot token. `QueryToolContext` carries `userId` and `role`, but `fetch_slack_message` and `fetch_channel_messages` call `conversations.history` / `conversations.replies` without consulting either. The only privacy rules in the codebase belong to `find_session_transcript` and `find_recent_interactions`, which allow a non-owner to read a session only when its channel is known to be public. Nothing calls `conversations.members`, and `channelCache` knows only `isPrivate`.

A spike against the live workspace established what `files.info` returns to a bot token, for canvases (`filetype: "quip"`) and lists (`filetype: "list"`) alike:

| Field | Observed |
|---|---|
| `user` | creator id, on both types (`canvas_creator_id` exists on canvases only) |
| `channels` | public channels the file is shared to |
| `groups`, `ims` | private channels and DMs the file is shared to, limited to those the bot is in |
| `dm_mpdm_users_with_file_access` | `{ user_id, access }` entries; held only the creator in every sample |
| `editors` | includes users absent from the per-user access list, so it is not an access list |
| `access` | the bot's own level, `read` or `write` |
| `private_channels_with_file_access_count` | 0 even for files shared to a private channel the bot is in |
| `has_more_shares` | present; truncation behaviour not observed |

The same spike showed `auth.test` returns the token's scopes on `response_metadata.scopes`. Slack has no method that reads a canvas's or list's access list; `canvases.access.*` and `slackLists.access.*` only set and delete.

`validateConfig` needs Slack auth and a `repositories` array, and `npm run manifest` runs during setup before either exists. `scripts/` can import from `src/`, but `src/` (tsconfig `rootDir`) cannot import from `scripts/`.

## Goals / Non-Goals

**Goals:**

- One check, in one module, answering "can this requester see this conversation or file?", reusable by `slack-canvases` and `slack-lists`.
- Close the private-channel read through `fetch_slack_message` and `fetch_channel_messages`.
- Fail closed: an unknown answer is a denial.
- A manifest generator that rejects an invalid config value instead of dropping a feature.
- An owner warning when the installed token lacks a scope the config needs.

**Non-Goals:**

- Changing the "known-public" rule of `find_session_transcript` and `find_recent_interactions`. It guards sessions, not conversations, and is stricter than membership.
- Hiding private channel names returned by `find_channel`.
- Checking who can see Clack's reply. A requester who asks for private content in a public thread discloses it themselves.
- Detecting missing event subscriptions. A bot token cannot list them.
- Detecting a mistyped top-level config key. Only wrong-typed values in known keys are rejected.
- Any canvas or list tool. This change ships the file check with no caller.

## Decisions

### The requester is `QueryToolContext.userId`; a system role means no requester

Every trigger already puts the human behind the run in `ctx.userId`: the message author for DMs, mentions, auto-respond and thread replies, the reacting user for reactions, the job creator for user cron jobs, the investigation requester for investigation rounds. Plugin cron jobs run as a system actor with `role: "system"` and a non-Slack `userId`. The check treats `role === "system"` as "no requester" and allows public channels only.

Alternative considered: check interactive triggers only. Rejected because a scheduled message or an auto-respond rule would then be a way around the check.

### Conversation rule

```
conversation kind        full member          guest / external      no requester
public channel           allow                member only           allow
private channel          member only          member only           deny
group DM (mpim)          member only          member only           deny
DM (im)                  the DM's user only   the DM's user only    deny
unknown / lookup failed  deny                 deny                  deny
```

- Kind and privacy come from a `conversations.info` call made by the access module itself: `is_im` marks a DM (allowed only for its `user`), `is_private === false` marks a public channel, and everything else (private channel, group DM, unknown privacy) takes the membership path. A failed lookup is a denial.
- The module does not use `getChannelInfo`: that cache never expires, so a channel converted from public to private would keep reading as public, and it answers DM ids from their prefix without learning the DM's user. The verdict cache bounds the lookup to one call per `(conversation, requester)` per TTL.
- Membership comes from `conversations.members`, paginated, stopping at the first page that contains the requester.
- A requester is a guest or external when `users.info` reports `is_restricted`, `is_ultra_restricted` or `is_stranger`, or a `team_id` different from the bot's. A failed lookup counts as guest. The bot's team id is added to the `BotIdentity` cached in `src/slack/botIdentity.ts`.

Alternative considered: `users.conversations` with the `user` argument, one call per requester instead of one per channel. Rejected because its handling of private channels for another user's membership is undocumented for bot tokens; `conversations.members` is definitive for one channel.

### No role bypass

Slack membership is the only grant. An owner debugging a private channel joins it. A bypass would make a Clack role a way to read private channels.

### File rule: positive evidence only

`checkFileAccess` takes a file id and calls `files.info` itself, so no caller can hand it a stale or partial file object; a failed lookup or a `not_visible` error is a denial. A file is allowed when any of these holds, checked in this order to avoid further API calls:

1. `file.user` is the requester.
2. `file.dm_mpdm_users_with_file_access` lists the requester.
3. The requester passes the conversation rule for any id in `file.channels`, `file.groups` or `file.ims`.

Otherwise it is denied. `editors`, `org_or_workspace_access` and `private_channels_with_file_access_count` are not evidence. The verdict carries the bot's own `access` level so callers can gate writes.

Because the per-user list held only creators in the spike, a file shared directly with a person and with no channel may be denied to that person. That is the safe direction.

### Verdict cache: in memory, short TTL, never on disk

Verdicts are cached per `(conversation, user)` and requester type per user, in process memory:

- allow: 5 minutes
- deny: 1 minute
- requester type: 1 hour

A cached allow outlives a removal from the channel by at most 5 minutes. Denials expire fast so a user added to a channel is not refused for long. In-flight lookups are deduped the way `userCache` dedupes refreshes.

Alternative considered: persisting verdicts under `data/state/`. Rejected: a stale allow on disk survives restarts, and it would add a state file and schema for data that is cheap to refetch.

Alternative considered: invalidating on `member_joined_channel` / `member_left_channel` events. Rejected for now: it adds event subscriptions, which means a manifest re-upload for every install.

### Session grants: what a run was granted stays granted

A thread can have several participants. When one of them is allowed a conversation or file, its content enters the session and the thread, where the others already read it. Refusing the next participant the same target would protect nothing and would break follow-ups.

`SessionContext` gains `accessGranted?: string[]`, the conversation and file ids allowed during the session. The check runs in this order:

1. The target is in the session's `accessGranted` → allow, without evaluating the requester.
2. Otherwise evaluate the current requester.
3. On allow, append the target to `accessGranted` and persist it with the session.

For a file, `files.info` is still called on a session-granted target: the bot must still be able to see the file, and the verdict reports the bot's current access level. Only the requester evaluation is skipped.

Only allowances are recorded; a denial is never stored on the session, so each new requester is evaluated for a target nobody was granted. The field is persisted with the session, read through a graceful validator like `followedThreads` (malformed entries dropped, absence reads as empty), so grants survive a restart for as long as the session does.

`bootstrapInvestigation` copies the origin session's `accessGranted` into the session it creates, when an origin session exists. A fork is the same conversation continued elsewhere.

A grant is to the target, not to the content already read: a later participant can fetch newer messages from a granted channel. It lasts for the session's lifetime and is not revoked when the original requester leaves the channel.

Alternative considered: keying grants on `(target, user)` in the session. Rejected: it is the verdict cache again and does not give the second participant access.

### Enforcement sits in the tool handlers, through one function

`src/slack/requesterAccess.ts` exports `checkConversationAccess` and `checkFileAccess`, both returning `{ allowed: true, ... } | { allowed: false, reason }`. `fetch_slack_message` and `fetch_channel_messages` call the conversation check before any Slack read and return one fixed English `errorResult` on denial, with no channel name. `search_messages` filters its results through the same check; for full members that is a no-op with no API calls, since search covers public channels only.

`follow_thread` and `start_investigation` take a channel id and make the investigation drain read that thread, so they run the conversation check before a thread is followed. The drain itself is not gated: it only reads threads those two tools, or the investigate reaction (placed by someone who can see the message), admitted.

Plugin SDK reads (`sdk` message helpers used by trivia) are not gated: they are core code acting on the plugin's own channels, not a requester's ask.

### Manifest config schema built from the real schemas

`configSchemas.ts` gains `manifestConfigZod`, an object schema over the keys the manifest reads: `slackApp`, `directMessages.{enabled,dmType}`, `mentions.enabled`, `autoRespond.enabled`, `allowPublicSearch`, `investigations`. It reuses `allowPublicSearchZod` and `investigationsZod`, shares `slackAppZod` and `dmTypeZod` with `validateConfig`, and ignores unknown keys everywhere except under `investigations`, whose boot schema rejects them; the manifest is as strict there as boot is. The generator `safeParse`s and throws a `zodErrorToResult`-formatted error.

Alternative considered: call `validateConfig`. Rejected: it requires Slack auth and repositories, which do not exist when the manifest is first generated, and an unrelated config error would block manifest generation.

### One scope definition in `src/slack/requiredScopes.ts`

`CORE_SCOPES`, `CORE_EVENTS`, the feature flags type, `requiredBotScopes(features)` and `requiredBotEvents(features)` move from the script into `src/slack/requiredScopes.ts`. The script imports them; so does the drift check. `manifestFeatures` accepts the manifest schema's output, which the validated `Config` satisfies structurally, so both callers use the same function. A feature that needs a new scope is added in this one file.

### Scope drift check mirrors `checkServedToolServers`

`checkTokenScopes(config, client)` in `src/slack/scopeDriftCheck.ts` calls `auth.test`, reads `response_metadata.scopes`, subtracts them from `requiredBotScopes(...)`, logs each missing scope and DMs the owner once through the `OwnerNotifierDeps` pattern. It runs after the Slack app starts and on every soft restart, warns, never throws, and never blocks boot. Extra scopes on the token are ignored: the live token already carries `links:read`, which the manifest never requests. When the response carries no scope list, the check logs and skips.

The check makes its own `auth.test` call on every run instead of reading the per-process `BotIdentity` cache: reinstalling the app changes the token's scopes without changing the token, so a cached scope list would keep reporting a gap the owner already fixed.

## Risks / Trade-offs

- [`casual-talk` and `idler` cron runs read channels as a system actor and lose private channels] → Documented as breaking. Their configured channels must be public, or the rule gains a plugin allowance in a follow-up.
- [`conversations.members` on a very large private channel costs several pages] → Stop at the first page containing the requester; cache the verdict.
- [A session grant lets a non-member participant read new messages from a granted channel, for as long as the session lives] → Accepted: the member who asked first brought that channel into the thread. A split investigation posts to a wider surface, so its inherited grants reach that audience too.
- [A removed member keeps access for up to 5 minutes] → Accepted; the TTL is one constant.
- [`has_more_shares` may truncate a file's share lists] → Truncation only removes evidence, so the failure is a wrong denial, never a wrong allow.
- [A directly shared canvas may be denied to its recipient] → Accepted until the spike's direct-share test is run; see Open Questions.
- [Guest detection adds a `users.info` call per new requester] → Cached for an hour.
- [The owner is DMed on every boot while a scope is missing] → Same behaviour as the served-tools check; the message names the fix.

## Migration Plan

No data migration and no manifest change. Deploy is a normal image deploy. Rollback is a revert; the cache is in memory.

## Open Questions

- Does `dm_mpdm_users_with_file_access` list a person a canvas was shared with directly? The test (a standalone canvas shared with Clack and one other person, no channel) has not been run. The answer changes no code in this change, only how often `slack-canvases` sees a denial.
- Should system-actor plugin runs be allowed to read private channels the plugin's own config names?
