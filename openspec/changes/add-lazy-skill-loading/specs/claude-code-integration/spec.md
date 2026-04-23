## ADDED Requirements

### Requirement: Plugin Set Filtered by Lazy-Skill Registry

The session orchestrator SHALL filter the list of skill plugins passed to the Claude Agent SDK's `plugins` option, excluding any plugin whose `skillPlugins[name].lazyLoad === true` in `config.json`. Eager plugins (absent entry, or `lazyLoad: false`) SHALL continue to be passed via `--plugin-dir` exactly as before. The SDK's frozen-plugin-set contract is respected — once filtered, the set does not change for the life of the SDK session.

#### Scenario: Eager plugin passed at session start

- **GIVEN** `data/skill-plugins/other/` exists and has no `skillPlugins` entry
- **WHEN** `buildQuerySetup` assembles `options.plugins` for `query()`
- **THEN** the returned array contains `{ type: "local", path: "<…>/data/skill-plugins/other" }`

#### Scenario: Lazy plugin omitted from session start

- **GIVEN** `data/skill-plugins/marketingskills/` exists and `config.skillPlugins.marketingskills.lazyLoad === true`
- **WHEN** `buildQuerySetup` assembles `options.plugins`
- **THEN** the returned array does NOT contain an entry for `marketingskills`
- **AND** the SDK-spawned CLI does not receive `--plugin-dir` for that path
- **AND** none of `marketingskills`' 32 skill frontmatter entries appear in the baseline system prompt

#### Scenario: Filter is deterministic regardless of resume

- **GIVEN** a session is resumed via `resumeSessionId`
- **AND** `marketingskills` is tagged lazy
- **WHEN** `buildQuerySetup` runs for the resumed turn
- **THEN** `marketingskills` is still excluded — the lazy-filter is based on current registry state, not prior session state
