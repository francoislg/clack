## Context

Split investigations bootstrap through one function, `bootstrapInvestigation` (`src/investigations/engine.ts`), reached from three entry points (investigate reaction, `start_investigation` tool, DM/channel relocation). For a channel-surface origin it calls `ensureChannelMembership`, which blindly attempts `conversations.join`. The running bot token lacks the `channels:join` scope (confirmed on the VM: `conversations.join` → `{"ok":false,"error":"missing_scope","needed":"channels:join"}`), so the join fails, the follow degrades to passive `follow`, and the owner gets a misleading DM — even though the bot was already a member of the origin channel (`conversations.info` → `is_member: true`, which the bot *can* read with its current `channels:read`/`groups:read` scopes).

Two user-facing preferences are also being added, both slotting into the existing per-user preference substrate (`src/userPreferences.ts` + the Home Tab Settings modal), which already carries `reactionDelivery` and `notifyOnResponse` via a zod-validated record store.

## Goals / Non-Goals

**Goals:**
- A channel the bot is already in never degrades and never fires an owner DM.
- Only a genuine absence-from-a-public-channel attempts `conversations.join`; a `missing_scope` failure there degrades with a truthful, actionable owner message.
- Drop the unrequested success ephemeral on the reaction path.
- Attribute the requester on the main-surface parent, with a per-user tag (ping) preference (default off).
- Gate the origin-thread breadcrumb on a per-user silent/explicit preference (default silent).

**Non-Goals:**
- Granting `channels:join` (an operational manifest/reinstall step, not code).
- Changing the follow classifier, drain/cursor logic, or lifecycle tools.
- Adding preferences anywhere other than the existing Settings modal.

## Decisions

**1. Membership detection before join.** Rework `ensureChannelMembership` to a check-first flow: call `conversations.info({ channel })`; if `is_member` is true, or the conversation is `is_im`/`is_mpim`, return "can receive events" without any join. Only when the bot is genuinely absent from a public channel attempt `conversations.join`, keeping the existing `already_in_channel` / `method_not_supported_for_channel_type` allowlist. This reuses only already-granted read scopes, so it works today without a reinstall.
- *Alternative considered:* catch `missing_scope` from `conversations.join` and treat it as success. Rejected — it would also mask genuine absence (bot truly not in the channel), silently losing live events with no signal.

**2. Truthful degrade message.** When join is genuinely required and fails, keep the degrade-to-`follow` behavior but change the owner DM copy (`investigations.owner_degraded`) to name the missing `channels:join` scope / app reinstall as the cause instead of "couldn't join that public channel." Membership-present cases no longer reach this path, so the DM only fires when it's actually true.

**3. Remove the success ephemeral.** Delete the `reactor_started` `postEphemeral` block in `investigateReaction.ts` and its `investigations.reactor_started` en/fr strings. Error/duplicate/unconfigured/cycle ephemerals stay.

**4. Requester-attributed parent + tag preference.** Replace `investigations.parent_channel` / `investigations.parent_dm` with a requester-prefixed form (`🔎 {requester} requested an investigation of: {link}`). `bootstrapInvestigation` already has `client` + `requester`; it resolves the tag preference and renders `{requester}` as either a plain-text display name (via the existing user-cache display-name helper) when OFF, or `<@userId>` when ON. This mirrors trivia's `tagPlayers` pattern. Gating lives in the bootstrap so all three entry points inherit it.
- *Alternative considered:* a new i18n placeholder that conditionally emits a mention. Rejected — mention-vs-plain is a value decision, not a formatting one; keep it in code and pass the final rendered string into `t()`.

**5. Breadcrumb preference.** Read the requester's silent/explicit preference in `bootstrapInvestigation` and skip the breadcrumb `postMessage` when silent (default). Default silent is a deliberate behavior change from today's always-post.

**6. Preference storage.** Add two fields to `UserPreferences` and the zod `preferencesEntryZod` in `userPreferences.ts` (both optional, graceful reader). Defaults live in `DEFAULT_PREFERENCES` (tag → `false`, breadcrumb → `"silent"`). Surface both as radio groups in `buildSettingsModal` and persist them in the settings submit handler (`src/slack/handlers/homeTab.ts`), following the `notifyOnResponse` precedent exactly.

## Risks / Trade-offs

- **Default-silent breadcrumb changes existing behavior** → Documented as BREAKING in the proposal; users who want the old behavior opt into "explicit."
- **`conversations.info` adds one API call per channel-surface bootstrap** → Negligible (one extra read on a low-frequency, human-initiated path); avoids a failing write call in the common case.
- **`conversations.info` itself could fail** (e.g. transient error) → Treat an errored/unknown `is_member` as "not confirmed member" and fall through to the join attempt, preserving today's degrade-on-failure safety net rather than assuming membership.
- **i18n parity** → New strings must be added to both `en.ts` and `fr.ts` with a genuinely different FR value or the parity test fails; removed `reactor_started` must be dropped from both.
