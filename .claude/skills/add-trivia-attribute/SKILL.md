---
name: add-trivia-attribute
description: "Add a new cascading attribute (axis) to the trivia plugin — walks through every config tier, validator, MCP read/write tool, roll/stamp site, and test so no layer is forgotten. Use when adding a trivia axis like judgeLeniency, promptMedium, or any per-tier override axis."
---

# Add Trivia Cascading Attribute

## Orientation: What Is a Cascading Attribute?

A **cascading attribute** is a configuration knob that can be set (or overridden) at multiple tiers in trivia, with a fixed precedence order: **slot → season → game → workspace → built-in default**. The first tier that supplies a value wins; absent tiers cascade downward until a tier or the default is found. Each axis resolves independently — all six existing axes compose multiplicatively. A new axis touches ~20 files across types, validators, config parsers, MCP tools, domain resolvers, record persistence, and tests.

## Decision Tree: Flat-Object vs Weighted-Roll

Before starting the checklist, decide your axis's **resolution strategy**:

1. **Whole-object resolve (flat axis)** — The axis cascades a single composite value, swapping the whole object per tier. Example: `hint: { mode: "button", minDifficulty: "easy" }`. Used when the value is a bundle of related fields that must be consistent (all-or-nothing override per tier).
   - Resolver function shape: **Parameter order varies by axis.** See Layer 2 for verified examples.
   - Roll by `get_ideas`: NO — value is resolved and used directly.
   - Stamp on question record: OPTIONAL (only if it affects question generation or reveal behavior).
   - Zod schema pattern: `z.object({ ... })` with enum/tuple sub-fields, no `.array()`.
   - **NOTE:** Flat axes (like `hint`, `judgeLeniency`) are NOT added to `TriviaAxisBag` (see Layer 3).

2. **Weighted-roll random axis** — The axis cascades a map of options to weights; `get_ideas` randomly picks one option. Example: `answersFormat: { boolean: 1, choice: 1, freeform: 0 }`. Used when each generation run should sample from configured possibilities.
   - Resolver function shape: `resolveAnswersFormat(currentSeason, slotIndex, game, triviaConfig): TriviaAnswersFormatWeights` (see Layer 2 for verified signature).
   - Roll by `get_ideas`: YES — called inside `createGetIdeasTool`, result rolled via `weightedPick(weights)`, returned in response payload as `suggestedAnswersFormat`.
   - Stamp on question record: YES — axes rolled by `get_ideas` are stamped on save so mid-config edits don't retroactively change question meaning.
   - Zod schema pattern: `z.object({ key1: integerWeight, key2: integerWeight, ... })` where `integerWeight = z.number().int().nonnegative().optional()`.
   - **NOTE:** Weighted axes belong in `TriviaAxisBag` (see Layer 3).

## Hard Rules

- **Default preserves current behavior** — Every axis defaults such that existing deployments are byte-for-byte unchanged until an admin opts in. Set the built-in default to the legacy behavior (e.g., `answersFormat` defaults to boolean-only, `promptMedium` defaults to text-only).
- **Cascade order is always slot → season → game → workspace → default** with **whole-value replace per tier** (no field-level merging across tiers). Only `difficulty` merges per-field within a tier; that's an exception documented in its own code.
- **i18n rule**: Management-tool descriptions and tool results are VIA-CLAUDE → stay English (per `src/plugins/CLAUDE.md`). Tool descriptions, field labels, and error messages are consumed by Claude, not Slack users. Never route them through `sdk.t()` or `t()`.
- **Stamp-on-record tradeoff**: Weighted-roll axes MUST be stamped (so `answersFormat: "boolean"` on the record means that question was generated with boolean rules, even if config later changed). Flat axes SHOULD be stamped only if they affect reveal-time behavior (e.g., `revealResponses`, `hint`); skip stamping if the value is purely for generation guidance (e.g., `instructions`).
- **Test at creation** — Every layer gets a test file at the same time. The project convention is per-axis test files: `axis.test.ts`, `configParsers/axis.test.ts`, `getIdeas.axis.test.ts`, `saveQuestion.axis.test.ts`, `upsertGame.axis.test.ts`, `upsertSeason.axis.test.ts`, `setWorkspaceConfig.axis.test.ts`, `listGames.axis.test.ts`. Match existing naming.

