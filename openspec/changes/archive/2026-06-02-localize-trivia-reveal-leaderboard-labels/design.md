## Context

The reveal prompt (`PROCESS_REVEAL_INSTRUCTIONS` in `src/plugins/trivia/prompts/scheduledPrompts.ts`) dictates the leaderboard `table` and season-finale podium structure to Claude. Several labels are given as fixed English literals that Claude is instructed to place verbatim into Slack cells / podium lines: `This Round`, `Current Season`, `All Time`, `First place` / `Second place` / `Third place`, and the `Participation:` tail.

Claude authors the table via `submit_response`, so by the project's path convention these are "via-Claude" strings that should re-render in the configured language through the LANGUAGE directive. In practice they don't: the LANGUAGE directive translates Claude's free prose, but a "use this exact string" instruction is followed verbatim — Claude copies the dictated token untranslated. Result: a French workspace shows English `Current Season` / `All Time`. By contrast, the two reveal labels the prompt *does* localize (`NEW SEASON`, `Current News`) work because they are phrased as "render per the LANGUAGE directive (English X, French Y)" rather than dictated literals.

The plugin already has an i18n dictionary (`src/plugins/trivia/i18n/strings.ts`, registered via `sdk.registerDictionary`) used for the code-rendered reveal-card footer, modal, and buttons through `sdk.t()`. The reveal prompt is currently a static `const` consumed by `buildGameSpecs(games, offDays)` (one call site, `src/plugins/trivia/index.ts:180`, where `sdk` is in scope).

## Goals / Non-Goals

**Goals:**
- Reveal leaderboard row labels and finale podium labels render in the configured language, deterministically and consistently across every reveal.
- Reuse the existing trivia i18n dictionary as the single source of truth, so these Claude-path labels share the translation surface already used for the code-rendered reveal-card strings.
- Keep English-workspace output byte-identical (no behavioral change when `lang === "en"`).

**Non-Goals:**
- Translating the free-prose reveal copy (closers, transitions, per-question verdicts, the all-time-table intro line) — that already works via the LANGUAGE directive and stays as-is.
- Touching the code-rendered reveal-card footer/modal localization (already correct).
- Any data, config, or migration change. No new languages beyond the existing en/fr.
- Reconciling the separate latent spec/code lag where `trivia-scheduled-prompts` still describes `NEW SEASON` / `Current News` as literals though the code localizes them — out of scope for this change.

## Decisions

### Decision: Pre-localize labels in the prompt (Option B) over instructing Claude to translate (Option A)

Two ways to fix it:

- **Option A — instruct Claude to translate.** Phrase each label like the existing `NEW SEASON` clause: "render per the LANGUAGE directive (English `Current Season`, French `Saison en cours`)". Pure prompt-text edit, zero plumbing. Rejected as the primary mechanism: it is non-deterministic — Claude may pick varying French wordings across reveals (`Cumulatif` vs `Total général`) and can still occasionally copy the English; the actual rendered label is not unit-testable.
- **Option B — pre-localize in code (chosen).** Build the prompt with the label tokens already translated, sourced from the trivia dictionary via `sdk.t()`. Claude copies the dictated token verbatim — the exact behavior causing today's bug becomes the delivery mechanism.

Option B is chosen because:
- These labels are structural tokens Claude copies verbatim — effectively direct-to-Slack strings, whose project convention is `sdk.t()`, not "let Claude translate."
- Deterministic and consistent across reveals; single source of truth (the en/fr tables).
- Unit-testable: assert the built prompt contains the FR label when `lang === "fr"`.
- Consistent with the already-localized code-rendered reveal-card labels (same dictionary).

### Decision: Convert the reveal prompt to a builder using the module-level translator

`PROCESS_REVEAL_INSTRUCTIONS` becomes `buildProcessRevealInstructions()` that interpolates the localized labels — both in the instruction text and in the worked table/podium examples, so a non-English workspace's examples show the localized labels and Claude cannot anchor on English example cells.

Labels resolve via the plugin's existing **module-level translator singleton** (`t` from `src/plugins/trivia/i18n/t.js`), wired to `sdk.t` by `setTriviaT(sdk.t)` at plugin init — the same pattern `renderHint.ts` / `hintButton.ts` already use. This is preferred over threading a translator parameter through `buildGameSpecs`: the call site (`index.ts:59` `setTriviaT` → `index.ts:180` `buildGameSpecs`) guarantees the translator is wired before the builder runs, so no parameter, no `buildGameSpecs` signature change, and no `index.ts` change are needed. The builder MUST be a function (not a `const`) because a top-level const would evaluate at module load, before `setTriviaT`, baking in the EN fallback.

The sibling question/prep/post prompt constants stay as constants (they have no fixed user-facing labels of this kind); only the reveal prompt moves behind the builder. Free prose in the reveal prompt remains untouched and continues to rely on the LANGUAGE directive. Existing tests that imported the const bind `const PROCESS_REVEAL_INSTRUCTIONS = buildProcessRevealInstructions()` (EN-fallback, since they never call `setTriviaT`), keeping their structural assertions unchanged.

### Decision: New dictionary keys under a `leaderboard.*` namespace

Add to `en` (and `fr`): `leaderboard.this_round`, `leaderboard.current_season`, `leaderboard.all_time`, `leaderboard.first_place`, `leaderboard.second_place`, `leaderboard.third_place`, `leaderboard.participation`. English values equal today's literals (`This Round`, `Current Season`, `All Time`, `First place`, `Second place`, `Third place`, `Participation`), guaranteeing byte-stable English output. French: `Ce tour`, `Saison en cours`, `Cumulatif`, `Première place`, `Deuxième place`, `Troisième place`, `Participation`. Plugin FR keys may be omitted to fall back to EN, but these are supplied explicitly (except `participation`, which is identical in both languages and so may rely on EN fallback).

## Risks / Trade-offs

- **Builder vs constant inconsistency.** The reveal prompt becomes a function while its siblings stay constants. Accepted — the reveal prompt is the only one with these fixed labels; threading a translator through all of them would be needless churn.
- **Example/instruction drift.** The worked examples must localize from the same keys as the instruction text; if one is localized and the other isn't, Claude could anchor on the un-localized form. Mitigated by sourcing both from the dictionary and by a test asserting the FR label appears in the built prompt (examples included).
- **French wording quality.** `Cumulatif` for "All Time" and `Ce tour` for "This Round" are translation choices; if they read awkwardly in-product they can be tuned in one place (the dictionary) without touching the prompt or spec.
- **Cron-spec rebuild timing.** The localized prompt is baked into the cron spec at `buildGameSpecs` time. This matches how tool labels are already resolved (once, at plugin registration); a language change requires the same restart those already require.
