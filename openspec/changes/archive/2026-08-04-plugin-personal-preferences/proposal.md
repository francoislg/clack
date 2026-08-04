## Why

Plugins have no way to give users a per-user preference that surfaces in Slack. The Personal Preferences modal is core-only (two hardcoded fields), and the only per-user store a plugin can write, `sdk.users.data` (the user-registry namespace), is bot-managed extension state with no UI. The concrete need driving this: the trivia plugin wants to DM players who forgot to play a round, **1 hour before that round's reveal** — which requires (a) each user to opt into such reminders from the Home Tab, (b) the plugin to read that choice back cheaply, and (c) the ability to DM an arbitrary user, which the plugin SDK does not currently expose.

This change delivers the generic plumbing **and** its first consumer (the trivia reveal reminder), so the feature ships end to end.

## What Changes

**Preferences plumbing (generic):**
- **New SDK registration** `sdk.registerPreferences({ schema, fields })` — a plugin declares preference fields (v1: `toggle` only) with a key, an i18n label, and a default. This is the "injection" mechanism: how a plugin's field gets into the shared Personal Preferences modal.
- **Modal injection** — the core Personal Preferences modal (`settings_modal`) renders one section per enabled-plugin-with-preferences (header + divider + one Block Kit element per field). Labels resolve through the owning plugin's own `sdk.t` at render time, in the viewing user's language.
- **One Save, fanned out** — on modal submit, core parses its own fields (unchanged) and persists each plugin's field values into a new `plugins` fold, single store, single write.
- **New durable store fold** — `UserPreferences` gains a `plugins?: { [plugin: string]: JsonObject }` fold in `data/state/user-preferences.json`, alongside the core fields. Correct home for user-chosen, modal-surfaced preferences (distinct from `sdk.users.data`, which stays bot-managed extension state). Graceful reader: unknown/malformed plugin slices preserved or defaulted, never wiping state.
- **New simplified read** `sdk.preferences.get(userId, schema)` — mirrors `sdk.users.data(schema).get()` ergonomics but reads the `plugins` fold and validates through the plugin's own zod schema. Returns `null` when unset.
- **New DM capability** `sdk.dmUser(userId, text, options?)` — opens (or reuses) a DM channel via `conversations.open` and posts, following the core cron-scheduler pattern. Plugin-trusted plumbing; the query-tool guard that blocks user-directed third-party DMs is unaffected.

**First consumer — trivia reveal reminder:**
- **Opt-in preference** — trivia registers a `revealReminders` toggle (default **off**) via the new registration, and reads it via `sdk.preferences.get`.
- **Per-game enable flag** — `TriviaGame.remindMissedPlayers?: boolean` (default off, set via `upsert_game`) gates the feature per game, so existing games are untouched.
- **Derived reminder cron** — when a game has `remindMissedPlayers` on, `buildGameSpecs` emits a `<game>:reminder` spec whose cron is `revealCron` shifted back one hour (single-integer hour case; skipped with a warning for midnight-crossing or non-trivial hour fields). Channelless, `submitResponseMode: "skipped"`, not caught up on boot (a post-hoc pre-reveal nudge is pointless).
- **`remind_unplayed` tool** — the reminder cron drives a new cron-only trivia tool that computes the audience deterministically (players in `loadUsers()` who have **not** answered the current round's batch **and** have `revealReminders` on) and DMs each the reminder text via `sdk.dmUser`. The tool owns audience + delivery; Claude only supplies the localized nudge copy and never selects recipients.

## Capabilities

### New Capabilities
- `plugin-personal-preferences`: A plugin declares per-user preference fields that core renders into the Personal Preferences modal and persists on Save, plus a simplified per-user read (`sdk.preferences.get`) backed by a `plugins` fold in the durable user-preferences store.
- `trivia-reveal-reminders`: A per-game opt-in that DMs trivia players who have not answered the current round, one hour before its reveal, to users who enabled the reveal-reminder preference.

### Modified Capabilities
- `user-preferences`: The persisted `UserPreferences` shape gains an optional `plugins` fold (per-plugin JSON slice), loaded permissively so unknown/malformed plugin slices never wipe core preferences.
- `home-tab`: The Personal Preferences modal renders a section per enabled plugin that registered preferences, and its submit fans registered field values out to the `plugins` fold in addition to core fields.
- `plugin-send-message`: The plugin SDK gains `sdk.dmUser(userId, text, options?)` to DM an arbitrary user by opening a DM channel, complementing the channel-targeted `sendMessage`.

## Impact

- **Preferences plumbing**: `src/plugins-sdk/sdk.ts` (new `registerPreferences` + `sdk.preferences` + `sdk.dmUser`), `src/plugins-sdk/internal/` (new `preferences.ts`, `messaging.ts` `dmUser`, factory deps for `openDmChannel`), `src/plugins-core/registry.ts` (harvest preference specs + expose to core), `src/userPreferences.ts` (add `plugins` fold + permissive zod), `src/slack/homeTab.ts` (`buildSettingsModal` renders plugin sections), `src/slack/handlers/homeTab.ts` (`settings_modal` submit fan-out).
- **Trivia consumer**: `src/plugins/trivia/index.ts` (register preference + dictionary label), `src/plugins/trivia/core/configTypes.ts` (`remindMissedPlayers`), `src/plugins/trivia/domain/buildGameSpecs.ts` (derived `:reminder` spec), a new cron helper `deriveReminderCron`, a new `remind_unplayed` tool under `src/plugins/trivia/tools/`, `upsert_game` (set the flag).
- **i18n**: plugin field labels + reminder copy stay on the direct-to-Slack path (plugin dictionary / Claude-composed in workspace language); no core string keys added.
- **No breaking changes**: absent any `registerPreferences` call the modal and store are byte-identical; the `plugins` fold is optional and additive; `remindMissedPlayers` defaults off so no existing game gains a reminder cron.
