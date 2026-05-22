## ADDED Requirements

### Requirement: Language Directive Injection in User-Facing Prompt Composition

When the configured language is not `"en"`, the user-facing system prompt composition pipeline (`buildSystemPrompt`) SHALL inject the language directive defined by the `localization` capability into the assembled prompt.

The directive SHALL be:
- Injected on every user-facing prompt path: Q&A queries (reactions, DMs, mentions, assistant), change-workflow runs (worker mode), scheduled-cron runs, plugin-triggered runs, follow-up runs, and PR-comment review runs.
- Omitted from the pre-analysis prompt path (which produces internal triage reasoning, never shown to users).
- Placed at the top of the assembled prompt, before any role-cascaded behavioral instructions, so that it functions as a top-level constraint rather than a tail addendum.
- Composed by reading the configured language code from `getConfig().language`, looking up the language metadata (EN name, native name) from the localization language registry, and rendering the directive template.

When the configured language is `"en"` (or absent), the prompt composition pipeline SHALL produce a prompt byte-identical to its pre-localization output. The directive renderer SHALL NOT emit blank lines, separators, or anchor comments when the directive is omitted.

#### Scenario: Directive injected on Q&A path when language is "fr"

- **GIVEN** the configured language is `"fr"`
- **WHEN** `buildSystemPrompt` is called for a DM, mention, reaction, or assistant Q&A run
- **THEN** the resulting prompt contains the rendered language directive
- **AND** the directive is positioned at the top of the assembled prompt, before any role-cascaded instructions

#### Scenario: Directive injected on change-workflow path when language is "fr"

- **GIVEN** the configured language is `"fr"`
- **WHEN** the change-workflow execution prompt is assembled (worker mode, follow-up, review, merge, close, update)
- **THEN** the assembled prompt contains the rendered language directive

#### Scenario: Directive injected on scheduled and plugin-triggered paths

- **GIVEN** the configured language is `"fr"`
- **WHEN** a scheduled cron job fires or a plugin-triggered run is invoked
- **THEN** the assembled prompt contains the rendered language directive

#### Scenario: Directive omitted on pre-analysis path

- **GIVEN** the configured language is `"fr"`
- **WHEN** the pre-analysis prompt is assembled (auto-respond rule evaluation, intent triage)
- **THEN** the assembled prompt does NOT contain a language directive
- **AND** pre-analysis output remains in English (internal reasoning, not user-facing)

#### Scenario: No directive and no whitespace artifact when language is "en"

- **GIVEN** the configured language is `"en"` (or absent)
- **WHEN** `buildSystemPrompt` runs
- **THEN** the assembled prompt is byte-identical to its pre-localization form
- **AND** the directive renderer contributes no blank lines, separators, or marker comments

#### Scenario: Directive uses native language name

- **GIVEN** the configured language is `"fr"`
- **WHEN** the directive is rendered
- **THEN** the rendered text refers to the language as both "French" and "Français"
- **AND** the source of the native name is the localization language registry, not a hard-coded literal in `buildSystemPrompt`
