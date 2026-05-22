# localization Specification

## Purpose
Support multi-language operation via a configuration field, typed translation helper, language-aware system prompt directives, and dictionaries with parity validation.

## Requirements

### Requirement: Language Configuration Field

The system SHALL accept an optional top-level `language` field in `config.json`. Valid values are BCP-47 short codes from the supported language set. When the field is absent or `"en"`, the system SHALL behave identically to its pre-localization state.

The initial supported set SHALL be `"en"` and `"fr"`. Adding a new supported language SHALL require shipping a corresponding dictionary file and registering metadata (EN name, native name).

#### Scenario: Language field absent

- **GIVEN** `config.json` does NOT contain a `language` field
- **WHEN** the configuration is loaded
- **THEN** the effective language is `"en"`
- **AND** no language directive is injected into the system prompt
- **AND** every `t(key)` call returns the EN dictionary value

#### Scenario: Language field set to "en"

- **GIVEN** `config.json` contains `"language": "en"`
- **WHEN** the configuration is loaded
- **THEN** behavior is identical to the language field being absent

#### Scenario: Language field set to "fr"

- **GIVEN** `config.json` contains `"language": "fr"`
- **WHEN** the configuration is loaded
- **THEN** the effective language is `"fr"`
- **AND** the language directive is injected into user-facing system prompt paths
- **AND** every `t(key)` call returns the FR dictionary value, falling back to EN when a key is missing from FR

#### Scenario: Unsupported language code

- **GIVEN** `config.json` contains a `language` value not in the supported set (e.g. `"de"`)
- **WHEN** the configuration is loaded
- **THEN** the load SHALL fail with a descriptive error listing the supported codes
- **AND** the bot SHALL refuse to start

### Requirement: t() Translation Helper

The system SHALL expose a `t(key, vars?)` helper that performs a typed dictionary lookup against the configured language and interpolates `{var}`-style placeholders.

The helper SHALL:
- Resolve keys against the active-language dictionary, falling back to EN when the key is missing.
- Accept a second argument required if and only if the dictionary value for the key contains one or more `{var}` placeholders.
- Be statically type-checked: misspelled keys, missing variable arguments, missing required variables in the vars object, and unknown variables in the vars object are TypeScript compile errors.
- Replace every occurrence of `{var}` in the template with the stringified value supplied for `var`.

#### Scenario: Lookup with no placeholders

- **GIVEN** dictionary entry `"home.save": "Save"` (EN) and `"home.save": "Enregistrer"` (FR)
- **AND** the configured language is `"fr"`
- **WHEN** code calls `t("home.save")`
- **THEN** the helper returns `"Enregistrer"`

#### Scenario: Lookup with placeholders

- **GIVEN** dictionary entry `"home.welcome": "Welcome, {name}!"` (EN) and `"home.welcome": "Bienvenue, {name} !"` (FR)
- **AND** the configured language is `"fr"`
- **WHEN** code calls `t("home.welcome", { name: "François" })`
- **THEN** the helper returns `"Bienvenue, François !"`

#### Scenario: Numeric placeholder values are coerced

- **GIVEN** dictionary entry `"changes.pr_created": "PR #{number} ready"`
- **WHEN** code calls `t("changes.pr_created", { number: 123 })`
- **THEN** the helper returns `"PR #123 ready"`

#### Scenario: Missing key in active dictionary falls back to EN

- **GIVEN** dictionary entry `"home.new_section": "New section"` exists in EN
- **AND** the same key is absent from FR
- **AND** the configured language is `"fr"`
- **WHEN** code calls `t("home.new_section")`
- **THEN** the helper returns the EN value `"New section"`
- **AND** a development-mode warning identifying the missing key is logged at most once per key per process lifetime

#### Scenario: Type-level enforcement of keys (compile-time)

- **GIVEN** the helper is declared as `t<K extends keyof typeof en>(key: K, ...)`
- **WHEN** code calls `t("nonexistent.key")`
- **THEN** the TypeScript compiler reports an error and the build fails

#### Scenario: Type-level enforcement of variables (compile-time)

- **GIVEN** dictionary entry `"home.welcome": "Welcome, {name}!"`
- **WHEN** code calls `t("home.welcome")` (missing vars argument)
- **THEN** the TypeScript compiler reports an error
- **AND** when code calls `t("home.welcome", { typo: "X" })` the compiler reports `name` missing and `typo` unknown

#### Scenario: Helper called before config load

- **WHEN** `t(key)` is called before the configuration has been loaded (e.g. at module import time)
- **THEN** the helper SHALL treat the language as `"en"` and return EN values
- **AND** SHALL NOT throw

### Requirement: Dictionary File Layout and Placeholder Parity

Each supported language SHALL ship a dictionary module under `src/i18n/strings/<lang>.ts`. The EN dictionary is the source of truth (`as const` object literal). Every other dictionary SHALL be typed as `Record<keyof typeof en, string>`.

A parity test SHALL run as part of the standard test suite. For every non-EN dictionary, the test SHALL assert:
- The set of keys is identical to the EN dictionary.
- For every key, the set of `{var}` placeholder tokens in the translated string is identical to the set in the EN string.

The parity test SHALL fail the build when either condition is violated.

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

### Requirement: Claude Language Directive

When the configured language is not `"en"`, the user-facing system prompt path SHALL include a language directive that instructs Claude to produce all user-facing output (final responses, tool-call text fields delivered to users, status and error messages) in the configured language's native form.

The directive SHALL:
- Reference the language by both its English name and its native name (e.g. "French (Français)").
- Explicitly list user-facing output categories (final response, button labels in tool calls, status messages, errors).
- Instruct Claude to write idiomatically and avoid literal English-idiom translation.
- Preserve internal reasoning, tool names, file paths, code identifiers, and proper nouns in their original form.
- Be omitted from the pre-analysis prompt path (which produces internal reasoning, never shown to users).

The directive SHALL be omitted entirely when the configured language is `"en"` or absent — the prompt SHALL be byte-identical to its pre-localization form.

#### Scenario: Directive present when language is "fr"

- **GIVEN** the configured language is `"fr"`
- **WHEN** `buildSystemPrompt` assembles the user-facing system prompt
- **THEN** the resulting prompt contains the language directive
- **AND** the directive names the language as both "French" and "Français"

#### Scenario: Directive absent when language is "en"

- **GIVEN** the configured language is `"en"` (or absent)
- **WHEN** `buildSystemPrompt` assembles the user-facing system prompt
- **THEN** the resulting prompt does NOT contain a language directive
- **AND** the prompt is byte-identical to the pre-localization output

#### Scenario: Directive absent on pre-analysis prompt path

- **GIVEN** the configured language is `"fr"`
- **WHEN** the pre-analysis prompt is assembled
- **THEN** the resulting prompt does NOT contain a language directive

#### Scenario: Directive applies across trigger types

- **GIVEN** the configured language is `"fr"`
- **WHEN** Claude is invoked for a DM, mention, reaction, scheduled run, change-workflow run, or plugin-triggered run
- **THEN** every user-facing invocation receives a system prompt containing the directive

### Requirement: Language Metadata Registry

The system SHALL maintain a registry mapping each supported language code to its English name and native name, used by the directive renderer and any future locale-aware formatting.

#### Scenario: Registry covers every supported language

- **WHEN** a new language code is added to the supported set
- **THEN** the registry SHALL include an entry mapping the code to its English name and native name
- **AND** startup validation SHALL fail if any supported code lacks a registry entry

#### Scenario: Initial registry contents

- **WHEN** the system is initialized
- **THEN** the registry SHALL contain entries for `"en"` (English / English) and `"fr"` (French / Français)