---

## Checklist

### Layer 1: Type Definitions

**File: `src/plugins/trivia/core/configTypes.ts`**

- [ ] Add the **type alias** for the axis's **weighted-roll keys** (if weighted). Example:
  ```typescript
  export type MyAxisWeights = Record<"option1" | "option2", number>;
  ```
  Or for flat axes, the **interface** for the whole value:
  ```typescript
  export interface MyAxisConfig {
    field1: string;
    field2?: number;
  }
  ```

- [ ] Add the **DEFAULT constant** for the built-in fallback. Example:
  ```typescript
  export const DEFAULT_MY_AXIS_WEIGHTS: MyAxisWeights = { option1: 1, option2: 0 };
  export const DEFAULT_MY_AXIS_CONFIG: MyAxisConfig = { field1: "none" };
  ```

- [ ] Add the axis as an **optional field on all four cascade tiers** (in order):
  1. `SeasonFormatSlot` — the highest-precedence per-slot override (if applicable; omit if no per-slot override makes sense).
  2. `SeasonEntry` — per-season tier.
  3. `TriviaGame` — per-game tier between season and workspace.
  4. `TriviaConfig` — workspace tier (the global default before built-in fallback).

  Example additions:
  ```typescript
  // Inside SeasonFormatSlot:
  myAxis?: MyAxisWeights;

  // Inside SeasonEntry:
  myAxis?: MyAxisWeights;

  // Inside TriviaGame:
  myAxis?: MyAxisWeights;

  // Inside TriviaConfig:
  myAxis?: MyAxisWeights;
  ```

### Layer 2: Domain Resolver

**File: `src/plugins/trivia/domain/<axisnamen>.ts`** (create a new file)

- [ ] Create a **pure resolver function** that walks the cascade and returns the resolved value. **IMPORTANT: Resolver parameter order is NOT standardized — it varies per axis.** Below are two verified real examples; match the parameter order of whichever existing resolver you are mirroring:

  **Flat axis example (hint)** — from `src/plugins/trivia/domain/hint.ts` line 13:
  ```typescript
  export function resolveHintConfig(
    slotIndex: number | null,
    currentSeason: SeasonEntry | null,
    game: TriviaGame | null,
    workspace: TriviaConfig | null,
  ): TriviaHintConfig {
    if (slotIndex !== null && currentSeason?.format) {
      const slot = currentSeason.format.questions[slotIndex];
      if (slot?.hint !== undefined) return slot.hint;
    }
    if (currentSeason?.hint !== undefined) return currentSeason.hint;
    if (game?.hint !== undefined) return game.hint;
    if (workspace?.hint !== undefined) return workspace.hint;
    return { mode: "none" };
  }
  ```

  **Weighted-roll axis example (promptMedium)** — from `src/plugins/trivia/domain/promptMediums.ts` line 18:
  ```typescript
  export function resolvePromptMedium(
    currentSeason: SeasonEntry | null,
    slotIndex: number | null,
    game: TriviaGame | null,
    triviaConfig: TriviaConfig | null,
  ): PromptMediumWeights {
    if (currentSeason !== null && slotIndex !== null && currentSeason.format !== undefined) {
      const slot = currentSeason.format.questions[slotIndex];
      if (slot?.promptMedium !== undefined) return slot.promptMedium;
    }
    if (currentSeason?.promptMedium !== undefined) return currentSeason.promptMedium;
    if (game?.promptMedium !== undefined) return game.promptMedium;
    if (triviaConfig?.promptMedium !== undefined) return triviaConfig.promptMedium;
    return DEFAULT_PROMPT_MEDIUM_WEIGHTS;
  }
  ```

  Choose the signature style matching your axis type and match the parameter order exactly.

