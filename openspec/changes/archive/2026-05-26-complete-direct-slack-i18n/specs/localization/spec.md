## ADDED Requirements

### Requirement: Direct-to-Slack String Coverage

The system SHALL localize every user-facing string on the **direct-to-Slack path** — any string rendered to a Slack user (message text, Block Kit element, button/modal label, status indicator, thinking-card title, ephemeral notice, or DM) without first passing back through Claude's `submit_response`. Core code SHALL deliver such strings via `t()`; plugin code SHALL deliver them via `sdk.t()` (plugins cannot import core i18n).

Strings returned to Claude as MCP tool results (the `textResult`/`errorResult` envelopes in `src/tools/helpers.ts`, and equivalent Claude-facing content) are on the **via-Claude path**: Claude re-renders them under the LANGUAGE directive, so they SHALL remain English and SHALL NOT be routed through `t()`/`sdk.t()`. Claude-facing prompt instructions and tool descriptions likewise remain English.

When the configured language is absent or `"en"`, every newly-keyed direct-to-Slack string SHALL resolve to its original English text, leaving EN-mode output unchanged.

#### Scenario: Direct-to-Slack notice is localized

- **GIVEN** the configured language is `"fr"`
- **AND** a handler posts an ephemeral permission-denied notice directly to Slack
- **WHEN** the notice is rendered
- **THEN** its text comes from the active-language dictionary via `t()` and appears in French

#### Scenario: Interpolated thinking-card title is localized

- **GIVEN** the configured language is `"fr"`
- **AND** a change-workflow run sets a thinking-card title for branch `feat/x`
- **WHEN** the streaming card renders
- **THEN** the title is produced by `t("streamer.working_on", { branch: "feat/x" })` and the `{branch}` value is preserved

#### Scenario: Plugin direct-to-Slack string is localized

- **GIVEN** the configured language is `"fr"`
- **AND** the trivia plugin posts a "answers are closed" validation message directly to a Slack user
- **WHEN** the message is rendered
- **THEN** its text comes from the plugin's registered dictionary via `sdk.t()` and appears in French

#### Scenario: Via-Claude tool result stays English

- **GIVEN** the configured language is `"fr"`
- **AND** a tool returns `errorResult("No active change in this thread.")`
- **WHEN** the result is produced
- **THEN** the envelope text is the English literal (not routed through `t()`)
- **AND** the user-visible wording is produced by Claude's `submit_response` under the LANGUAGE directive

#### Scenario: EN mode unchanged

- **GIVEN** the configured language is absent or `"en"`
- **WHEN** any newly-keyed direct-to-Slack string is rendered
- **THEN** it resolves to its original English text

## MODIFIED Requirements

### Requirement: Dictionary File Layout and Placeholder Parity

Each supported language SHALL ship a dictionary module under `src/i18n/strings/<lang>.ts`. The EN dictionary is the source of truth (`as const` object literal). Every other dictionary SHALL be typed as `Record<keyof typeof en, string>`.

A parity test SHALL run as part of the standard test suite. For every non-EN dictionary, the test SHALL assert:
- The set of keys is identical to the EN dictionary.
- For every key, the set of `{var}` placeholder tokens in the translated string is identical to the set in the EN string.
- For every key, the translated value is NOT identical to the EN value, UNLESS the key appears in an explicit translation-completeness allowlist. The allowlist SHALL hold only legitimately-identical entries (e.g. brand/proper names, emoji-only values, and values consisting solely of `{var}` placeholders).

The parity test SHALL fail the build when any of these conditions is violated.

#### Scenario: All keys present in FR

- **GIVEN** every key in `en.ts` has a corresponding entry in `fr.ts`
- **WHEN** `parity.test.ts` runs
- **THEN** the test passes

#### Scenario: Missing key in FR

- **GIVEN** `en.ts` contains a key that `fr.ts` is missing
- **WHEN** `parity.test.ts` runs
- **THEN** the test fails and reports the missing key

#### Scenario: Placeholder mismatch

- **GIVEN** EN entry `"x": "Value: {role}"` and FR entry `"x": "Valeur : {rôle}"`
- **WHEN** `parity.test.ts` runs
- **THEN** the test fails and reports the placeholder-token mismatch (`role` vs `rôle`)

#### Scenario: FR value identical to EN value fails

- **GIVEN** EN entry `"home.auto_respond.header": "Auto-Respond"` and FR entry `"home.auto_respond.header": "Auto-Respond"`
- **AND** the key is NOT in the translation-completeness allowlist
- **WHEN** `parity.test.ts` runs
- **THEN** the test fails and reports the untranslated (FR==EN) key

#### Scenario: Allowlisted identical value passes

- **GIVEN** EN entry `"brand.slack": "Slack"` and FR entry `"brand.slack": "Slack"`
- **AND** the key IS in the translation-completeness allowlist
- **WHEN** `parity.test.ts` runs
- **THEN** the test passes for that key
