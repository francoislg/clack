## Context

The trivia cascade resolves through `slot → season → game → workspace → default`. After the cascade-registry refactor, *resolution* is centralized in `resolveCascade(key, ctx)`, but the `CascadeContext` itself — specifically `ctx.slot` (the per-slot tier object) — is still constructed by hand at every call site:

- `get_ideas`: `ctx.slot = currentSeason?.format?.questions[i]` (season-only)
- `explain_cascade`: same (season-only)
- `post_questions`: `ctx.slot = slotFromSeason ?? slotFromGame` (effective)

Meanwhile `resolveActiveCategories` reads the slot from the **effective format** (`resolveEffectiveFormat` = `season.format ?? game.format`). So per-game-format slots already drive categories/labels and the post-time axes, but NOT the generation axes. The asymmetry is invisible (no error) and is exactly the "hand-maintained, drifting" pattern the registry was meant to eliminate — pushed up from resolution into context construction.

Separately, the write path has no notion of shadowing: `upsert_game` writes the game tier and returns, even when an active season override masks the field. The data model already supports sparse seasons (omit-to-inherit, null-to-clear), and `explain_cascade`/`resolveCascade` now make "is this field shadowed?" a trivial query — but nothing wires that into the write flow or the admin instruction.

Constraints: plugin boundary rules (no imports outside the plugin; tool descriptions/results stay English). Resolution precedence, axis membership, and the season-wins-when-present format model do not change. Behavior must be byte-for-byte preserved for season-format and no-format paths.

## Goals / Non-Goals

**Goals:**
- One `buildCascadeContext(season, game, slotIndex)` helper; all three consumers use it. The slot-tier policy (read from the effective format) is decided ONCE.
- Game-format slot axis overrides take effect (consistency with categories + post-time axes).
- `upsert_game` deterministically surfaces season shadowing of the fields it just wrote.
- Admin guidance makes the game tier the default write target; seasons stay sparse.

**Non-Goals:**
- A new cascade tier (no `season-slot → game-slot → …` 6-tier chain).
- Changing resolution precedence, axis membership, or the effective-format model.
- Auto-clearing season overrides without the admin's explicit confirmation.
- Reworking `upsert_season`'s existing omit/null semantics (they already fit).

## Decisions

### D1. One `buildCascadeContext`, slot from the effective format

```ts
// domain/cascadeContext.ts (or alongside resolveCascade)
function buildCascadeContext(
  season: SeasonEntry | null,
  game: TriviaGame | null,
  slotIndex: number | null,
): CascadeContext {
  const fmt = resolveEffectiveFormat(season, game);          // season.format ?? game.format
  const slot = slotIndex !== null && fmt !== null ? (fmt.questions[slotIndex] ?? null) : null;
  return { slot, slotIndex, season, game, config: <workspace> };
}
```

The slot tier now reads from whichever format is actually driving the fire. `get_ideas`, `post_questions`, and `explain_cascade` all call this. `post_questions` already used the effective slot, so it's unchanged; `get_ideas` and `explain_cascade` gain game-format slot overrides.

*Alternative considered:* a 6-tier chain that layers game-format slots beneath season-format slots even when a season format is active. Rejected — when a season format is present it REPLACES the game format (`resolveEffectiveFormat`), and slot indices need not correspond between the two formats, so layering them is ambiguous. The effective-format model keeps a single, well-defined slot source.

### D2. Shadowing detection on `upsert_game`

`upsert_game` writes the GAME tier, so a written field is "shadowed" when a tier **strictly above** `game` supplies a value for it — i.e. `season`, or (for a game with its own `format`, when no season format is active) a per-slot override. Detection is by **raw higher-tier field presence** (`domain/shadowing.ts`), which is exactly the winning-tier-above-game condition (a higher tier setting the field is what makes it win) and is uniform across first-wins and custom axes — avoiding the `answersFormat` argument `resolveCascade` requires for `difficulty`/`difficultyRatio`:

