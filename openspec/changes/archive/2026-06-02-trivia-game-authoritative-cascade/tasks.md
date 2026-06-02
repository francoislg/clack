## 1. Characterization safety net (land first)

- [x] 1.1 Add characterization tests for `get_ideas` slot resolution across the format matrix: (season-format / game-format / no-format) × (axis overrides at slot/season/game/workspace). Snapshot resolved value + tier for ALL cascading axes (answersFormat, questionType, promptMedium, freeformAnswerShape, contexts, difficulty, difficultyRatio, hint, judgeLeniency, instructions, additionalInstructions) BEFORE the change
- [x] 1.2 Add the equivalent snapshot for `post_questions` (`liveAnswersVisible`/`revealResponses`) over the same matrix
- [x] 1.3 Run `npm test` — confirm snapshots pass against current code (documents today's behavior, including the game-format-slot drop)

## 2. Centralized context-builder (the slot-policy fix)

- [x] 2.1 Add `buildCascadeContext(season, game, slotIndex, config)` near `resolveCascade`; slot reads the effective format via `resolveEffectiveFormat(season, game)` (`season.format ?? game.format`)
- [x] 2.2 Unit-test `buildCascadeContext`: season-format slot wins when season has a format; **game-format slot is returned when the game has a format and no season format is active** (proves it reads the effective format, not season-only); no-format → slot null; out-of-range index → null slot
- [x] 2.3 Repoint `get_ideas` to `buildCascadeContext` (replaces the inline season-only slot construction)
- [x] 2.4 Repoint `explain_cascade` to `buildCascadeContext`
- [x] 2.5 Repoint `post_questions` to `buildCascadeContext` (already effective-format — confirm byte-identical)
- [x] 2.6 Re-run §1 characterization: season-format + no-format outcomes MUST be identical; ADD an assertion that a game-format slot axis override now resolves at tier `slot`
- [x] 2.7 Run the full `get_ideas`/`post_questions` suites — all green
- [x] 2.8 Update tool DESCRIPTIONs that now misstate the slot policy: `explain_cascade`'s description currently claims "per-slot axis overrides are read from the active SEASON's format only … matching runtime" (`explainCascade.ts`) — rewrite to "the EFFECTIVE format (season ?? game)". Audit `get_ideas`/`post_questions` descriptions for the same wording

## 3. Shadowing detection on upsert_game

- [x] 3.1 After the game write in `upsert_game`, for each written cascading-axis field resolve `resolveCascade(field, ctx)` and collect fields whose winning tier is strictly ABOVE `game` — `season` (resolve at the game-level / slot-null coordinate) or, when the game has a `format`, `slot` (resolve each effective-format slot; a game's own slot can mask its top-level axis). Per design D2
- [x] 3.2 Detect `format` shadowing via `resolveEffectiveFormat` (season format present while the call wrote `game.format`)
- [x] 3.3 Include `shadowedBy: { tier: "season" | "slot", slug?, fields: string[] }` when non-empty (`fields` is a string array; `"format"` is a string pseudo-field entry; `slug` only for `tier: "season"`); omit otherwise. Result text stays English (VIA-CLAUDE)
- [x] 3.4 Tests: season-shadowed axis field, shadowed `format` (string in `fields`), game-own-slot shadows top-level axis (`tier: "slot"`, no `slug`), unshadowed edit (no `shadowedBy`), gap window / no active season + no masking slot (no `shadowedBy`)

## 4. Game-authoritative write guidance

- [x] 4.1 Update `TRIVIA_GAMES_ADMIN_INSTRUCTION` / the management instruction: default config edits to the game tier; write a season override ONLY when the admin explicitly scopes to a season; generalize the existing "omit categories, inherit from game" guidance to all axes + `format`
- [x] 4.2 Document the shadowing→clear-season flow: on `shadowedBy`, surface it and offer "apply to the current season too?"; on yes, `upsert_season(slug, { <field>: null })` (clear, not copy)
- [x] 4.3 No i18n action expected: this change adds no direct-to-Slack strings — the shadowing tool result and the admin instruction are both VIA-Claude and stay English. Only run the i18n parity check if step 4 incidentally adds a direct-path string

## 5. Documentation + verification

- [x] 5.1 Update `CLAUDE.md`: the slot tier resolves from the effective format (game-format slots honored); game-authoritative write default + shadowing flow
- [x] 5.2 Confirm NO data-format migration is needed — the slot-policy and shadowing changes are behavioral only; config shape (`games[]`, season entries) is unchanged
- [x] 5.3 Run `npx tsc`, `npx oxlint`, `npx oxfmt --check`, full `npm test` — all green
