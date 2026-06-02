## Context

The trivia plugin resolves ~16 configuration axes through a fixed cascade: `slot → season → game → workspace → built-in default`, first-defined-tier-wins. Today this cascade is expressed three times independently, with a fourth copy implied by any new consumer:

1. **What config accepts** — `parseTriviaAxisBag` + the `TriviaAxisBag` interface and `apply()` loop (`core/configParsers/axes.ts`).
2. **What production rolls** — ~8 inline `resolveX()` calls in `get_ideas` (`tools/questions/getIdeas.ts`), each calling a bespoke `domain/resolve*.ts` function.
3. **What audit surfaces** — `AxisOverrides` + `WorkspaceDefaults` projections in `list_games` (`tools/games/listGames.ts`).

Nothing ties these lists together at the type level, so they drift. Concrete evidence: `promptMedium` is resolved correctly by `get_ideas` (it passes `gameEntry` to `resolvePromptMedium`) but is **absent** from both `list_games` projections — admins cannot see it. The ~16 `domain/resolve*.ts` functions also have inconsistent signatures (`resolvePromptMedium(season, slotIndex, game, config)` vs `resolveHintConfig(slotIndex, season, game, workspace)` vs `resolveTheme(season, game)`), which is itself a symptom: they all implement the *same* algorithm but were each written by hand.

Constraints:
- **Zero behavior change** to question generation. Axis defaults and resolution outcomes must be byte-for-byte identical before/after.
- Plugin boundary rules (`src/plugins/CLAUDE.md`): no imports outside the plugin; tool descriptions/results stay English (VIA-CLAUDE).
- The refactor touches the hot path (`get_ideas`), so regression coverage is mandatory.

## Goals / Non-Goals

**Goals:**
- One source of truth for "what the cascading axes are," enforced by the TypeScript compiler — forgetting an axis in any consumer becomes a build error.
- A generic cascade walker that returns both the resolved value **and** the winning tier, so provenance is computed by the same code production uses (no separate "explain" logic that can disagree).
- A new `explain_cascade({ game, slot? })` audit tool answering "final value + which layer" per axis, at game and slot granularity.
- Collapse the ~16 hand-written resolvers into one generic walker plus a small set of `custom` exceptions.
- Fix the `promptMedium`-missing-from-`list_games` gap as a structural side effect.

**Non-Goals:**
- Changing any axis default, weight, or resolution precedence.
- Adding new axes, or changing the set of tiers.
- Reworking `upsert_game` / `upsert_season` / `set_workspace_config` mutation tools beyond what registry adoption requires.
- Refactoring the bot-core `cascading-config-resolver` (instruction resolution) — unrelated despite the name.

## Decisions

### D1. `CascadeAxes` interface as the single definition; tiers extend it

Define every cascading axis once:

```ts
// core/cascadeAxes.ts
export interface CascadeAxes {
  answersFormat?: TriviaAnswersFormatWeights;
  questionType?: TriviaQuestionTypeWeights;
  promptMedium?: PromptMediumWeights;
  freeformAnswerShape?: TriviaFreeformAnswerShapeWeights;
  contexts?: TriviaContextEntry[];
  difficulty?: TriviaDifficultyConfig;       // custom (per-field merge, answersFormat-keyed)
  difficultyRatio?: TriviaDifficultyRatioConfig; // custom (answersFormat-keyed)
  hint?: TriviaHintConfig;
  judgeLeniency?: JudgeLeniency;
  instructions?: string;                     // uniform first-wins
  additionalInstructions?: string;           // custom (CUMULATIVE across tiers)
  liveAnswersVisible?: boolean;              // uniform first-wins (post-time)
  revealResponses?: RevealResponsesMode;     // uniform first-wins (post-time)
}
```

**Membership rule:** a field is a `CascadeAxes` member iff it resolves through the **per-question cascade** — i.e. it participates in the slot/season tiers, not merely game+workspace. A complete sweep of every `resolve*`/`*Resolver` in `domain/` and `core/` yields:

