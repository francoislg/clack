## 1. User preferences

- [x] 1.1 Add `investigationTag: boolean` (default `false`) and `investigationBreadcrumb: "silent" | "explicit"` (default `"silent"`) to `UserPreferences` and `DEFAULT_PREFERENCES` in `src/userPreferences.ts`
- [x] 1.2 Extend `preferencesEntryZod` with both fields (`.optional()`, graceful reader — no `.strict()`)
- [x] 1.3 Add/extend unit tests for the loader asserting the new defaults on read and that stored values round-trip

## 2. Settings modal

- [x] 2.1 Add two radio groups (tag on/off, breadcrumb silent/explicit) to `buildSettingsModal` in `src/slack/homeTab.ts`, preselecting the user's current values (mirror the `notifyOnResponse` block)
- [x] 2.2 Persist both in the settings submit handler in `src/slack/handlers/homeTab.ts` (mirror `notifyOnResponse`)
- [x] 2.3 Update the Home Tab handler test to assert both preferences are read into the modal and written on submit

## 3. Membership-aware join

- [x] 3.1 Rework `ensureChannelMembership` in `src/investigations/engine.ts`: call `conversations.info` first; return true when `is_member` is true or the conversation is `is_im`/`is_mpim`; on info error, fall through
- [x] 3.2 Attempt `conversations.join` only when not a confirmed member; keep the `already_in_channel` / `method_not_supported_for_channel_type` allowlist; return false (degrade) otherwise
- [x] 3.3 Update `investigations.owner_degraded` (en + fr) to name the missing `channels:join` scope / app reinstall as the cause
- [x] 3.4 Unit-test the membership matrix (already-member → no join, no degrade; im/mpim → no join; absent public + join fails → degrade; `conversations.info` errors → fall through to join attempt) mocking the Slack client at the boundary

## 4. Remove the start ephemeral

- [x] 4.1 Delete the `reactor_started` `postEphemeral` block from `handleInvestigateReaction` in `src/slack/handlers/investigateReaction.ts`
- [x] 4.2 Remove `investigations.reactor_started` from `src/i18n/strings/en.ts` and `src/i18n/strings/fr.ts`
- [x] 4.3 Update `investigateReaction` tests to assert no ephemeral is posted on a successful start (duplicate/unconfigured/cycle ephemerals still asserted)

## 5. Requester-attributed parent + tag preference

- [x] 5.1 Replace `investigations.parent_channel` / `investigations.parent_dm` (en + fr) with the `🔎 {requester} requested an investigation of: {link}` form
- [x] 5.2 In `bootstrapInvestigation`, resolve the requester's `investigationTag` preference and render `{requester}` as a plain-text `@displayName` (via the user-cache display-name helper) when off, or `<@requester>` when on; use it for both surfaces
- [x] 5.3 Unit-test both renderings (off → `@displayName` plain text, no mention token; on → `<@id>`) for channel and DM surfaces

## 6. Breadcrumb preference gating

- [x] 6.1 In `bootstrapInvestigation`, read the requester's `investigationBreadcrumb` preference and skip the breadcrumb `postMessage` when `"silent"`
- [x] 6.2 Unit-test that silent posts no breadcrumb and explicit posts exactly one

## 7. Verification

- [x] 7.1 Run the i18n parity test and fix any key/placeholder/identical-FR failures from added/removed strings
- [x] 7.2 `npx tsc --noEmit`, `npx oxlint` on touched files, `npx oxfmt` on touched files, and the full `npm test` suite
- [x] 7.3 `openspec validate add-investigation-preferences --strict`
