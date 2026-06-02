## Why

The trivia cascade (`slot → season → game → workspace → built-in default`) is hand-maintained in four disconnected places with no compiler link between them: the config parser (`parseTriviaAxisBag`/`TriviaAxisBag`), the ~8 inline `resolveX()` calls in `get_ideas`, and the `AxisOverrides`/`WorkspaceDefaults` projections in `list_games`. Any new tool that resolves the cascade becomes a fifth copy. This already produced a real defect: `promptMedium` resolves correctly at runtime but is entirely absent from `list_games`, so admins cannot audit it. Every new axis is another chance to forget a copy. We also have no way to answer the operational question "for slot 0 of game X, what value wins for each axis and at which tier?"

## What Changes

- Introduce a single `CascadeAxes` interface as the **one** definition of cascading axes. Every tier type (`TriviaGame`, `SeasonEntry`, `SeasonFormatSlot`, `TriviaConfig`) extends it.
- Introduce `AXIS_REGISTRY satisfies Record<keyof CascadeAxes, AxisDef>` — adding a field to `CascadeAxes` without a matching registry entry becomes a **compile error** (`npx tsc` fails). This is the sync lock.
- Introduce a generic `resolveCascade<K>(key, { slot, season, game, config }): { value, tier }` walker that implements the single first-defined-tier-wins algorithm and reports the **winning tier** natively. It collapses the ~16 near-identical `resolveX()` resolvers (the two irregular ones stay `kind: "custom"`, see below).
- Route `get_ideas`, `list_games`, and the new tool through the registry / `resolveCascade`. No consumer keeps its own axis list.
- Add a new read-only MCP tool **`explain_cascade({ game, slot? })`** that returns, per axis, the final resolved value, the winning tier, and the per-tier ladder — usable at the game level and the slot/question level.
- Fix the `promptMedium` audit gap as a side effect (once `list_games` reads the registry, every registry axis surfaces).
- Two documented exceptions remain registry entries marked `kind: "custom"` so the compiler still forces their presence: `difficulty` (merges per-field within a tier) and `difficulty`/`difficultyRatio` (depend on the rolled `answersFormat`).
- Add a structural guard test asserting the parser's accepted axis keys equal `keyof CascadeAxes`, closing the "axis added to a tier without going through `CascadeAxes`" hole.
- **No behavior change to question generation** — axis defaults and resolution outcomes are byte-for-byte preserved; this is a structural refactor plus a new audit tool.

## Capabilities

### New Capabilities
- `trivia-cascade-registry`: the single-source-of-truth `CascadeAxes` definition, the compile-time-checked `AXIS_REGISTRY`, the generic `resolveCascade` walker that reports value + winning tier, and the `explain_cascade` audit tool (game- and slot-level).

### Modified Capabilities
- `trivia-games`: the cascade-resolution contract now mandates that all axis resolution and all axis audit surfaces flow through the shared registry, and that `list_games` surfaces every registry axis (closing the `promptMedium` omission).

## Impact

- **New code**: `src/plugins/trivia/core/cascadeAxes.ts` (interface + registry + `AxisDef`), `src/plugins/trivia/domain/resolveCascade.ts` (generic walker), `src/plugins/trivia/tools/games/explainCascade.ts` (new tool), plus tests.
- **Refactored**: `core/configTypes.ts` (tiers extend `CascadeAxes`), `core/configParsers/axes.ts` (`TriviaAxisBag` derives from `CascadeAxes`), `tools/questions/getIdeas.ts` (resolve via registry), `tools/games/listGames.ts` (project via registry), the ~16 `domain/resolve*.ts` resolvers (collapsed or adapted).
- **Tool surface**: one new always-on default-server tool (`explain_cascade`), gated like `list_games`. Tool descriptions/results stay English (VIA-CLAUDE path).
- **Risk**: the refactor touches the hot generation path (`get_ideas`); regression coverage must prove identical resolution outcomes before/after.

## Resolved Decisions

- **Gating tier for `explain_cascade`**: `member`, matching `list_games` (verified `member`-gated at `src/plugins/trivia/index.ts:126`), on the always-on default server. Read-only audit of the same data.
- **`difficulty` presentation in `explain_cascade`**: the tool takes an optional `answersFormat` argument; it renders `difficulty`/`difficultyRatio` for every `answersFormat` value by default, or for the single supplied value when given.
- **CascadeAxes membership**: a field is a member iff it resolves through the per-question (slot/season) cascade. Members = weighted axes + flat axes (`hint`, `judgeLeniency`) + string axes (`instructions`, `additionalInstructions`). Custom resolution for `difficulty`, `difficultyRatio`, and the **cumulative** `additionalInstructions`. Deliberately excluded: `format`/`categories`/`theme` (structural) and **`allTimeRow`** (game+workspace only — a per-game setting, not a cascade axis); all audited via `list_games`/`list_seasons`. See design D1.