- **Uniform first-wins (4-tier, generic walker) — 10:** `answersFormat`, `questionType`, `promptMedium`, `freeformAnswerShape`, `contexts`, `hint`, `judgeLeniency`, `instructions`, and `liveAnswersVisible` + `revealResponses`. The last two are resolved at **post time** (`core/liveAnswersResolver.ts`, `core/revealResponsesResolver.ts`) rather than at generation time, but they are 4-tier first-wins cascades — and they already take a `{ slot, season, game, config }` params object identical to `CascadeContext`, so they fold into the generic walker cleanly.
- **Custom (`kind: "custom"`, bespoke resolver, still compiler-required) — 3:**
  - `difficulty` — per-field merge, answersFormat-keyed; reports `tier: "merged"` when fields span tiers.
  - `difficultyRatio` — answersFormat-keyed first-wins.
  - `additionalInstructions` — **cumulative**: `resolveAdditionalInstructions` (`instructions.ts:52`) concatenates every contributing tier with `[Workspace]/[Game]/[Season]/[Slot]` labels rather than picking one. It reports `tier: "merged"`; routing it through the first-wins walker would be a regression — hence custom.

This means there are **two production consumers** of `resolveCascade`: `get_ideas` (the 8 generation axes + the 3 custom) and `post_questions` (`liveAnswersVisible`, `revealResponses`). Both call the same walker; provenance parity therefore covers post-time axes too.

**Deliberately excluded** (enumerated so the boundary is explicit, not silent):

- Identity fields: `name`, `channel`, crons, `timezone`, `enabled`.
- **Structural-special** fields with bespoke cascade semantics: `format` (slot composition), `categories` (pool resolution), `theme` (season→game narrative label).
- **`allTimeRow`** — resolves only `game → workspace → default` (`allTimeRow.ts:12`), never touching the slot/season per-question tiers. Per the membership rule it is a **per-game setting, not a cascade axis**; keeps its own `resolveAllTimeRow`, audited via `list_games`.
- **`choices`** — workspace-only bounds (`getActiveChoiceBounds`, no per-game/season/slot tiers); not a cascade.

All excluded fields stay on the individual tier types and out of `explain_cascade`'s registry view. Every tier type extends `CascadeAxes`: `interface TriviaGame extends CascadeAxes`, `SeasonEntry extends CascadeAxes`, `SeasonFormatSlot extends CascadeAxes`, `TriviaConfig extends CascadeAxes`. A member may still be set at only a subset of the per-question tiers; absent tiers read `undefined` and the walker skips them.

**Why:** because every tier shares `keyof CascadeAxes`, a generic walker can read any axis off any tier by key (`tier[key]`). This is the structural property that makes both the generic resolver and the compile-time check possible.

*Alternative considered:* a hand-maintained `type AxisKey = "promptMedium" | ...` union. Rejected — it's just a fifth hand-list; nothing forces it to match the tier fields.

### D2. `AXIS_REGISTRY satisfies Record<keyof CascadeAxes, AxisDef>` — the compile-time lock

```ts
type CascadeKind = "first-wins" | "custom";

interface AxisDef<K extends keyof CascadeAxes = keyof CascadeAxes> {
  kind: CascadeKind;
  default: NonNullable<CascadeAxes[K]>;
  // for "custom": a bespoke resolver that returns { value, tier, detail? }
  customResolve?: (ctx: CascadeContext) => CascadeResolution<CascadeAxes[K]>;
  // optional projection hint for explain/list display
}

export const AXIS_REGISTRY = {
  answersFormat: { kind: "first-wins", default: { boolean: 1, choice: 0, freeform: 0 } },
  promptMedium:  { kind: "first-wins", default: { text: 1, image: 0 } },
  difficulty:    { kind: "custom", default: DEFAULT_DIFFICULTY, customResolve: resolveDifficulty },
  // ...
} satisfies Record<keyof CascadeAxes, AxisDef>;
```

