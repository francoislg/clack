## Why

Clack reads Slack with its bot token, so it sees what the bot can see, not what the person asking can see. `fetch_slack_message` and `fetch_channel_messages` never look at the requester: a member can ask Clack to read a private channel Clack is in but they are not. The planned Slack Canvases and Slack Lists features would widen the same hole to files, so the access check is their prerequisite.

Two neighbouring gaps make scope-gated features fragile. `scripts/generate-manifest.ts` reads `config.json` through a hand-rolled interface and an `as` cast, so a wrong-typed value silently drops a feature from the manifest. And nothing compares the scopes the config needs with the scopes the installed token carries, so a feature enabled without a manifest re-upload and reinstall fails at runtime with `missing_scope`.

## What Changes

- Add a requester-access check: Clack acts on a Slack conversation or file only when the bot can see it AND the requester can.
  - Conversations: public channels are open to full members; private channels, group DMs and DMs require the requester to be a member; guests and external users require membership even on public channels.
  - Files (canvases, lists): allowed on positive evidence only — the requester created the file, is listed in its per-user access, or passes the conversation rule for a channel the file is shared to.
  - The requester is the human behind the run: the message author, the reacting user, the cron job's creator, the investigation's requester. A run with no human (plugin cron jobs) reads public channels only.
  - No Clack role bypasses the check.
  - Verdicts are held in a short-lived in-memory cache.
  - An allowance is recorded on the session. Once one participant of a thread has been granted a conversation or file, it stays granted for that session, whoever asks next. A session forked from it (a split investigation) inherits the grants.
- **BREAKING**: `fetch_slack_message` and `fetch_channel_messages` refuse conversations the requester cannot see. `search_messages` drops results from channels a guest requester is not in.
- The manifest generator parses `config.json` through a zod schema built from the real config schemas and fails with a formatted error on an invalid value.
- The scope and event derivation moves into `src/` so the manifest generator and the running bot share one definition.
- Add a boot and soft-restart check that compares the scopes the live config requires with the scopes on the bot token and DMs the owner about missing ones. It warns and never blocks boot.

## Capabilities

### New Capabilities

- `slack-requester-access`: the requester-access check for Slack conversations and files, its verdict cache, and its enforcement in the message-reading query tools.
- `slack-scope-drift-check`: the boot-time comparison of config-required bot scopes against the installed token's scopes, with an owner DM on gaps.

### Modified Capabilities

- `manifest-generation`: the generator validates the config it reads through a zod schema, and derives scopes and events from a definition shared with the running bot.

## Impact

- New: `src/slack/requesterAccess.ts`, `src/slack/requiredScopes.ts`, `src/slack/scopeDriftCheck.ts`, each with tests.
- Changed: `src/tools/query/fetchSlackMessage.ts`, `src/tools/query/fetchChannelMessages.ts`, `src/tools/query/searchMessages.ts`, `scripts/generate-manifest.ts`, `src/configSchemas.ts`, `src/slack/botIdentity.ts`, `src/sessions.ts`, `src/investigations/engine.ts`, `src/index.ts`, `src/lifecycle.ts`, `src/i18n/strings/en.ts`, `src/i18n/strings/fr.ts`, `CLAUDE.md`.
- Slack API: adds `conversations.members` and `users.info` calls on cache misses. No new scopes.
- Plugins: `casual-talk` and `idler` cron runs call `fetch_channel_messages` as a system actor and lose access to private channels.
- Downstream: `slack-canvases` and `slack-lists` consume the file check and add their scopes to `src/slack/requiredScopes.ts`.
