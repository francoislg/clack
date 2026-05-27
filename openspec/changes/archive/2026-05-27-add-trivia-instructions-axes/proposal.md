## Why

Trivia admins want an escape hatch for ad-hoc guidance ("use shorter questions", "never generate questions about numbers", "favor Quebec angles this month") without us having to invent a new structured axis for every preference. They also want both **override** semantics (workspace baseline replaced by a more specific tier) and **augment** semantics (workspace baseline kept, lower tiers stack on top) so guidance can be either swapped or layered as the situation calls for.

## What Changes

- Introduce two new cascading free-form-string axes on the trivia plugin:
  - `instructions` — **replace cascade**. Highest-precedence non-empty tier wins. Same semantics as the existing `theme` field.
  - `additionalInstructions` — **cumulative cascade**. Every non-empty tier is concatenated in `workspace → game → season → slot` order, each segment prefixed with a short tier label (`[Workspace]`, `[Game]`, `[Season]`, `[Slot N]`).
- Both axes cascade across the full four tiers (`slot → season → game → workspace`) already used by every other trivia axis.
- Surface both axes to Claude at exactly two points: the `get_ideas` MCP tool response (consumed by the question-generation prompt) and the `process_reveal_answers` MCP tool response (consumed by the reveal prompt). NOT injected into broader bot context, trivia topic instructions, or any other scheduled prompt.
- Mutation surfaces (`set_workspace_config`, `upsert_game`, `upsert_season`) accept both new args with `nullable+optional` zod shape and `null`-to-clear / omit-to-keep semantics.
- Read surfaces (`list_games`, `list_seasons`) surface both fields under the present-iff-set rule, at the slot level inside `list_seasons` as well.

## Capabilities

### New Capabilities

- `trivia-prompt-instructions`: Defines the two free-form guidance axes (`instructions` and `additionalInstructions`), their four-tier cascade rules (replace vs cumulative), the resolver contract, and the consumer contract that the question-generation prompt and the reveal prompt MUST honor when the resolved values are present.

### Modified Capabilities

- `trivia-games`: Add the two new axes to the per-game and workspace-tier configuration shape; document their cascade tier (game tier of `instructions`, workspace tier of `additionalInstructions`, etc.).
- `trivia-seasons`: Add the two new axes to `SeasonEntry` and to `SeasonFormatSlot`; document their cascade tier (season tier and slot tier).
- `trivia-management-tools`: Add `instructions` and `additionalInstructions` args to `set_workspace_config`, `upsert_game`, and `upsert_season` (nullable + optional, `null`-to-clear / omit-to-keep). Add both fields to `list_games` and `list_seasons` output under the present-iff-set rule, including slot level for `list_seasons`.
- `trivia-scheduled-prompts`: Document that the question-generation prompt receives `instructions` and `additionalInstructions` via `get_ideas` and MUST honor both throughout the run when present.
- `trivia-reveal-processor`: Document that the reveal prompt receives `instructions` and `additionalInstructions` on the `process_reveal_answers` payload and MUST honor both during reveal rendering when present.

## Impact

- **Code**: New domain resolver under `src/plugins/trivia/domain/instructions.ts` plus tests. New normalizer + zod schema additions in `src/plugins/trivia/core/configParsers/format.ts`. Type additions in `core/configTypes.ts` and `core/types.ts`. Parser updates in `core/configParsers/games.ts` and `core/configBridge.ts`. Tool updates in `tools/games/upsertGame.ts`, `tools/games/setWorkspaceConfig.ts`, `tools/games/listGames.ts`, `tools/seasons/upsertSeason.ts`, `tools/seasons/listSeasons.ts`, `tools/questions/getIdeas.ts`, `tools/reveal/processRevealAnswers.ts`, `tools/reveal/types.ts`. Prompt copy updates in `prompts/scheduledPrompts.ts`.
- **Config schema**: New optional fields on `TriviaConfig`, `TriviaGame`, `SeasonEntry`, `SeasonFormatSlot`. Backward compatible — absent at every tier means the axes are no-ops (`null` returned by the resolver, fields omitted from tool payloads).
- **No migration needed**: All new fields are optional; existing on-disk config files remain valid.
- **No dependencies added**.
- **Tests**: New domain resolver test file plus targeted additions to existing parser, tool, and integration tests.
