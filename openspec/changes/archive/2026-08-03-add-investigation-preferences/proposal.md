## Why

Starting an investigation from a channel the bot is **already a member of** wrongly degrades the follow to passive `follow` mode and DMs the owner a misleading *"the bot couldn't join that public channel"* message. Root cause (confirmed on the VM): the bootstrap blindly calls `conversations.join`, which needs the `channels:join` scope; when that scope is absent the call fails with `missing_scope`, and the code treats that as "can't receive events" even though membership already guarantees event delivery. On top of that, the reaction path posts an unrequested success ephemeral, and users have no control over how an investigation is attributed or announced.

## What Changes

- **Membership-aware join.** The bootstrap SHALL detect existing membership via `conversations.info.is_member` (needs only the already-granted `channels:read`/`groups:read`) and skip the join entirely when the bot is already in the channel — no degrade, no owner DM. DM/MPIM origins (always a participant) also skip the join. `conversations.join` is attempted only when the bot is genuinely absent from a public channel; a `missing_scope` failure there degrades with a clearer owner message naming the reinstall/`channels:join` fix.
- **Remove the start ephemeral.** The investigate-reaction path SHALL no longer post the `reactor_started` success ephemeral. Error/duplicate/unconfigured/cycle ephemerals are unchanged.
- **New per-user preference "Tag me when I start an investigation".** The main-surface parent message becomes `🔎 {requester} requested an investigation of: {link}` for both channel and DM surfaces. OFF (default) renders the requester as plain `@displayName` (no ping); ON renders a real `<@id>` mention (pings).
- **New per-user preference: silent vs explicit breadcrumb.** Gates the one-time origin-thread breadcrumb. Default **silent** (no breadcrumb posted); explicit posts it. **BREAKING**: the breadcrumb no longer posts by default.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `split-investigations`: membership-aware bootstrap join, removal of the reaction success ephemeral, requester-attributed parent message, and preference-gated breadcrumb.
- `user-preferences`: two new preference fields (investigation requester-tag, investigation breadcrumb visibility) surfaced in the Settings modal.

## Impact

- **Code:** `src/investigations/engine.ts` (join detection, parent rendering, breadcrumb gating), `src/slack/handlers/investigateReaction.ts` (drop success ephemeral), `src/userPreferences.ts` (two fields + schema), `src/slack/homeTab.ts` + `src/slack/handlers/homeTab.ts` (Settings modal controls), `src/i18n/strings/{en,fr}.ts` + parity test.
- **Operational (out of code scope):** granting `channels:join` still requires re-uploading the manifest and reinstalling the app, but only matters for the genuinely-absent-public-channel case; membership detection needs no new scope.
