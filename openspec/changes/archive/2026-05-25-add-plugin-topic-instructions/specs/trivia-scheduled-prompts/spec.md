## MODIFIED Requirements

### Requirement: Schedule Prompts Are Thin Dispatchers

Cron jobs reconciled by `sdk.reconcileCronJobs("trivia", specs)` from `config.trivia.games[]` SHALL carry full prompts inlined by `buildGameSpecs()`. Each spec's `prompt` SHALL embed the game's `name` at the top (`"Game: <name>. ..."`) and pass `game: "<name>"` literally to every trivia tool call referenced in the prompt's step sequence.

Every spec produced by `buildGameSpecs()` SHALL set `attachedTopics: ["trivia"]` so that the trivia topic instructions (persona, reveal tone, season-finale tone — registered by the plugin via `sdk.addTopicInstruction("user", "trivia", ...)`) are loaded into the system prompt on every fire of a trivia-reconciled cron job. See the `plugin-topic-instructions` capability for the loading mechanism.

The prompt text itself SHALL come from constants in `src/plugins/trivia/scheduledPrompts.ts`:

- `SEND_QUESTIONS_INSTRUCTIONS` for the question-posting spec (`<name>:question`). The prompt remains the substantive Claude-driven flow for generating, validating, and posting a new question.
- `PROCESS_REVEAL_INSTRUCTIONS` for the reveal spec (`<name>:reveal`). This is a **renderer brief**, not a step-by-step orchestration prompt. It SHALL direct Claude to perform exactly two actions: (a) call `process_reveal_answers(game: "<name>")` and read its returned payload, then (b) render the payload as a Slack reveal via `submit_response` using the persona and tone described in the active `trivia` topic instructions.

Each constant SHALL contain a `{game}` placeholder (used at every tool-call step that takes a `game` arg, plus a header line). `buildGameSpecs()` SHALL substitute `{game}` with the spec's `name` before assigning to `CronJobSpec.prompt`.

The persona, reveal-tone, and season-finale wrap-up wording SHALL NOT be inlined in either prompt constant. Instead, both constants SHALL open with a short reference line (e.g., "Your persona, tone, and season-finale style are described in the `trivia` topic of your system instructions") and SHALL rely on the topic-loaded content to set Claude's voice.

The substantive step flow for the question post (research, polarity self-check, duplicate check, difficulty gate, save, format, deliver) SHALL be preserved. For the reveal, the prompt is structurally short — the deterministic work (find the pending question, fetch reactions, exclude bot + cheaters + multi-react voters, score answers, fetch the leaderboard, run season rollover when applicable) is performed inside `process_reveal_answers`; the prompt SHALL NOT enumerate these steps.

Content that SHALL remain inlined in `scheduledPrompts.ts` (NOT moved to topic instructions, because it couples to tool contracts or to detection logic that must not drift per workspace):

- Cheating-detection guidance — stays inlined; see the `trivia-cheating-detection` capability for the contract.
- Block-layout contracts (FIVE-BLOCK question structure for boolean/choice questions; reveal block structure including the `🏆 Round Summary` block format; season-finale insertion rules above the closer) — stay inlined, because they couple to the schemas of `post_questions` and `process_reveal_answers`.
- `GAME_CONTEXT_DIRECTIVE` (the context-priority preamble) — stays inlined for now; per-workspace context steering is already exposed via `config.trivia.contexts`.

The `getProcessResponsesInstructions(seasonsEnabled)` function, the `buildSeasonsAwarePrompt()` helper, the `SEASONS_CHECK_STEP` constant, and the `SEASONS_LEADERBOARD_OVERRIDE` constant SHALL remain removed (as established by the prior change that introduced thin-dispatcher reveal). The reveal prompt remains driven by the `seasonStatus` field of the tool's returned payload, with season-finale tone now sourced from the topic instructions rather than from inline `PROCESS_REVEAL_INSTRUCTIONS` wording.

#### Scenario: buildGameSpecs substitutes the game name and attaches the trivia topic

- **GIVEN** `config.trivia.games[]` contains `{ name: "main", questionCron: "0 9 * * *", revealCron: "0 17 * * *", timezone: "UTC", channel: "C123", enabled: true }`
- **WHEN** `buildGameSpecs([main], seasonsEnabled: false)` is called
- **THEN** the returned `specs` includes a `<name>:question` spec whose `prompt` contains the substring `Game: main` and references `game: "main"` at every tool-call step
- **AND** that spec has `attachedTopics: ["trivia"]`
- **AND** the returned `specs` includes a `<name>:reveal` spec whose `prompt` similarly contains `Game: main` and references `game: "main"` at every tool-call step
- **AND** that spec also has `attachedTopics: ["trivia"]`

#### Scenario: Trivia plugin registers persona, reveal-tone, and finale-tone topic instructions

- **WHEN** the trivia plugin's init function runs
- **THEN** it calls `sdk.addTopicInstruction("user", "trivia", "persona", <persona content>)`
- **AND** `sdk.addTopicInstruction("user", "trivia", "reveal-tone", <reveal-tone content>)`
- **AND** `sdk.addTopicInstruction("user", "trivia", "finale-tone", <finale-tone content>)`
- **AND** the registered files become virtual defaults overrideable at `data/configuration/user/topics/trivia/trivia__persona.md` (and the equivalent for the other two)

#### Scenario: Cron fire of a trivia spec loads the trivia topic into the system prompt

- **GIVEN** a reconciled job with `pluginManaged: true`, `plugin: "trivia"`, `attachedTopics: ["trivia"]`
- **AND** the plugin has registered persona, reveal-tone, and finale-tone virtual defaults under the `trivia` topic
- **WHEN** the cron tick fires the job
- **THEN** the assembled system prompt for the first Claude turn includes a `=== TOPIC: trivia ===` section
- **AND** that section contains the persona, reveal-tone, and finale-tone content concatenated in alphabetical filename order

#### Scenario: Admin override of the trivia persona takes effect on next fire

- **GIVEN** an admin creates `data/configuration/user/topics/trivia/trivia__persona.md` with custom content `"PERSONA: <custom>"`
- **WHEN** the next trivia cron job fires
- **THEN** the system prompt's `=== TOPIC: trivia ===` section contains `"PERSONA: <custom>"`
- **AND** does NOT contain the plugin-shipped default persona

#### Scenario: Disabled games are excluded from buildGameSpecs output

- **GIVEN** `config.trivia.games[]` contains `{ name: "retired", enabled: false, ... }` and `{ name: "main", enabled: true, ... }`
- **WHEN** `buildGameSpecs(games, ...)` is called
- **THEN** the returned `specs` includes `main:question` and `main:reveal`
- **AND** does NOT include `retired:question` or `retired:reveal`

#### Scenario: Per-game prompts are isolated from each other

- **GIVEN** `config.trivia.games[]` contains both `main` and `sandbox`
- **WHEN** `buildGameSpecs(games, ...)` is called
- **THEN** the `main:question` spec's prompt contains `game: "main"` and NOT `game: "sandbox"`
- **AND** the `sandbox:question` spec's prompt contains `game: "sandbox"` and NOT `game: "main"`

#### Scenario: Cheating detection text remains inlined in scheduledPrompts.ts

- **WHEN** `SEND_QUESTIONS_INSTRUCTIONS` and `PROCESS_REVEAL_INSTRUCTIONS` are inspected
- **THEN** cheating-detection guidance, the FIVE-BLOCK question layout, the reveal block layout, and the Round Summary block format remain present as inline content
- **AND** none of those sections are duplicated into the `trivia` topic
