## Why

Clack is currently English-only. Operators deploying Clack in non-English-speaking workspaces (e.g. French-speaking teams) get a jarring mixed experience where the bot's Slack UI, button labels, and error toasts are in English even when individual Claude answers happen to be in the user's language. There is no first-class mechanism to make Clack speak a chosen language end-to-end.

## What Changes

- Add a top-level `language` field to `config.json` accepting BCP-47 short codes (`"en"`, `"fr"`); default `"en"` preserves current behavior.
- Introduce a tiny in-house i18n helper `t(key, vars?)` with TypeScript template-literal-typed placeholder enforcement (no external dependency). Compatible with a future swap to a real i18n library (e.g. Paraglide).
- Ship two dictionaries: `src/i18n/strings/en.ts` (source of truth) and `src/i18n/strings/fr.ts` (initial French translation). FR strings fall back to EN on missing keys.
- Inject a "respond in this language" directive into the user-facing system prompt path (`buildSystemPrompt`) when `language !== "en"`, so every Claude-authored output (Q&A answers, change-workflow narration, trivia, auto-responses) is produced in the configured language. The directive is **not** added to the pre-analysis prompt path (internal reasoning stays unaffected).
- Migrate all user-facing hardcoded strings emitted by Clack's own TypeScript code (not by Claude) to use `t()`:
  - Home Tab (`src/slack/homeTab.ts` — ~192 strings)
  - Block Kit modal/builder strings (`src/slack/blocks.ts`)
  - DM-first reaction flow (`src/slack/dmResponse.ts`)
  - Status messages the bot posts directly (cancellation, permission-denied, change-workflow status, stop-reaction confirmations)
  - User-visible error messages (`src/slack/handlers/`, `src/changes/`)
- Add a unit test asserting placeholder parity between every shipped dictionary and the EN baseline.

**Out of scope for this change** (deferred to follow-ups):
- Tool-mapping labels in Slack task cards (`data/default_configuration/tool_mapping/*.json`) — confirmed deferred.
- Per-language instruction folders (`data/default_configuration/fr/...`) — instruction files stay English; Claude reads English prompts and produces target-language output.
- Per-user language preferences — `language` is workspace-global.
- Plugin-specific dictionaries — plugins ride the Claude-voice directive. Hardcoded plugin TS strings shown to users (if any) are migrated to `t()` only where they cross the Slack boundary in this change's scope; deeper plugin localization is a follow-up.
- Slack app manifest / OAuth scope labels — managed in Slack admin, out of Clack's control.
- ICU plural / gender / select variants — DIY helper handles only simple `{var}` interpolation; pluralization uses separate keys (`x.one` / `x.other`) where needed.

## Capabilities

### New Capabilities
- `localization`: defines the `language` config field, the `t()` helper contract (typed-placeholder interpolation, EN fallback, supported language set), the language directive contract for Claude prompts, and the dictionary parity requirement.

### Modified Capabilities
- `home-tab`: Home Tab rendered strings MUST be sourced from the localization dictionary.
- `error-reporting`: user-visible error messages MUST be sourced from the localization dictionary.
- `changes-workflow`: bot-authored status messages (PR-created, cancelled, merged externally, quarantine notice, etc.) MUST be sourced from the localization dictionary; Claude-authored change-workflow narration MUST honor the language directive.
- `slack-assistant`: assistant suggested-prompts and bot-authored button labels MUST be sourced from the localization dictionary.
- `instruction-system`: the system prompt composition pipeline MUST inject the language directive when `language !== "en"`, except on the pre-analysis prompt path.

## Impact

- **Config schema**: new optional `language` field in `config.json`; defaults to `"en"`. No migration required (absence = `"en"`).
- **New code**: `src/i18n/t.ts`, `src/i18n/strings/en.ts`, `src/i18n/strings/fr.ts`, `src/i18n/keys.ts` (type-level exports), plus tests.
- **Touched files**: `src/config.ts` (schema), `src/claude/promptBuilder.ts` (directive injection), `src/slack/homeTab.ts`, `src/slack/blocks.ts`, `src/slack/dmResponse.ts`, change-workflow status emitters in `src/changes/` and `src/slack/handlers/`, error-toast emitters.
- **No dependencies added.**
- **No data migration.** No persisted format changes.
- **Tests**: existing tests pin to default (`"en"`) and continue to pass; new tests cover the `t()` helper, directive injection, placeholder parity, and a representative FR Home Tab rendering.
- **Performance**: `t()` is an object lookup + small string replace; no measurable runtime cost.