```ts
function detectGameWriteShadowing(writtenFields, season, game): ShadowReport | undefined {
  for (const field of writtenFields) {
    if (field === "format") { if (season?.format !== undefined) seasonShadowed.push("format"); continue; }
    if (season?.[field] !== undefined) { seasonShadowed.push(field); continue; }
    // a game's OWN format slot can mask its top-level axis (only when no season format)
    if (season?.format === undefined && game.format?.questions.some((q) => q[field] !== undefined))
      slotShadowed.push(field);
  }
  // season shadowing reported alone; slot only when nothing season-shadowed
  return seasonShadowed.length ? { tier: "season", slug: season.slug, fields: seasonShadowed }
       : slotShadowed.length  ? { tier: "slot", fields: slotShadowed }
       : undefined;
}
```

`shadowedBy.fields` is a **string array** of the shadowed field names — `"format"` appears as a string pseudo-field (resolved via `resolveEffectiveFormat`, not the axis registry). The response is `{ ...game, shadowedBy?: { tier: "season" | "slot", slug?: string, fields: string[] } }` (`slug` present only for season shadowing; omitted entirely when nothing is shadowed — e.g. no active season AND no masking slot, including the gap window between seasons). The tool only DETECTS and REPORTS; it never mutates the season. Result text stays English (VIA-CLAUDE). The common case is season shadowing (the admin's edit is masked by an active season); the slot case catches a game that masks its own top-level axis with a format-slot override.

### D3. "Apply to current season" clears, not copies

When the admin confirms they want a shadowed game edit to take effect now, Claude calls `upsert_season(slug, { <field>: null })` — clearing the season override so it falls through to the new game value. This keeps the season holding only genuine, intentional deltas. Copying the value into the season (the alternative) would create redundant state that silently drifts from the game on the next game edit.

### D4. Game-authoritative write guidance

Generalize the existing category guidance ("omit `categories`, inherit from the game") to ALL axes and `format` in `TRIVIA_GAMES_ADMIN_INSTRUCTION` / the management instruction: default every configuration edit to `upsert_game`; reach for `upsert_season` ONLY when the admin explicitly scopes a change to *this season* (a themed event, a one-off). When a game edit is shadowed, surface it and offer the clear-the-season path. This is mostly instruction text — the highest-leverage, lowest-risk piece.

## Risks / Trade-offs

- **[Slot-policy change alters behavior]** → Only for deployments that already set axis overrides on game-format slots (a silent no-op today). Land characterization tests over (season-format / game-format / no-format) × overrides-at-each-tier first; assert season-format and no-format outcomes are identical before/after, and that game-format slot overrides newly resolve.
- **[Shadowing check adds cost to `upsert_game`]** → One `resolveCascade` per written field against in-memory config; negligible.
- **[Claude over-prompts on shadowing]** → Only surface shadowing when a season override actually masks a field the admin just changed; no prompt when the game write took effect.
- **[Context-builder centralization touches the hot path]** → `get_ideas`/`post_questions` repoint to the helper; equivalence guarded by the existing cascade tests + the new characterization matrix.

## Migration Plan

1. Land characterization tests for `get_ideas` + `post_questions` over the format matrix (pre-change snapshot of season-format / no-format paths).
2. Add `buildCascadeContext`; repoint `get_ideas`, `explain_cascade`, `post_questions`. Run characterization — season-format/no-format identical; add a test that game-format slot overrides now resolve.
3. Add shadowing detection to `upsert_game` (+ tests for shadowed / not-shadowed / format-shadow).
4. Update `TRIVIA_GAMES_ADMIN_INSTRUCTION` / management instruction with game-authoritative guidance + the shadowing→clear-season flow.
5. Docs: CLAUDE.md note on the effective-format slot policy + game-authoritative writes.

Rollback: each step independently revertible; step 2 is the only behavior shift.

## Open Questions

- Resolved here unless you object: keep the effective-format slot model (D1, no 6-tier chain); tool-surfaced shadowing detection (D2); clear-not-copy on apply-to-season (D3).
