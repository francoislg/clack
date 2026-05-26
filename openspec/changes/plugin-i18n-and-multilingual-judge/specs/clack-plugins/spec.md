## ADDED Requirements

### Requirement: Plugin SDK Localization

The `ClackSdk` SHALL expose two methods that let plugin code render user-facing text in the workspace's configured language without violating the plugin import boundary:

- `registerDictionary(dictionaries: { en: Record<string, string>; fr?: Record<string, string> }): void` — register the plugin's translation table. The `en` key is REQUIRED and is the authoritative source-of-truth for the plugin's key space. Other supported languages (initially `fr`) MAY be partial; absent keys fall back to the `en` value at lookup time. Calling `registerDictionary` twice on the same plugin's SDK SHALL replace the prior registration (last-write-wins, useful for hot-reload).
- `t(key: string, vars?: Record<string, string | number>): string` — look up `key` in THIS plugin's registered dictionary against the active workspace language (read from `getConfig().language`, defaulting to `"en"` when unset or unloadable). When `vars` is supplied, every occurrence of `{name}` in the resolved template SHALL be replaced with the stringified value of `vars.name`.

Both methods SHALL be scoped to the calling plugin by the SDK factory's captured `pluginName` — plugin A cannot read or overwrite plugin B's dictionary. The SDK SHALL NOT expose a way to pass the plugin name explicitly.

#### Scenario: Plugin reads its own dictionary

- **GIVEN** a plugin's SDK has registered `{ en: { hello: "Hello" }, fr: { hello: "Bonjour" } }` via `sdk.registerDictionary(...)`
- **AND** `getConfig().language` returns `"fr"`
- **WHEN** the plugin calls `sdk.t("hello")`
- **THEN** the call returns `"Bonjour"`

#### Scenario: Fallback to EN when language key missing

- **GIVEN** a plugin's SDK has registered `{ en: { hello: "Hello", goodbye: "Goodbye" }, fr: { hello: "Bonjour" } }`
- **AND** `getConfig().language` returns `"fr"`
- **WHEN** the plugin calls `sdk.t("goodbye")`
- **THEN** the call returns `"Goodbye"` (the EN value)
- **AND** a one-time warning is logged identifying the plugin and the missing key

#### Scenario: Default to EN when language is unset

- **GIVEN** a plugin's SDK has registered `{ en: { hello: "Hello" }, fr: { hello: "Bonjour" } }`
- **AND** `getConfig()` throws OR returns no `language` field
- **WHEN** the plugin calls `sdk.t("hello")`
- **THEN** the call returns `"Hello"` (the EN value)

#### Scenario: Variable interpolation

- **GIVEN** a plugin's SDK has registered `{ en: { greet: "Hi {name}, you have {n} new messages" } }`
- **WHEN** the plugin calls `sdk.t("greet", { name: "Alice", n: 3 })`
- **THEN** the call returns `"Hi Alice, you have 3 new messages"`

#### Scenario: Missing key throws

- **GIVEN** a plugin's SDK has registered `{ en: { hello: "Hello" } }`
- **WHEN** the plugin calls `sdk.t("nonexistent")`
- **THEN** the call throws an `Error` whose message names the plugin and the missing key

#### Scenario: Per-plugin dictionary isolation

- **GIVEN** plugin `trivia` has registered `{ en: { answered: "Answered" } }`
- **AND** plugin `weather` has registered `{ en: { answered: "Replied" } }` on its own SDK
- **WHEN** `trivia`'s `sdk.t("answered")` is called
- **THEN** it returns `"Answered"` regardless of what `weather` registered
- **AND** `weather`'s `sdk.t("answered")` returns `"Replied"`

#### Scenario: t() before registerDictionary

- **GIVEN** a plugin's SDK has NOT called `registerDictionary` yet
- **WHEN** the plugin calls `sdk.t("any-key")`
- **THEN** the call throws an `Error` whose message tells the plugin to call `registerDictionary` first