- [ ] If the axis is **weighted-roll**, also add a `getActiveMyAxis` function that loads season state (since seasons enable/disable at runtime). **Use this verified signature from `src/plugins/trivia/domain/promptMediums.ts` line 46:**
  ```typescript
  export async function getActivePromptMedium(
    scoped: ScopedTriviaDataLayer,
    triviaConfig: TriviaConfig | null,
    now: number,
    game: TriviaGame | null,
  ): Promise<PromptMediumWeights> {
    const seasonsEnabled = triviaConfig?.seasons?.enabled ?? false;
    let current: SeasonEntry | null = null;
    if (seasonsEnabled) {
      const state: SeasonsState | null = await scoped.loadSeasonsState();
      current = findCurrentSeason(state, now);
    }
    return resolvePromptMedium(current, null, game, triviaConfig);
  }
  ```

- [ ] Add unit tests in `<axisnamen>.test.ts` covering:
  - Slot precedence (when season has a format and slot sets the axis).
  - Season precedence (when season is active and sets the axis, game/workspace fall through).
  - Game → workspace → default cascade.
  - Empty/null cases (season is null, no format, etc.) — should fall through gracefully.
  - For weighted-roll: verify `getActiveMyAxis` correctly enables/disables seasons.

### Layer 3: Config Parser and Validator

**File: `src/plugins/trivia/core/configParsers/axes.ts`**

