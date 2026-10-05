## Why

Clack joins public channels on its own: when `start_investigation` targets a thread in a public channel Clack isn't in, the bootstrap calls `conversations.join`, and the investigations feature requests the `channels:join` scope to do it. A bot should only be in channels people invited it into. Joining by itself is a hard no. When Clack isn't in the channel, it tells the user it can't do the job.

## What Changes

- **BREAKING** The investigation bootstrap never calls `conversations.join`. When Clack isn't a member of the origin channel, or can't confirm that it is, whether the investigation opens in the investigations channel or in a DM, the bootstrap refuses with a new `not_in_channel` status. It does so before posting the parent message or creating a session, and nothing is followed. DM and MPIM origins, and channels Clack is already in, work as before.
- **BREAKING** The passive-follow fallback for a channel Clack couldn't join is gone, along with `BootstrapResult.degraded` and the `degraded` field in `start_investigation`'s result.
- Each entry point tells the user:
  - The 🔍 reaction handler posts an ephemeral message to the reactor through `t()` (new key `investigations.reactor_not_in_channel`, EN + FR): Clack isn't in that channel, so invite it and try again.
  - `start_investigation` returns an English error result saying the same thing. Claude relays it.
- `follow_thread` follows the same rule. It refuses, with an English error result, a thread in a channel Clack isn't a member of, instead of adding a thread whose live updates would never arrive.
- Remove the owner DM for a degraded start (`investigations.owner_degraded`, EN + FR). It blamed the missing `channels:join` scope.
- **BREAKING** (manifest) Remove `channels:join` from `requiredBotScopes` and from the generated `slack-app-manifest.json`. Investigations still adds `message.channels` / `message.groups`.
- Enabling investigations adds no scope anymore (only bot events), so the operator note asks for a manifest re-upload and no longer for an app reinstall.
- Remove `channels:join` from test fixtures that use it as a sample scope, and from CLAUDE.md's investigations section.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `split-investigations`: the bootstrap refuses a channel origin Clack isn't a member of: no join, no passive fallback, no owner notice. The entry points tell the requester. `follow_thread` refuses such a thread too.
- `manifest-generation`: the conditional investigation scopes no longer include `channels:join`.

## Impact

- Code: `src/investigations/engine.ts`, a new shared bot-membership check in `src/slack/`, `src/slack/handlers/investigateReaction.ts`, `src/tools/actions/startInvestigation.ts`, `src/tools/actions/followThread.ts`, `src/slack/requiredScopes.ts`, `src/i18n/strings/{en,fr}.ts`.
- Tests: the engine integration test, the reaction handler, `startInvestigation`, `followThread`, `requiredScopes`, `generate-manifest`, `scopeDriftCheck`, `lifecycle`.
- Artifacts: `slack-app-manifest.json` (regenerated), CLAUDE.md.
- Operators: re-upload the manifest. An installed token keeps `channels:join` until the app is reinstalled. That's harmless, because no code calls the join.
