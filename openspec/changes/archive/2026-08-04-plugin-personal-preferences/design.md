## Context

The Personal Preferences modal (`buildSettingsModal` in `src/slack/homeTab.ts`, action `open_settings`, callback `settings_modal`) is core-only with two hardcoded radio fields, persisted to `data/state/user-preferences.json` via `src/userPreferences.ts`. Plugins today have exactly one per-user store, `sdk.users.data(schema)` — a namespace slice on `UserRecord.plugins[plugin]` in the user-registry (`src/userRegistry.ts`). That store is durable (Slack identity refreshes spread-preserve `plugins`, and it's in the backup set) but it is bot-managed extension state with no UI surface.

The motivating consumer is a trivia feature that DMs users who forgot to play a round, one hour before its reveal. It needs a user-facing opt-in preference, a cheap read, and the ability to DM an arbitrary user — which the plugin SDK does not currently expose (`sendMessage`/`dmOwner` are channel/owner only). This change delivers the generic plumbing **and** the trivia reveal reminder as its first consumer.

## Goals / Non-Goals

**Goals:**
- Let a plugin declare per-user preference fields (v1: boolean toggles) that render into the existing Personal Preferences modal.
- Persist those values in the durable, user-choice store (`user-preferences.json`) next to core preference fields, under a `plugins` fold.
- Expose a simplified read `sdk.preferences.get(userId, schema)` mirroring `sdk.users.data` ergonomics but backed by the fold.
- Zero behavior change when no plugin registers preferences.

**Non-Goals:**
- Field types beyond `toggle` (select/text deferred).
- Per-user relevance gating of modal sections beyond "plugin is loaded" (e.g. "only show to trivia players").
- Hot-reload of newly registered fields without a reload — new fields appear after reload, like tools/instructions.
- A generic cron-offset utility for arbitrary cron expressions — the reminder shift handles the common single-integer-hour case and safely skips the rest.
- Reminders for anything other than the current (earliest pending) round, and reminder scheduling other than exactly one hour before reveal.

## Decisions

### Storage: a `plugins` fold in `user-preferences.json`, not the `sdk.users.data` registry namespace

The modal's entire purpose is `user-preferences.json`; plugin preference fields are more per-user choices surfaced in that same modal. Writing them to the registry namespace instead would split one Save across two stores (asymmetric, surprising). A `plugins?: { [plugin]: JsonObject }` fold keeps one store, one write, symmetric with core fields.

- **Alternative — reuse `sdk.users.data` (registry namespace):** zero new read code, and the namespace is durable. Rejected because it conflates bot-managed extension state with user-chosen preferences, and it fractures the single-modal-single-save invariant.
- **Two homes kept distinct on purpose:** registry namespace = bot-managed extension state (cursors, joinedAt); `user-preferences.plugins` = user-chosen, modal-surfaced preferences.

### Read surface: top-level `sdk.preferences.get(userId, schema)`

Mirrors `sdk.users.data(schema).get(userId)` ergonomics (schema-validated, plugin-namespaced, `null` when absent) but reads the fold. Implemented as a new internal surface (`src/plugins-sdk/internal/preferences.ts`) paralleling `users.ts`, wired into the SDK façade.

- **Alternative — nest under `sdk.users.preferences(schema)`:** rejected to keep `sdk.users` about identity; preferences are not identity data.
- **Why not reuse `sdk.users.data` for reads:** it points at the registry store, not the fold — reusing it would force the storage decision back to the registry.

### Injection: declarative field descriptors, core owns render + parse

`sdk.registerPreferences({ schema, fields })`. `fields` is a descriptor list (`{ key, type: "toggle", label, default }`); core derives the Block Kit control, the block/action IDs, and the submit-parse from the descriptor. Plugins never hand raw blocks or parse submissions — core owns the uniform loop so persistence and validation stay generic. The plugin's `schema` is the contract for the persisted object and for `sdk.preferences.get`; descriptors are the render/persist source and their keys must be a subset of the schema.

- **Alternative — plugins hand raw Block Kit + parse their own submission:** maximally flexible but core can't validate/persist generically and can't own the single-modal-single-save loop. Rejected; the constrained descriptor set matches the modal's existing radio-only shape.

### i18n: labels resolved through the plugin's dictionary at render time

Labels are on the direct-to-Slack path and the modal renders per-user in the viewer's language, so a plugin can't pass a static string at boot. The descriptor's label is a key resolved via the owning plugin's `sdk.t` at render time. Core adds no string keys for plugin labels.

### Graceful reader semantics

The fold is persisted state, so per the repo's zod rules it is a graceful reader: the schema accepts an optional `plugins` record parsed permissively; an unknown/malformed individual plugin slice is preserved or falls back to empty without discarding the user's core preferences or other slices. No `.strict()` on the fold.

### DM capability: new `sdk.dmUser`, plugin-trusted

The SDK cannot DM an arbitrary user today. Add `sdk.dmUser(userId, text, options?)` implemented with `openDmChannel` (`conversations.open`) + `chat.postMessage`, the exact pattern core uses in the cron scheduler and quarantine notifier, fail-soft `Result` like `dmOwner`. `openDmChannel` is threaded through the SDK factory deps.

- **Trust boundary:** the query-tool channel resolver deliberately blocks *user-directed* third-party DMs (a user must not steer Claude into DMing someone else). `dmUser` is different — it is plugin-trusted plumbing invoked by plugin code, not by a user prompt. The query-tool guard is left intact; the two paths do not share a code path.

### Trivia reminder: derived cron + deterministic audience, Claude writes only the copy

- **Scheduling — derive, don't add a field.** The user wants "1 hour before reveal" automatically. `deriveReminderCron(revealCron)` shifts a single-integer hour field back by one (`0 17 * * 1-5` → `0 16 * * 1-5`), preserving DOW/timezone. Non-integer hour fields or hour `0` (midnight-crossing, which would also shift the DOW) return `null` with a warning rather than emit a wrong schedule. Reveal crons are single daily times in practice, so this covers the real cases and degrades safely.
  - **Alternative — a Claude/admin-proposed `reminderCron` field (like `prepCron`):** rejected; the user asked for automatic derivation, and a derived cron can't drift out of sync with `revealCron`.
  - **Alternative — one hourly sweeper checking "is reveal ~1h away".** rejected; needs a fire-window match plus per-round idempotency state, where a derived per-game cron fires exactly once with no extra state.
- **Two-level consent.** Admin opts the *game* in (`remindMissedPlayers`, default off, so existing games are untouched and no reminder cron is added); the *user* opts themselves in (`revealReminders` preference, default off). A DM requires both, plus being a known player who hasn't answered this round.
- **Deterministic audience, Claude-authored copy.** The `remind_unplayed` tool owns recipient selection (player ∧ non-answerer ∧ opted-in) and delivery; Claude only composes the localized nudge text and is told to name no specific users. This keeps recipient choice correct and private while preserving trivia's Claude-authored voice. Per-recipient DM failures are logged and skipped, never aborting the batch.
- **No catch-up.** A pre-reveal nudge fired after the fact is pointless, so the reminder spec is excluded from boot catch-up (trivia's catch-up already enumerates only lock/reveal/question, so this is the default — pinned by a test).

## Risks / Trade-offs

- **[Descriptor/schema drift — a field key not on the plugin's schema]** → validate at registration that descriptor keys are a subset of the schema; warn (plugin-scoped) and drop the offending field rather than fail the plugin load.
- **[Two per-user stores may confuse plugin authors (`sdk.users.data` vs `sdk.preferences`)]** → name and document the distinction explicitly (bot-managed extension state vs user-chosen modal preferences); SDK docs and the new capability spec state which to use.
- **[Modal grows unboundedly if many plugins register many fields]** → v1 is toggle-only and sections are per-loaded-plugin; acceptable for the current plugin count. Field-count caps deferred until a real need.
- **[A malformed plugin slice could otherwise wipe core preferences]** → mitigated by the permissive graceful-reader parse (per-slice isolation), covered by a spec scenario and test.
- **[Invalid submission corrupting state]** → submit validates each plugin's values against its schema before merge; a failing slice is left unchanged while core and other slices still persist.
- **[Reminder DMs feel like spam]** → double opt-in (game flag off by default + user preference off by default), audience limited to known players who actually haven't answered this round, one DM per round (single derived fire, no catch-up).
- **[Derived reminder cron is wrong for exotic reveal crons]** → `deriveReminderCron` only handles the single-integer-hour case and returns `null` + warns otherwise, so a malformed shift is never scheduled; covered by unit tests for the skip cases.
- **[A user opts in but isn't a trivia player]** → they are still excluded, because the audience intersects with the game's known player set (`loadUsers()`); the preference alone never triggers a DM about a game the user doesn't play.