**CRITICAL BRANCHING RULE:** Weighted-roll axes that flow through `parseTriviaAxisBag` belong in `TriviaAxisBag` + the apply loop. **Flat axes (like `hint` and `judgeLeniency`) are handled separately and MUST NOT be added to `TriviaAxisBag`.** The real `TriviaAxisBag` interface (line 484) contains only: `answersFormat`, `questionType`, `promptMedium`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`. Flat axes are resolved by standalone functions and validated/saved directly by management tools.

**For weighted-roll axes only:**

- [ ] Add the **`*_KEYS` constant** listing allowed values:
  ```typescript
  export const MY_AXIS_KEYS = ["option1", "option2"] as const;
  ```

- [ ] Add the **validation function**, mirroring `validateAnswersFormatMap`:
  ```typescript
  export function validateMyAxisMap(
    raw: unknown,
    fieldLabel: string,
  ): Result<MyAxisWeights> {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `'${fieldLabel}' must be an object` };
    }
    const out: Partial<MyAxisWeights> = {};
    let positiveCount = 0;
    for (const [key, value] of Object.entries(raw)) {
      if (!(MY_AXIS_KEYS as readonly string[]).includes(key)) {
        return {
          ok: false,
          error: `'${fieldLabel}' contains unknown key '${key}' (allowed: ${MY_AXIS_KEYS.join(", ")})`,
        };
      }
      if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
        return {
          ok: false,
          error: `'${fieldLabel}.${key}' must be a non-negative integer (got ${JSON.stringify(value)})`,
        };
      }
      out[key as (typeof MY_AXIS_KEYS)[number]] = value;
      if (value > 0) positiveCount++;
    }
    if (positiveCount === 0) {
      return { ok: false, error: `'${fieldLabel}' must have at least one strictly positive weight` };
    }
    return { ok: true, value: { option1: out.option1 ?? 0, option2: out.option2 ?? 0 } };
  }
  ```

- [ ] Add the axis to the **`TriviaAxisBag` interface**:
  ```typescript
  export interface TriviaAxisBag {
    // ... existing axes (answersFormat, questionType, promptMedium, freeformAnswerShape, contexts, difficulty, difficultyRatio)
    myAxis?: MyAxisWeights;
  }
  ```

- [ ] Add the axis to the **`parseTriviaAxisBag` function**'s `apply` loop:
  ```typescript
  apply("myAxis", raw.myAxis, validateMyAxisMap, (v) => {
    axes.myAxis = v;
  });
  ```

- [ ] Add the **zod schema** in the `axisFieldsZod` map:
  ```typescript
  export const myAxisZod = z.object({
    option1: integerWeight,
    option2: integerWeight,
  } satisfies WeightShape<(typeof MY_AXIS_KEYS)[number]>);

  export const axisFieldsZod = {
    // ... existing
    myAxis: myAxisZod,
  } as const;
  ```

**For flat axes only (e.g., `hint`, `judgeLeniency`):**

- [ ] Add the **validation function** mirroring `validateHintConfig` (does NOT go in `parseTriviaAxisBag` — management tools call it directly).
- [ ] Add the **zod schema** to `axisFieldsZod` so management tools can shape-check Claude input (e.g., `triviaJudgeLenencyZod`).
- [ ] Do NOT add the axis to `TriviaAxisBag` or the `apply` loop.

- [ ] Add tests in `src/plugins/trivia/core/configParsers/myAxis.test.ts` covering:
  - Valid weight maps normalize correctly (missing keys → 0, present keys preserved).
  - Invalid inputs (non-object, array, unknown keys, negative weights, all-zero map) → error.
  - Error messages are specific and actionable.

### Layer 4: Write Tools (Management)

Write tools are where admins mutate the axis. Three tools handle this:

#### Tool 4a: `upsert_game.ts`

**File: `src/plugins/trivia/tools/games/upsertGame.ts`**

- [ ] Import the axis's **zod schema** and **validator** at the top:
  ```typescript
  import { myAxisZod, validateMyAxisMap } from "../../core/configParsers/axes.js";
  ```

- [ ] Add the axis to the **zod input schema** (inside the `z.object({ ... })`):
  ```typescript
  myAxis: myAxisZod.nullable().optional().describe("...description..."),
  ```

- [ ] In the **mutation logic** (where the game is updated), apply the validator:
  ```typescript
  if (args.myAxis !== undefined && args.myAxis !== null) {
    const result = validateMyAxisMap(args.myAxis, "myAxis");
    if (!result.ok) return errorResult(result.error);
    updatedGame.myAxis = result.value;
  }
  ```

- [ ] Add tests in `upsertGame.myAxis.test.ts` covering:
  - Setting `myAxis` on a new game.
  - Updating `myAxis` on an existing game.
  - Clearing `myAxis` (null → omit from saved game).
  - Invalid inputs are rejected with clear errors.

#### Tool 4b: `upsert_season.ts`

**File: `src/plugins/trivia/tools/seasons/upsertSeason.ts`**

- [ ] Same changes as `upsertGame`: import schema/validator, add to zod object, add validator call in mutation logic.
- [ ] **IMPORTANT**: `upsertSeason` has TWO branches — one for **create** (`POST /seasons`) and one for **update** (`PATCH /seasons/{slug}`). Both must handle the axis field. Check the file for the pattern and apply it symmetrically.
- [ ] Also handle the axis on **slot tier** inside the format (if the axis is per-slot-overridable). Example:
  ```typescript
  // Inside the slot zod schema:
  myAxis: myAxisZod.nullable().optional().describe("..."),
  ```

- [ ] Add tests in `upsertSeason.myAxis.test.ts` covering create, update, and slot-tier cases.

#### Tool 4c: `setWorkspaceConfig.ts`

**File: `src/plugins/trivia/tools/games/setWorkspaceConfig.ts`**

- [ ] Same changes as `upsertGame`: import, add to zod, add validator.
- [ ] This tool mutates workspace-tier defaults only (no game, season, or slot tiers).

- [ ] Add tests in `setWorkspaceConfig.myAxis.test.ts`.

### Layer 5: Read Tool (List/Audit)

**File: `src/plugins/trivia/tools/games/listGames.ts`**

This tool surfaces the cascaded axis values for audit. **Surface axes that affect generation or scoring.** The real `AxisOverrides` interface (line 26-33) contains: `answersFormat`, `questionType`, `freeformAnswerShape`, `contexts`, `difficulty`, `difficultyRatio`. **KNOWN GAP:** `promptMedium` is missing entirely (a pre-existing bug — don't replicate it). Separately, `hint` surfaces at line 172 on `ListGamesEntry`. 

Add your axis to both surfaces if it affects generation/scoring:

- [ ] **`AxisOverrides` interface** (if your axis is weighted-roll and affects generation):
  ```typescript
  interface AxisOverrides {
    // ... existing (answersFormat, questionType, freeformAnswerShape, contexts, difficulty, difficultyRatio)
    myAxis?: MyAxisWeights;
  }
  ```

- [ ] **`axisOverrides` mapping logic** (inside the `entries` map, around line 116):
  ```typescript
  const axisOverrides: AxisOverrides = {
    // ... existing
    ...(g.myAxis !== undefined ? { myAxis: g.myAxis } : {}),
  };
  ```

- [ ] **`WorkspaceDefaults` interface** (if your axis has workspace-tier defaults):
  ```typescript
  interface WorkspaceDefaults {
    // ... existing (answersFormat, questionType, freeformAnswerShape, contexts, difficulty, difficultyRatio, choices, seasons, offDays, instructions, additionalInstructions, hint, allTimeRow)
    myAxis?: MyAxisWeights;
  }
  ```

- [ ] **`workspaceDefaults` mapping logic** (around line 178):
  ```typescript
  const workspaceDefaults: WorkspaceDefaults = {
    // ... existing
    ...(triviaCfg?.myAxis !== undefined ? { myAxis: triviaCfg.myAxis } : {}),
  };
  ```

- [ ] Add tests in `listGames.myAxis.test.ts` covering game overrides and workspace defaults.

### Layer 6: Roll & Stamp (get_ideas & save_question)

Only for **weighted-roll axes**. Skip this layer for flat axes.

#### Tool 6a: `getIdeas.ts`

**File: `src/plugins/trivia/tools/questions/getIdeas.ts`**

- [ ] Import the axis's domain resolver:
  ```typescript
  import { getActiveMyAxis } from "../../domain/myAxis.js";
  ```

- [ ] Inside the tool implementation, call the resolver to get weights:
  ```typescript
  const myAxisWeights = await getActiveMyAxis(scoped, triviaConfig, now, gameEntry);
  ```

- [ ] Roll a suggestion using `weightedPick`:
  ```typescript
  const suggestedMyAxis = weightedPick(myAxisWeights);
  ```

- [ ] Add to the returned object (the payload Claude receives). **Note the naming convention:** the ROLLED field returned here is named `suggestedXxx` (e.g., `suggestedPromptMedium`), but when STAMPED on the question record it becomes just `xxx` (e.g., `promptMedium`):
  ```typescript
  return textResult({
    // ... other fields
    suggestedMyAxis,
    // ... other fields
  });
  ```

- [ ] Update the **DESCRIPTION** docstring to document the new field. Example from real code (line 51):
  ```
  - \`suggestedPromptMedium\`: \`"text"\` or \`"image"\` — picked INDEPENDENTLY from active promptMedium weights (slot → season → game → workspace → \`{ text: 1, image: 0 }\` default).
  ```

