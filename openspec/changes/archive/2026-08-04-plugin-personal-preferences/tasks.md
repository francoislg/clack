## 1. Storage: plugins fold in user-preferences

- [x] 1.1 Extend `UserPreferences` in `src/userPreferences.ts` with an optional `plugins?: { [plugin: string]: JsonObject }` fold
- [x] 1.2 Extend the preferences zod schema to accept the `plugins` record permissively (graceful reader: unknown/malformed individual slice preserved or empty, never wipes the entry); keep whole-file parse-failure → `{}` behavior
- [x] 1.3 Add `getPluginPreferenceSlice(plugin, userId)` and `mergePluginPreferenceSlice(plugin, userId, partial)` helpers that read/merge a single plugin's slice under the fold (merge preserves untouched keys, other plugins, and core fields)
- [x] 1.4 Unit tests in `src/userPreferences.test.ts`: fold round-trips, merge isolation across plugins/users, malformed slice does not discard core fields, deprecated `dmOptOut` still tolerated

## 2. SDK: preferences registration + read + dmUser

- [x] 2.1 Define the preference field descriptor type and `registerPreferences` input (`{ schema, fields }`) in the SDK types; v1 supports `type: "toggle"` only
- [x] 2.2 Add `sdk.registerPreferences(...)` to the SDK façade (`src/plugins-sdk/sdk.ts`); validate descriptor keys are a subset of the schema and `type === "toggle"`, warn (plugin-scoped) and drop invalid fields
- [x] 2.3 Create `src/plugins-sdk/internal/preferences.ts` exposing `sdk.preferences.get(userId, schema)` (parallels `internal/users.ts`): the surface is constructed per-plugin with the plugin name bound (same as `createUsersSurface`), so isolation is inherent — it reads ONLY the bound plugin's slice from the fold, validates against the schema, and returns the parsed object or `null` (absent OR validation failure)
- [x] 2.4 Add `sdk.dmUser(userId, text, options?)` in `src/plugins-sdk/internal/messaging.ts` using `openDmChannel` + `chat.postMessage` (cron-scheduler pattern); wire `openDmChannel` through `ClackSdkDeps`/factory; add `dmUser` to the messaging surface's return type and the `ClackSdk` façade type so it reaches `sdk.dmUser`; fail-soft `Result` mirroring `dmOwner`
- [x] 2.5 Wire the preferences surface into `createClackSdk` and harvest registered preference specs into the plugin load result (`src/plugins-core/registry.ts`)
- [x] 2.6 Expose loaded plugins' registered preference specs to core (a getter alongside `getLoadedClackPlugins`) so the modal builder can enumerate them
- [x] 2.7 Unit tests: registration harvest, invalid-field rejection, `sdk.preferences.get` returns slice / null / rejects other plugins' slices; `dmUser` success / open-fail / disconnected / API-error all fail-soft

## 3. Home Tab modal: render + submit fan-out

- [x] 3.1 In `buildSettingsModal` (`src/slack/homeTab.ts`), after core fields, append one section per enabled plugin with registered preferences: plugin header, divider, one control per field, pre-selecting the user's stored value or field default
- [x] 3.2 Resolve each field label through the owning plugin's dictionary (`sdk.t`) in the viewer's language at render time; derive deterministic block/action IDs namespacing the plugin + field key
- [x] 3.3 In the `settings_modal` submit handler (`src/slack/handlers/homeTab.ts`), parse plugin field values from `view.state.values`, validate each plugin's values against its schema, and `mergePluginPreferenceSlice` per plugin — a failing slice left unchanged while core + other slices still persist
- [x] 3.4 Ensure zero behavior change when no plugin registered preferences (modal + save byte-identical)
- [x] 3.5 Tests: modal renders plugin section with correct pre-selection and localized label; no section when none registered / plugin disabled; submit persists plugin values + core in one save; invalid plugin submission does not corrupt state

## 4. Trivia: opt-in preference + per-game flag

- [x] 4.1 In `src/plugins/trivia/index.ts`, register the `revealReminders` toggle via `sdk.registerPreferences` (default `false`) and add the localized label to the trivia dictionary (en + fr)
- [x] 4.2 Add `remindMissedPlayers?: boolean` to `TriviaGame` (`src/plugins/trivia/core/configTypes.ts`) and its config parser; surface set/clear in `upsert_game` (omit-to-keep, null-to-clear) and in `list_games`
- [x] 4.3 Tests: config parse round-trip for the flag; `upsert_game` set/clear semantics

## 5. Trivia: derived reminder cron

- [x] 5.1 Add a pure `deriveReminderCron(revealCron): string | null` helper (trivia domain): shift a single-integer hour field back by 1; return `null` + warn for non-integer hour or hour `0`
- [x] 5.2 Write the `REMIND_UNPLAYED_INSTRUCTIONS` prompt constant (`src/plugins/trivia/prompts/scheduledPrompts.ts`): compose one short friendly localized reminder, call `remind_unplayed({ message })`, mention no specific users — defined BEFORE the spec that references it (5.3)
- [x] 5.3 In `buildGameSpecs` (`src/plugins/trivia/domain/buildGameSpecs.ts`), when `remindMissedPlayers` is on and `deriveReminderCron` is non-null, emit a `<game>:reminder` spec: channelless, `submitResponseMode: "skipped"`, `requiredTools: ["mcp__trivia__remind_unplayed"]`, `attachedTopics: ["trivia"]`, prompt from `REMIND_UNPLAYED_INSTRUCTIONS`
- [x] 5.4 Confirm `catchUp.ts` does not enumerate/backfill the reminder spec (leave as-is; add a test asserting no reminder catch-up)
- [x] 5.5 Unit tests for `deriveReminderCron` (afternoon shift, non-integer hour, hour 0, weekday DOW preserved) and `buildGameSpecs` reminder emission on/off

## 6. Trivia: remind_unplayed tool + audience

- [x] 6.1 Add current-round + non-answerer helpers in the trivia data layer: earliest pending batch's question IDs, answered userIds for those questions, and the candidate player set from `loadUsers()`
- [x] 6.2 Implement `remind_unplayed` tool (`src/plugins/trivia/tools/...`): compute audience (player ∧ non-answerer ∧ `revealReminders` on via `sdk.preferences.get`), DM each via `sdk.dmUser` with the Claude-supplied message, continue past per-recipient failures, return reminded count; register cron-only
- [x] 6.3 Tests: audience filtering (answered excluded, opted-out excluded, non-player excluded), empty-audience no-op, one-recipient-failure does not abort, `dmUser` called per recipient with the message

## 7. Docs & validation

- [x] 7.1 Document `sdk.registerPreferences`, `sdk.preferences.get`, and `sdk.dmUser` in the plugin SDK docs; note the `sdk.users.data` vs preferences distinction; update trivia CLAUDE.md section for the reminder feature
- [x] 7.2 Run `npx tsc --noEmit`, `npx oxlint` on touched files, `npx oxfmt` on touched files, and the full `npm test` suite
- [x] 7.3 `openspec validate plugin-personal-preferences --strict`