The `satisfies Record<keyof CascadeAxes, AxisDef>` is the load-bearing line: add a field to `CascadeAxes` without a registry entry and `npx tsc` fails. The typecheck already runs in the pre-commit hook, so this needs no new discipline.

### D3. Generic `resolveCascade` returns value + winning tier

```ts
type CascadeTier = "slot" | "season" | "game" | "workspace" | "default" | "merged";
// "merged" is reported only by custom per-field-merge axes (difficulty) when the
// resolved value drew fields from more than one tier; the ladder then records the
// supplying tier per field.

interface CascadeContext {
  slot: CascadeAxes | null;     // the resolved slot (season.format.questions[i] or game.format...)
  season: CascadeAxes | null;   // current active season entry, or null
  game: CascadeAxes | null;
  config: CascadeAxes | null;   // workspace tier
}

interface CascadeResolution<V> {
  value: V;
  tier: CascadeTier;
  ladder: Array<{ tier: CascadeTier; value: V | undefined; winner: boolean }>;
}

function resolveCascade<K extends keyof CascadeAxes>(
  key: K,
  ctx: CascadeContext,
): CascadeResolution<NonNullable<CascadeAxes[K]>> {
  const def = AXIS_REGISTRY[key];
  if (def.kind === "custom") return def.customResolve!(ctx) as ...;
  // first-wins: slot → season → game → workspace → default
  for (const tier of ["slot","season","game","workspace"] as const) {
    const v = ctx[tier]?.[key];
    if (v !== undefined) return { value: v, tier, ladder: buildLadder(...) };
  }
  return { value: def.default, tier: "default", ladder: buildLadder(...) };
}
```

`get_ideas` consumes `.value`; `explain_cascade` consumes `.value` + `.tier` + `.ladder`. Because they call the same function, they cannot disagree about what resolves or where. The `ladder` is built once and reused so the per-tier display and the winner are guaranteed consistent.

**Why first-wins-by-key is safe:** the existing `resolveX()` functions are all the identical walk; collapsing them removes 16 drift surfaces. We verify equivalence with characterization tests (see Migration).

### D4. Three `custom` axes, still registry-enforced

- **`difficulty`** merges per-field within a tier (the one documented merge exception in CLAUDE.md) and is keyed by `answersFormat`. It cannot use the pure first-wins walk.
- **`difficultyRatio`** is answersFormat-keyed first-wins.
- **`additionalInstructions`** is **cumulative** — `resolveAdditionalInstructions` concatenates every contributing tier with `[Workspace]/[Game]/[Season]/[Slot]` labels rather than picking one. First-wins would drop all but one tier, a regression — so it is custom.

All three stay registry entries with `kind: "custom"`, pointing at their existing (lightly adapted) resolver — so the compiler still forces their presence and `explain_cascade` still renders them. Their `customResolve` returns the same `{ value, tier, ladder }` shape, reporting `tier: "merged"` when the result spans more than one tier (the ladder then records the supplying tier per field for `difficulty`, or per segment for `additionalInstructions`). **Decision (resolved):** `explain_cascade` takes an optional `answersFormat` argument; for the `answersFormat`-keyed axes (`difficulty`, `difficultyRatio`) it renders the resolution for **every** `answersFormat` value by default, or for the single supplied value when the argument is given. This keeps the default audit view complete while allowing a focused query.

### D5. `TriviaAxisBag` derives from `CascadeAxes`; parser stays validator-driven

The parser still needs per-axis validators (zod + semantic checks) — that logic is real and not collapsible. `CascadeAxes` members are parsed through **more than one path**: the weighted axes flow through `parseTriviaAxisBag` (which `TriviaAxisBag` types), while the flat axes (`hint`, `judgeLeniency`) and string axes (`instructions`, `additionalInstructions`) are parsed directly in `parseTriviaGames` and the season/workspace parsers. (`allTimeRow` is parsed directly too but is NOT a `CascadeAxes` member — see D1 — so it is outside this parity set.) So `TriviaAxisBag` becomes `Pick<CascadeAxes, ...the-weighted-axes>`, and the parity guard asserts that the **union** of all parser-accepted `CascadeAxes` keys (weighted bag + directly-parsed flat/string axes) equals `keyof CascadeAxes` — not just `TriviaAxisBag` keys. That closes the "axis added to a tier but not parseable / not registry-listed" hole regardless of which parse path owns the axis.