- [ ] Add tests in `getIdeas.myAxis.test.ts` covering:
  - Roll respects workspace defaults.
  - Roll respects game overrides.
  - Roll respects season overrides.
  - Roll respects slot overrides (when format is present).
  - Absent axis cascades to built-in default correctly.
  - Weighted picks are sampled proportionally (statistical check with large sample).

#### Tool 6b: `saveQuestion.ts`

**File: `src/plugins/trivia/tools/questions/saveQuestion.ts`**

- [ ] Inside the tool implementation, extract the rolled value from the `get_ideas` response (passed as tool argument or context):
  ```typescript
  // From the input:
  const myAxis = args.suggestedMyAxis;
  ```

- [ ] Validate it against the axis's allowed values:
  ```typescript
  if (myAxis !== undefined && !["option1", "option2"].includes(myAxis)) {
    return errorResult(`Invalid suggestedMyAxis: ${myAxis}`);
  }
  ```

- [ ] **Stamp it on the question record** when saving:
  ```typescript
  const question: TriviaQuestion = {
    // ... other fields
    myAxis,
    // ... other fields
  };
  ```

- [ ] Add tests in `saveQuestion.myAxis.test.ts` covering:
  - Roll is stamped on save.
  - Invalid rolls are rejected.
  - Stamped value survives config mutation (mid-run config change doesn't affect already-stamped question).

### Layer 7: Question Record Type

**File: `src/plugins/trivia/core/types.ts`**

Only for **weighted-roll axes** that are stamped. Skip for flat axes unless they affect reveal behavior.

- [ ] Add the axis as an **optional field on `TriviaQuestion`**:
  ```typescript
  /**
   * The rolled option for this question. Stamped by save_question at
   * generation time so mid-config edits don't retroactively change question meaning.
   * Absence reads as the legacy default ("option1").
   */
  myAxis?: "option1" | "option2";
  ```

- [ ] Add a JSDoc comment explaining when it's present, what it means, and what absence means (legacy read).

### Layer 8: Find/Query Surfaces

**File: `src/plugins/trivia/tools/questions/findPreviousQuestions.ts`**

**Convention:** Surface axes that affect GENERATION or SCORING. The real `toSearchResult` function (line 16-45) surfaces: `answersFormat`, `questionType`, `promptMedium`, `media`, `postedAt`, `messageLink`, `processedAt`, `season`, `slot`, `suggestedDifficulty`, `difficulty`, `context`, `sourceUrl`, `eventDate`, plus answer-type-specific fields. Axes like `hint` are deliberately excluded because they are internal-only with no scoring impact.

- [ ] If your axis affects generation or scoring (like `difficulty` or `judging behavior`), add it to the returned result:
  ```typescript
  if (q.myAxis !== undefined) result.myAxis = q.myAxis;
  ```

- [ ] Add a test in `findPreviousQuestions.test.ts` verifying the axis surfaces in search results when present.

- [ ] **Do NOT surface purely internal axes** (e.g., cosmetic instructions with no scoring impact).

### Layer 9: Documentation

**File: `CLAUDE.md`**

- [ ] Add a **paragraph** in the "Trivia question generation: four-axis composition" section documenting the new axis. Follow the existing pattern:
  ```
  **`myAxis: "option1" | "option2"`** — controls XYZ behavior. Cascade: `slot.myAxis → season.myAxis → game.myAxis → workspace.myAxis → { option1: 1, option2: 0 } default`. [Additional details about when this axis is used, constraints, etc.]
  ```

- [ ] Add the axis to the **Structural per-game overrides** block if applicable (rarely needed; usually only for structural knobs like `format`, `categories`, `theme`).

- [ ] Update the **Hint axis documentation** block if your new axis interacts with hints (e.g., a difficulty-related axis). Add cross-references.

---

## Final Verification Checklist

After implementing all layers:

1. **Type check**: Run `npx tsc` — should emit zero errors. This catches missing imports, type mismatches across files, and typos in type names.

2. **Test suite**: Run `npm test` — all tests (existing + new) should pass. Pay special attention to:
   - `src/plugins/trivia/domain/*.test.ts` — resolver unit tests.
   - `src/plugins/trivia/core/configParsers/*.test.ts` — validator and zod tests.
   - `src/plugins/trivia/tools/**/*.test.ts` — all management and read tool tests.

3. **Grep for completeness**: Ensure no file was missed:
   ```bash
   grep -r "answersFormat" src/plugins/trivia --include="*.ts" | wc -l
   grep -r "myAxis" src/plugins/trivia --include="*.ts" | wc -l
   ```
   The second count should be roughly similar to the first (adjusting for axis age/features). Missing greps indicate forgotten touch-points.

4. **Semantic check**: Manually audit the cascade in one write tool (e.g., `upsertGame`) and one read tool (e.g., `listGames`). Ensure:
   - Every tier (slot, season, game, workspace) is handled.
   - Defaults are applied.
   - Validators are called before save.
   - Error messages are clear.

5. **Config file load**: Place a test axis value in `data/plugins/trivia/config.json` (workspace tier) and restart the bot. Verify:
   - No parsing errors.
   - `list_games` surfaces the value in `workspaceDefaults`.
   - `get_ideas` (if weighted) rolls from it.

---

## Worked Example: Adding `judgeLeniency`

Suppose we're adding a new **flat-axis** `judgeLeniency` that controls how strictly the reveal-time judge scores freeform answers. The value is a bare `string` enum (`"strict"` | `"strict-with-typos"` | `"lenient"`), cascades slot → season → game → workspace → `"strict-with-typos"` default (whole-value replace per tier), is resolved-and-stamped at `save_question` time (no `get_ideas` roll needed), and affects reveal-time scoring.

### Types (`configTypes.ts`)
```typescript
export type JudgeLeniency = "strict" | "strict-with-typos" | "lenient";

export const JUDGE_LENIENCY_KEYS = ["strict", "strict-with-typos", "lenient"] as const;

export const DEFAULT_JUDGE_LENIENCY: JudgeLeniency = "strict-with-typos";

// Add to SeasonFormatSlot, SeasonEntry, TriviaGame, TriviaConfig:
judgeLeniency?: JudgeLeniency;
```

### Resolver (`domain/judgeLeniency.ts`)
```typescript
export function resolveJudgeLeniency(
  slotIndex: number | null,
  currentSeason: SeasonEntry | null,
  game: TriviaGame | null,
  workspace: TriviaConfig | null,
): JudgeLeniency {
  if (slotIndex !== null && currentSeason?.format) {
    const slot = currentSeason.format.questions[slotIndex];
    if (slot?.judgeLeniency !== undefined) return slot.judgeLeniency;
  }
  if (currentSeason?.judgeLeniency !== undefined) return currentSeason.judgeLeniency;
  if (game?.judgeLeniency !== undefined) return game.judgeLeniency;
  if (workspace?.judgeLeniency !== undefined) return workspace.judgeLeniency;
  return DEFAULT_JUDGE_LENIENCY;
}
```

### Parser (`configParsers/axes.ts`)
```typescript
export function validateJudgeLeniency(raw: unknown, fieldLabel: string): Result<JudgeLeniency> {
  if (typeof raw !== "string") {
    return { ok: false, error: `'${fieldLabel}' must be a string` };
  }
  if (!(JUDGE_LENIENCY_KEYS as readonly string[]).includes(raw)) {
    return {
      ok: false,
      error: `'${fieldLabel}' must be one of ${JUDGE_LENIENCY_KEYS.join(", ")} (got "${raw}")`,
    };
  }
  return { ok: true, value: raw as JudgeLeniency };
}

// In axisFieldsZod (do NOT add to TriviaAxisBag):
export const judgeLeniencyZod = z.enum(JUDGE_LENIENCY_KEYS as readonly [JudgeLeniency, ...JudgeLeniency[]]);

export const axisFieldsZod = {
  // ... existing weighted axes
  judgeLeniency: judgeLeniencyZod,
} as const;
```

### Write Tools (example: `upsertGame.ts`)
```typescript
import { judgeLeniencyZod, validateJudgeLeniency } from "../../core/configParsers/axes.js";

// In zod schema:
judgeLeniency: judgeLeniencyZod.nullable().optional().describe("Judge leniency mode for freeform answers..."),

// In mutation logic:
if (args.judgeLeniency !== undefined && args.judgeLeniency !== null) {
  const result = validateJudgeLeniency(args.judgeLeniency, "judgeLeniency");
  if (!result.ok) return errorResult(result.error);
  updatedGame.judgeLeniency = result.value;
}
```

### Stamp at Save (`saveQuestion.ts`)
```typescript
// Inside save_question: resolve the axis from the cascade and stamp on the record
const resolvedJudgeLeniency = resolveJudgeLeniency(slotIndexForResolution, currentSeasonEntry, gameEntry, config);

const finalQuestion = {
  ...outcome.question,
  judgeLeniency: resolvedJudgeLeniency,
  // ... other stamped fields
};

await scoped.saveQuestion(finalQuestion);
```

### Read Tools (`listGames.ts` and `findPreviousQuestions.ts`)
```typescript
// In AxisOverrides and workspaceDefaults (per Layer 5):
...(g.judgeLeniency !== undefined ? { judgeLeniency: g.judgeLeniency } : {}),

// In findPreviousQuestions toSearchResult (per Layer 8, because judgeLeniency affects scoring):
if (q.judgeLeniency !== undefined) result.judgeLeniency = q.judgeLeniency;
```

### Question Record Type (`types.ts`)
```typescript
export interface TriviaQuestion {
  // ... existing fields
  judgeLeniency?: JudgeLeniency; // Stamped at save_question; absent = strict-with-typos
}
```

### Tests

Create test files mirroring Layer 2–8, covering cascade, validation, stamp-on-save, and read/write surfaces.

### CLAUDE.md

Add a note under "Trivia question generation: four-axis composition":
```
**`judgeLeniency`** — controls how strictly the reveal-time judge scores freeform answers. Cascades `slot.judgeLeniency → season.judgeLeniency → game.judgeLeniency → workspace.judgeLeniency → "strict-with-typos"` (preserves current behavior). Values: `"strict"` (exact/near-exact only), `"strict-with-typos"` (default — tolerates minor typos), `"lenient"` (semantic variants OK). Flat axis (not in TriviaAxisBag). Resolved and stamped at `save_question` time; the reveal-time judge reads the stamp. Does not affect generation.
```

---

## Tips & Gotchas

- **Empty vs absent**: In JSON, omitted fields read as `undefined` in TypeScript. Always check `field !== undefined` before considering a tier, not just `field` (which is falsy for `0`, `false`, `null`).
- **Format presence**: When an axis is per-slot-overridable, ALWAYS check `currentSeason.format !== undefined` before accessing `currentSeason.format.questions[slotIndex]` — format may not exist.
- **Zod vs validator**: The zod schema (`triviaJudgeLenencyZod`) shape-checks Claude's JSON input. The validator function (`validateJudgeLenencyConfig`) enforces semantic rules (enum membership, required fields, range bounds). Both are needed; both layers are called.
- **Tool description length**: Keep descriptions concise but complete. Tool descriptions are read by Claude, not humans — prioritize clarity for an AI reader. Refer to existing axes for tone.
- **Test file naming**: Match the existing convention exactly. `<axis>.test.ts` for domain, `configParsers/<axis>.test.ts` for parser, `tools/<layer>.<axis>.test.ts` for tool layers.
- **Don't over-test fields**: Test the happy path, error cases, and cascade behavior. Don't test the entire question-save flow just because the axis is new — mock dependencies aggressively to keep tests focused.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Type 'undefined' is not assignable to type 'TriviaMyAxisConfig'" | Check that your field is marked as `?:` (optional) on the type, not mandatory. |
| "Cannot find module '../domain/myAxis.js'" | Verify the file is created and the import path matches the file location exactly (including `.js` extension). |
| "Zod schema keys don't match validator keys" | The zod schema shape and the `*_KEYS` const must have the same keys. Use `satisfies` to enforce this (`as const satisfies Record<K, ...>`). |
| "listGames doesn't surface my axis on games" | Ensure you added it to BOTH the `AxisOverrides` interface AND the mapping logic (the `...(g.myAxis !== undefined ? ... : {})` spread). |
| "Test fails: 'myAxis is not a known field'" | Check that you added the field to `TriviaAxisBag` in `axes.ts`, and that `parseTriviaAxisBag` includes an `apply` call for it. |
| "tsc errors about missing game/season/workspace parameters" | Verify your resolver function signature matches the pattern exactly: `(season, slotIndex, game, workspace): Type`, with the exact parameter names and types. |

