## Why

The freeform reveal judge encodes leniency as a fixed edit-distance budget ("~1–2 characters off"). That proxy breaks on answers where the player clearly KNEW the answer but wrote it loosely — numeral-for-word ("20" for "Vingt"), homophones ("lieux" for "lieues"), or several small slips across a long, distinctive title ("20 mille lieux sous les mers" for "Vingt mille lieues sous les mers"). The single hard-coded tolerance can't serve both a collision-prone city name and a one-of-a-kind book title, and admins have no way to tune it.

## What Changes

- Introduce a new cascading trivia axis **`judgeLeniency`** with three presets: `strict`, `strict-with-typos` (current behavior), and `lenient`. Cascades `slot → season → game → workspace → default`, whole-value replace per tier. Default `strict-with-typos` needs no migration and changes no preset for existing deployments — it preserves the prior judge behavior for named-entity answers and extends the same typo/loose-writing grace to the other freeform shapes (where typo tolerance was previously absent).
- Refactor the judge prompt from monolithic shape-block strings into **named rule fragments composed into preset arrays** (`strict = [CASE, SUBSTITUTION, DECADE, PLURAL]`, `strictWithTypos = [...strict, TYPO, LOOSE_WRITING]`, `lenient = [KNOWS_IT]`). The leniency preset swaps only the fuzzy-tolerance fragment; structural guards (multi-guess, too-broad, materially-different) stay universal.
- Resolve `judgeLeniency` from the cascade at `save_question` time and **stamp it on the question record**, so a question is judged by the policy in effect when it was posed (immune to mid-cycle config drift).
- Thread the stamped level into `judgeAnswer` / `judgeSubmissions` / `buildSingleJudgePrompt` at reveal time.
- Surface and configure the axis through the trivia management MCP tools: writable on `upsert_game`, `upsert_season` (incl. slot tier), and `set_workspace_config`; readable per-game and under `workspaceDefaults` in `list_games`. The three valid presets are self-documenting in each tool's enum schema.

## Capabilities

### New Capabilities
- `trivia-judge-leniency`: The cascading `judgeLeniency` axis — its three presets, the named-fragment prompt-composition structure, cascade resolution, default-preserves-behavior rule, record stamping, and the MCP read/write surface.

### Modified Capabilities
- `trivia-freeform-questions`: The reveal judge's prompt is now parameterized by the resolved leniency preset instead of a fixed typo budget; the per-question record carries a `judgeLeniency` stamp that drives judging.

## Impact

- **Plugin code** (`src/plugins/trivia/`): `core/configTypes.ts` (type + 4 tiers + default), new `domain/judgeLeniency.ts` resolver, `core/configParsers/axes.ts` (keys + zod + validator), `freeform/judge.ts` (fragment refactor + `level` param), `answerTypes/freeform.ts` + `tools/reveal/` (thread level through), `tools/games/{upsertGame,setWorkspaceConfig,listGames}.ts`, `tools/seasons/upsertSeason.ts`, `tools/questions/saveQuestion.ts`, `core/types.ts` (record stamp), `tools/questions/findPreviousQuestions.ts` (audit surface).
- **Docs**: `CLAUDE.md` trivia axis section.
- **No migration**: absent stamp/config reads as `strict-with-typos`; no data rewrite needed.
- **No i18n**: judge prompt and tool descriptions are VIA-CLAUDE → stay English.
- Reference implementation guide: the `add-trivia-attribute` skill (flat-object, stamp-on-record variant).