### D6. `explain_cascade` is a read-only tool on the always-on default server

`list_games` registers on the default server (`index.ts:126`), not the `trivia:management` on-demand handle. `explain_cascade` is read-only auditing of the same data, so it registers there too, gated like `list_games`. Output is a plain JSON envelope (VIA-CLAUDE, English) of `{ game, slot, axes: { <axis>: { value, tier, ladder } } }`.

## Risks / Trade-offs

- **[Hot-path regression in `get_ideas` and `post_questions`]** → Add characterization tests that snapshot resolution outcomes for both consumers (`get_ideas` for the generation axes, `post_questions` for `liveAnswersVisible`/`revealResponses`) across a representative config matrix (seasons on/off, format present/absent, overrides at each tier) *before* the refactor, then assert identical outcomes after. Land them first.
- **[`custom` axes erode the guarantee]** → They're still `Record<keyof CascadeAxes>` keys, so presence is compiler-enforced; only their *internal* logic is bespoke. Keep the custom set to the three documented axes (`difficulty`, `difficultyRatio`, `additionalInstructions`).
- **[Resolver signature churn ripples widely]** → Collapsing 13 resolvers (10 first-wins + 3 custom) touches many call sites across `get_ideas` and `post_questions`. Mitigate by keeping thin deprecated shims (`resolvePromptMedium = (s,i,g,c) => resolveCascade("promptMedium", toCtx(s,i,g,c)).value`) during migration, then removing them in a final cleanup step so each commit stays green.
- **[`CascadeAxes` accidentally gains a non-axis field]** → Review convention + the structural parser-parity test catch most cases; document that only true cascading axes belong on `CascadeAxes`.

## Migration Plan

1. Land characterization tests for `get_ideas`, `post_questions`, and `list_games` resolution outcomes (pre-refactor snapshot).
2. Introduce `core/cascadeAxes.ts` (`CascadeAxes`, `AxisDef`, `AXIS_REGISTRY`, `CascadeContext`) and `domain/resolveCascade.ts` — additive, nothing consumes them yet.
3. Make tier types `extends CascadeAxes`; fix any resulting type errors (should be none if fields already match).
4. Repoint `get_ideas` to `resolveCascade`, keeping thin shims for the old resolvers. Run characterization tests — must be identical.
5. Repoint `post_questions` to `resolveCascade` for `liveAnswersVisible`/`revealResponses` (the `core/*Resolver.ts` param object already matches `CascadeContext`). Run characterization tests — must be identical.
6. Repoint `list_games` to project from the registry (auto-fixes `promptMedium`).
7. Add `explain_cascade` tool + tests.
8. Derive `TriviaAxisBag`/parser from `CascadeAxes`; add the parser-parity structural test.
9. Remove the deprecated resolver shims; delete now-dead `domain/resolve*.ts` + `core/liveAnswersResolver.ts` + `core/revealResponsesResolver.ts` bodies.

Rollback: each step is independently revertible; steps 2–3 are inert until step 4 wires them in.

## Resolved Decisions (formerly open)

- **Gate level for `explain_cascade`**: `member`, matching `list_games` (which is `member`-gated, verified at `src/plugins/trivia/index.ts:126`). It is a read-only audit of the same data.
- **`difficulty` rendering in `explain_cascade`**: optional `answersFormat` argument; renders every `answersFormat` value by default, the single supplied value when given (see D4).
- **Shim lifetime**: remove all old `resolveX` exports in this change (migration step 8) for a clean single source. The shims kept in steps 4–7 are internal-to-plugin only; the plugin boundary (`src/plugins/CLAUDE.md`) means there are no external consumers to preserve.

## Open Questions

- None outstanding. (All three prior open questions resolved above during spec review.)
